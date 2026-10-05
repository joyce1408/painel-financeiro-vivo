// Sincronização entre aparelhos, com criptografia de ponta a ponta.
//
// O que sai do aparelho: só o id do cofre (derivado da senha, não revela a senha) e um bloco cifrado.
// O que nunca sai: a senha, a chave de criptografia e qualquer dado financeiro em texto puro.
//
// Criptografia (Web Crypto, nativa do navegador):
//  • senha → PBKDF2-SHA256, 600.000 iterações, sal = app + endereço do projeto → 512 bits:
//    metade vira a chave AES-256 (importada como NÃO exportável e guardada só neste aparelho),
//    metade vira o id do cofre (o servidor só conhece esse id).
//  • dados → JSON → gzip → AES-256-GCM com IV aleatório de 96 bits novo a cada gravação,
//    e "dados adicionais autenticados" (AAD) com o id do cofre: um cofre não pode ser trocado por outro.
//  • dentro do bloco cifrado vai um contador (seq) igual à versão do servidor: se a nuvem devolver
//    um cofre mais antigo do que o último já visto aqui, a sincronização para (proteção contra rollback).
import { todos, um, gravar, substituir, quandoGravar, ajustarRelogio, copiaDeSeguranca, SINCRONIZADOS, STORES } from './db.js';

const ITERACOES = 600000;
const FORMATO = 'v2';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');

export const normalizarURL = u => String(u || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '').toLowerCase();
const aad = id => enc.encode(`painel-financeiro-vivo|cofre|${FORMATO}|${id}`);

// Recusa chaves secretas: a service_role / secret key dá acesso total ao banco e nunca pode ficar no app.
export function checarChavePublica(k) {
  k = String(k || '').trim();
  if (/^sb_secret_/i.test(k)) return 'Esta é uma chave SECRETA (sb_secret_…). Nunca use ela no app. Copie a chave publishable (sb_publishable_…).';
  if (/^eyJ/.test(k)) {
    try { const p = JSON.parse(atob(k.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); if (p.role && p.role !== 'anon') return `Esta chave é do tipo "${p.role}". Use só a chave anon/publishable; a service_role nunca pode ficar no app.`; }
    catch { return 'Chave inválida.'; }
  } else if (!/^sb_publishable_/i.test(k)) return 'Cole a chave pública do projeto: começa com sb_publishable_ (ou eyJ…, a chave anon antiga).';
  return null;
}

// Senha → chave AES (não exportável) + id do cofre. Leva ~1 s de propósito: dificulta testar senhas no chute.
export async function derivar(senha, url) {
  const base = await crypto.subtle.importKey('raw', enc.encode(senha.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const sal = enc.encode('painel-financeiro-vivo/cofre/v2|' + normalizarURL(url));
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: ITERACOES }, base, 512));
  const chave = await crypto.subtle.importKey('raw', bits.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const id = hex(bits.slice(32)); bits.fill(0);
  return { chave, id };
}

async function gz(u8, modo) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(modo === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'))).arrayBuffer()); }
const temGzip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

export async function cifrar(obj, chave, id) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // novo a cada gravação
  const bruto = enc.encode(JSON.stringify(obj)); const z = temGzip();
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id), tagLength: 128 }, chave, z ? await gz(bruto, 'c') : bruto));
  return `${FORMATO}${z ? 'z' : ''}.${b64(iv)}.${b64(ct)}`;
}
export async function decifrar(txt, chave, id) {
  const [v, iv, ct] = String(txt).split('.');
  if (v !== FORMATO && v !== FORMATO + 'z') throw new Error('Formato do cofre desconhecido.');
  const ivb = deB64(iv); if (ivb.length !== 12) throw new Error('Cofre corrompido.');
  let pt;
  try { pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivb, additionalData: aad(id), tagLength: 128 }, chave, deB64(ct))); }
  catch { throw new Error('Não foi possível abrir o cofre com esta senha (ou o cofre foi alterado fora do app).'); }
  if (v.endsWith('z')) pt = await gz(pt, 'd');
  return JSON.parse(dec.decode(pt));
}

// ---------- mescla ----------
// Registro a registro, vale a versão alterada por último (_mod). Exclusões ficam na lixeira para sempre e
// vencem qualquer cópia do registro, mesmo editada depois, se ela não foi recriada de propósito (_revive):
// um aparelho atrasado não ressuscita o que foi apagado.
// "base" = momento da última sincronização bem-sucedida deste aparelho. Se os dois lados mudaram o mesmo
// registro depois da base, é um CONFLITO: um lado vence pela regra acima e o outro fica registrado.
const ordem = r => JSON.stringify(r);
const rotulo = (s, r) => r ? (s === 'transacoes' ? `${r.data} · ${r.desc} · ${r.valor}` : s === 'regras' ? `regra "${r.padrao}"` : s === 'categorias' ? `categoria ${r.nome}` : s === 'faturas' ? `fatura ${r.id}` : `${s} ${r[STORES[s]]}`) : '';
export function mesclar(local, remoto, base = Infinity) {
  const out = {}, conflitos = [];
  const lix = new Map(), lixL = new Map((local.lixeira || []).map(r => [r.id, r])), lixR = new Map((remoto.lixeira || []).map(r => [r.id, r]));
  for (const r of [...lixL.values(), ...lixR.values()]) { const x = lix.get(r.id); if (!x || r.em > x.em) lix.set(r.id, r); }
  out.lixeira = [...lix.values()];
  for (const s of SINCRONIZADOS) {
    if (s === 'lixeira') continue;
    const kp = STORES[s];
    const L = new Map((local[s] || []).map(r => [r[kp], r])), R = new Map((remoto[s] || []).map(r => [r[kp], r]));
    const m = new Map();
    for (const k of new Set([...L.keys(), ...R.keys()])) {
      const a = L.get(k), b = R.get(k);
      let v = a && b ? (((a._mod || 0) > (b._mod || 0) || ((a._mod || 0) === (b._mod || 0) && ordem(a) >= ordem(b))) ? a : b) : (a || b);
      if (a && b && ordem(a) !== ordem(b) && (a._mod || 0) > base && (b._mod || 0) > base)
        conflitos.push({ store: s, chave: k, tipo: 'edicao', venceu: v === a ? 'este aparelho' : 'outro aparelho', mantido: v, descartado: v === a ? b : a, rotulo: rotulo(s, v) });
      const t = lix.get(s + '|' + k);
      if (t && !((v._revive || 0) > t.em)) {
        // excluído: vence qualquer cópia ou edição feita sem saber da exclusão (aparelho atrasado).
        // Se o outro lado tinha editado depois da última sincronização, fica registrado como conflito.
        const editado = [a, b].find(x => x && (x._mod || 0) > base);
        if (editado && t.em > base) conflitos.push({ store: s, chave: k, tipo: 'exclusao', venceu: 'exclusão', mantido: null, descartado: editado, rotulo: rotulo(s, editado) });
        continue;
      }
      m.set(k, v);
    }
    out[s] = [...m.values()];
  }
  return { dados: out, conflitos };
}
const assinatura = d => SINCRONIZADOS.map(s => (d[s] || []).map(ordem).sort().join('\n')).join('\n#\n');
const maiorMarca = d => { let m = 0; for (const s of SINCRONIZADOS) for (const r of d[s] || []) m = Math.max(m, r._mod || 0, r.em && typeof r.em === 'number' ? r.em : 0); return m; };

// ---------- Supabase: só duas funções (ler_cofre e gravar_cofre), chamadas com a chave pública ----------
async function rpc(cfg, fn, corpo) {
  const h = { 'Content-Type': 'application/json', apikey: cfg.chavePublica };
  if (/^eyJ/.test(cfg.chavePublica)) h.Authorization = 'Bearer ' + cfg.chavePublica; // chave anon antiga (JWT)
  let r;
  try { r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(corpo), cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch { const e = new Error('Sem conexão com o Supabase.'); e.offline = true; throw e; }
  const txt = await r.text();
  if (!r.ok) {
    if (r.status === 404 || /PGRST202|Could not find the function/i.test(txt)) throw new Error('O Supabase respondeu, mas as funções do cofre não existem. Rode o script supabase.sql no SQL Editor do projeto.');
    if (r.status === 401 || r.status === 403 || /Invalid API key|No API key/i.test(txt)) throw new Error('Chave pública do Supabase recusada. Confira a chave (anon/publishable).');
    if (/paused|inactive/i.test(txt) || r.status === 540) throw new Error('O projeto do Supabase está pausado. Entre em supabase.com e reative o projeto.');
    if (/limite de cofres/i.test(txt)) throw new Error('O projeto já tem o número máximo de cofres. Confira se a senha está certa.');
    throw new Error(`Supabase respondeu ${r.status}: ${txt.slice(0, 160)}`);
  }
  return txt ? JSON.parse(txt) : null;
}
const lerCofre = async cfg => { const r = await rpc(cfg, 'ler_cofre', { p_id: cfg.id }); return Array.isArray(r) ? r[0] || null : r; };
const gravarCofre = (cfg, dados, versao) => rpc(cfg, 'gravar_cofre', { p_id: cfg.id, p_dados: dados, p_versao_esperada: versao });

// ---------- estado ----------
export const estado = { ligado: false, sincronizando: false, ultima: null, erro: null, offline: false, aparelho: '', versao: 0, porUltimo: '', pendentes: 0, bloqueio: null, conflitosNovos: 0 };
const ouvintes = new Set();
export const aoMudarSync = f => ouvintes.add(f);
const avisar = () => ouvintes.forEach(f => { try { f(estado); } catch (e) { console.error(e); } });
let aoReceber = null;

export async function config() { const m = await um('meta', 'sync'); return m ? m.valor : null; }
async function salvarConfig(c) { await gravar([{ store: 'meta', put: { chave: 'sync', valor: c } }]); }

// Alterações deste aparelho ainda não enviadas: tudo que foi gravado depois do último envio.
export async function contarPendentes() {
  const cfg = await config(); if (!cfg) { estado.pendentes = 0; return 0; }
  const ate = cfg.enviadoAte || 0; let n = 0;
  for (const s of SINCRONIZADOS) for (const r of await todos(s)) if ((s === 'lixeira' ? r.em : r._mod || 0) > ate) n++;
  estado.pendentes = n; return n;
}

let fila = null, pendente = false, opcFila = {};
export function sincronizar(opc = {}) {
  Object.assign(opcFila, opc);
  if (fila) { pendente = true; return fila; }
  fila = (async () => {
    try { do { pendente = false; const o = opcFila; opcFila = {}; await umaVez(o); } while (pendente); }
    finally { fila = null; }
  })();
  return fila;
}
async function umaVez(opc) {
  const cfg = await config(); if (!cfg) return;
  estado.sincronizando = true; avisar();
  try {
    for (let tentativa = 0; tentativa < 5; tentativa++) {
      const remoto = await lerCofre(cfg);
      const local = {}; for (const s of SINCRONIZADOS) local[s] = await todos(s);
      let pacote = null;
      if (!remoto && (cfg.maiorSeq || 0) > 0) throw new Error('O cofre não está mais na nuvem (foi apagado ou o projeto mudou). Nada foi apagado aqui. Para recriar, desligue a sincronização e crie de novo.');
      if (remoto) {
        pacote = await decifrar(remoto.dados, cfg.chave, cfg.id);
        if (Number(pacote.seq) !== Number(remoto.versao)) throw new Error('O cofre na nuvem não confere com a própria versão. Sincronização pausada para proteger seus dados.');
        if (Number(pacote.seq) < (cfg.maiorSeq || 0)) throw new Error(`A nuvem devolveu uma versão mais antiga (${pacote.seq}) do que a última já vista aqui (${cfg.maiorSeq}). Sincronização pausada para proteger seus dados. Se você recriou o projeto de propósito, desligue e entre de novo.`);
      }
      const remotos = pacote ? pacote.dados : null;
      const { dados: mescla, conflitos } = remotos ? mesclar(local, remotos, cfg.base || 0) : { dados: local, conflitos: [] };
      ajustarRelogio(maiorMarca(mescla));

      // nada local é apagado sem cópia; muitas exclusões de uma vez esperam a sua confirmação
      const some = [];
      for (const s of SINCRONIZADOS) { if (s === 'lixeira') continue; const kp = STORES[s], fica = new Set(mescla[s].map(r => r[kp])); for (const r of local[s]) if (!fica.has(r[kp])) some.push({ s, r }); }
      const limite = Math.max(10, Math.ceil(local.transacoes.length * 0.05));
      if (some.length > limite && !opc.permitirExclusoes) {
        estado.bloqueio = { n: some.length, tx: some.filter(x => x.s === 'transacoes').length, exemplos: some.filter(x => x.s === 'transacoes').slice(0, 5).map(x => rotulo('transacoes', x.r)) };
        throw new Error(`A sincronização pede para apagar ${some.length} registros deste aparelho. Nada foi apagado: confirme na aba Sincronizar se isso está certo.`);
      }
      estado.bloqueio = null;

      const sigM = assinatura(mescla), mudouLocal = sigM !== assinatura(local);
      let versao = remoto ? Number(remoto.versao) : 0;
      if (!remoto || sigM !== assinatura(remotos)) {
        const novo = { formato: FORMATO, seq: versao + 1, por: cfg.aparelho, em: new Date().toISOString(), dados: mescla };
        const nv = Number(await gravarCofre(cfg, await cifrar(novo, cfg.chave, cfg.id), versao));
        if (nv === -1) continue; // outro aparelho gravou no meio: lê de novo e mescla outra vez
        if (nv !== versao + 1) throw new Error('Resposta inesperada do servidor ao gravar.');
        versao = nv; estado.porUltimo = cfg.aparelho;
      } else estado.porUltimo = pacote.por || '';
      if (mudouLocal) {
        const agora = {}; for (const s of SINCRONIZADOS) agora[s] = await todos(s);
        if (assinatura(agora) !== assinatura(local)) continue; // algo foi gravado aqui durante a sincronização
        if (some.length) await copiaDeSeguranca(`antes de a sincronização remover ${some.length} registro(s)`);
        await substituir(mescla);
      }
      if (conflitos.length) {
        const em = new Date().toISOString();
        await gravar(conflitos.map((c, i) => ({ store: 'conflitos', put: { id: `k-${Date.now().toString(36)}-${i}`, em, ...c, resolvido: false } })));
        estado.conflitosNovos += conflitos.length;
      }
      const marca = maiorMarca(mescla);
      Object.assign(estado, { ultima: new Date().toISOString(), erro: null, offline: false, versao });
      await salvarConfig({ ...cfg, ultima: estado.ultima, versao, maiorSeq: Math.max(cfg.maiorSeq || 0, versao), base: marca, enviadoAte: marca });
      if (mudouLocal && aoReceber) await aoReceber();
      await contarPendentes();
      return;
    }
    throw new Error('Muitas gravações ao mesmo tempo. Tente de novo em instantes.');
  } catch (e) {
    estado.erro = e.offline ? null : e.message; estado.offline = !!e.offline;
    if (!e.offline) console.error(e);
    await contarPendentes();
  } finally { estado.sincronizando = false; avisar(); }
}

let timer = null, eventos = false;
function ligarEventos() {
  if (eventos) return; eventos = true;
  window.addEventListener('online', () => agendar(500));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') agendar(300); });
  setInterval(() => { if (document.visibilityState === 'visible') agendar(0); }, 5 * 60 * 1000);
}
function agendar(ms = 2500) { if (!estado.ligado) return; clearTimeout(timer); timer = setTimeout(() => sincronizar(), ms); }

// Liga a sincronização neste aparelho. modo 'criar' (primeiro aparelho) ou 'entrar' (cofre já existe).
export async function conectar({ url, chavePublica, senha, senha2, aparelho, modo }) {
  url = normalizarURL(url);
  if (!/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(url)) throw new Error('O endereço do projeto deve ser algo como https://xxxx.supabase.co');
  const ruim = checarChavePublica(chavePublica); if (ruim) throw new Error(ruim);
  if (!senha || senha.length < 12) throw new Error('A senha precisa ter pelo menos 12 caracteres. Use 3 ou 4 palavras.');
  if (senha !== senha2) throw new Error('A confirmação da senha não confere.');
  const { chave, id } = await derivar(senha, url);
  const cfg = { url, chavePublica: chavePublica.trim(), id, chave, aparelho: (aparelho || '').trim().slice(0, 60) || nomeAparelho(), ligadoEm: new Date().toISOString(), versao: 0, base: 0, enviadoAte: 0, maiorSeq: 0 };
  const remoto = await lerCofre(cfg);
  if (modo === 'entrar' && !remoto) throw new Error('Não encontrei um cofre com esta senha neste projeto. Confira a senha (maiúsculas, acentos e espaços contam) e o endereço.');
  if (modo === 'criar' && remoto) throw new Error('Já existe um cofre com esta senha neste projeto. Use "Entrar".');
  if (remoto) await decifrar(remoto.dados, chave, id); // confirma que a senha abre o cofre antes de qualquer gravação
  const copia = await copiaDeSeguranca('antes da primeira sincronização');
  await salvarConfig(cfg);
  estado.ligado = true; estado.aparelho = cfg.aparelho; ligarEventos();
  await sincronizar();
  if (estado.erro) throw new Error(estado.erro);
  return { existia: !!remoto, copia };
}
export async function desconectar() { await gravar([{ store: 'meta', del: 'sync' }]); Object.assign(estado, { ligado: false, ultima: null, erro: null, versao: 0, pendentes: 0, bloqueio: null }); avisar(); }

export function nomeAparelho() {
  const u = navigator.userAgent;
  return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : 'Navegador';
}

export async function iniciarSync(recarregar) {
  aoReceber = recarregar;
  const cfg = await config();
  quandoGravar(() => { agendar(); contarPendentes().then(avisar); });
  if (!cfg) { avisar(); return; }
  if (!(cfg.chave instanceof CryptoKey)) { await desconectar(); estado.erro = 'A sincronização foi atualizada. Entre de novo com a senha da família.'; avisar(); return; }
  Object.assign(estado, { ligado: true, aparelho: cfg.aparelho, ultima: cfg.ultima || null, versao: cfg.versao || 0 });
  ligarEventos(); await contarPendentes(); avisar();
  sincronizar();
}
