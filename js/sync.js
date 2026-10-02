// Sincronização entre aparelhos, com criptografia de ponta a ponta.
// Os dados são cifrados neste aparelho (AES-256-GCM) com uma chave derivada da senha da família (PBKDF2-SHA256).
// O Supabase guarda só o "cofre" cifrado; sem a senha, ninguém (nem o Supabase) consegue ler.
// A senha nunca é guardada nem enviada: o aparelho guarda só a chave derivada.
import { todos, um, gravar, substituir, quandoGravar, SINCRONIZADOS, STORES } from './db.js';

const ITERACOES = 600000;
const SAL = 'painel-financeiro-vivo/cofre/v1';
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');

export const normalizarURL = u => String(u || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');

// Senha → chave AES (32 bytes) + id do cofre (32 bytes, em hex). Leva ~1 s de propósito (dificulta adivinhar a senha).
export async function derivar(senha) {
  const base = await crypto.subtle.importKey('raw', enc.encode(senha.normalize('NFC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(SAL), iterations: ITERACOES }, base, 512));
  return { chave: b64(bits.slice(0, 32)), id: hex(bits.slice(32)) };
}
const chaveAES = raw => crypto.subtle.importKey('raw', deB64(raw), 'AES-GCM', false, ['encrypt', 'decrypt']);

async function comprimir(u8) {
  if (typeof CompressionStream === 'undefined') return null;
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
async function descomprimir(u8) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()); }

export async function cifrar(obj, chaveRaw) {
  const k = await chaveAES(chaveRaw), iv = crypto.getRandomValues(new Uint8Array(12));
  const bruto = enc.encode(JSON.stringify(obj)); const z = await comprimir(bruto);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, z || bruto));
  return `${z ? 'v1z' : 'v1'}.${b64(iv)}.${b64(ct)}`;
}
export async function decifrar(txt, chaveRaw) {
  const [v, iv, ct] = String(txt).split('.');
  if (!['v1', 'v1z'].includes(v)) throw new Error('Formato do cofre desconhecido.');
  let pt;
  try { pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(iv) }, await chaveAES(chaveRaw), deB64(ct))); }
  catch { throw new Error('Não foi possível abrir o cofre com esta senha.'); }
  if (v === 'v1z') pt = await descomprimir(pt);
  return JSON.parse(dec.decode(pt));
}

// Mescla registro a registro: vale a versão alterada por último (_mod). Exclusões ficam na lixeira e vencem
// versões mais antigas do mesmo registro. O resultado é o mesmo nos dois aparelhos, seja qual for a ordem.
const ordem = r => JSON.stringify(r);
export function mesclar(a, b) {
  const out = {};
  const lix = new Map();
  for (const r of [...(a.lixeira || []), ...(b.lixeira || [])]) { const x = lix.get(r.id); if (!x || r.em > x.em) lix.set(r.id, r); }
  out.lixeira = [...lix.values()];
  for (const s of SINCRONIZADOS) {
    if (s === 'lixeira') continue;
    const kp = STORES[s], m = new Map();
    for (const r of [...(a[s] || []), ...(b[s] || [])]) {
      const k = r[kp], x = m.get(k);
      if (!x) { m.set(k, r); continue; }
      const ra = r._mod || 0, xa = x._mod || 0;
      if (ra > xa || (ra === xa && ordem(r) > ordem(x))) m.set(k, r);
    }
    for (const [k, r] of m) { const t = lix.get(s + '|' + k); if (t && t.em >= (r._mod || 0)) m.delete(k); }
    out[s] = [...m.values()];
  }
  return out;
}
const assinatura = d => SINCRONIZADOS.map(s => (d[s] || []).map(ordem).sort().join('\n')).join('\n#\n');

// ---------- Supabase (só duas funções: ler_cofre e gravar_cofre) ----------
async function rpc(cfg, fn, corpo) {
  const h = { 'Content-Type': 'application/json', apikey: cfg.chavePublica };
  if (/^eyJ/.test(cfg.chavePublica)) h.Authorization = 'Bearer ' + cfg.chavePublica; // chave "anon" antiga (JWT)
  let r;
  try { r = await fetch(`${cfg.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: h, body: JSON.stringify(corpo), cache: 'no-store' }); }
  catch { const e = new Error('Sem conexão com o Supabase.'); e.offline = true; throw e; }
  const txt = await r.text();
  if (!r.ok) {
    if (r.status === 404 || /PGRST202|Could not find the function/i.test(txt)) throw new Error('O Supabase respondeu, mas as funções do cofre não existem. Rode o script supabase.sql no SQL Editor do projeto.');
    if (r.status === 401 || r.status === 403 || /Invalid API key|No API key/i.test(txt)) throw new Error('Chave pública do Supabase recusada. Confira a chave (anon/publishable).');
    if (/paused|inactive/i.test(txt) || r.status === 540) throw new Error('O projeto do Supabase está pausado. Entre em supabase.com e reative o projeto.');
    throw new Error(`Supabase respondeu ${r.status}: ${txt.slice(0, 160)}`);
  }
  return txt ? JSON.parse(txt) : null;
}
const lerCofre = async cfg => { const r = await rpc(cfg, 'ler_cofre', { p_id: cfg.id }); return Array.isArray(r) ? r[0] || null : r; };
const gravarCofre = (cfg, dados, versao) => rpc(cfg, 'gravar_cofre', { p_id: cfg.id, p_dados: dados, p_versao_esperada: versao, p_por: cfg.aparelho || '' });

// ---------- estado e ciclo ----------
export const estado = { ligado: false, sincronizando: false, ultima: null, erro: null, offline: false, aparelho: '', versao: 0, porUltimo: '', quandoNuvem: null };
const ouvintes = new Set();
export const aoMudarSync = f => ouvintes.add(f);
const avisar = () => ouvintes.forEach(f => { try { f(estado); } catch (e) { console.error(e); } });
let aoReceber = null; // chamado quando chegam dados de outro aparelho (para recarregar a tela)

export async function config() { const m = await um('meta', 'sync'); return m ? m.valor : null; }
async function salvarConfig(c) { await gravar([{ store: 'meta', put: { chave: 'sync', valor: c } }]); }

let fila = null, pendente = false;
export function sincronizar() {
  if (fila) { pendente = true; return fila; }
  fila = (async () => {
    try { do { pendente = false; await umaVez(); } while (pendente); }
    finally { fila = null; }
  })();
  return fila;
}
async function umaVez() {
  const cfg = await config(); if (!cfg) return;
  estado.sincronizando = true; avisar();
  try {
    for (let tentativa = 0; tentativa < 4; tentativa++) {
      const remoto = await lerCofre(cfg);
      const local = {}; for (const s of SINCRONIZADOS) local[s] = await todos(s);
      const dadosRemotos = remoto ? await decifrar(remoto.dados, cfg.chave) : null;
      const mescla = dadosRemotos ? mesclar(local, dadosRemotos) : local;
      const sigM = assinatura(mescla);
      const mudouLocal = sigM !== assinatura(local);
      let versao = remoto ? Number(remoto.versao) : 0;
      if (!remoto || sigM !== assinatura(dadosRemotos)) {
        const nv = Number(await gravarCofre(cfg, await cifrar(mescla, cfg.chave), versao));
        if (nv === -1) continue; // outro aparelho gravou no meio do caminho: lê de novo e mescla outra vez
        versao = nv;
      }
      if (mudouLocal) {
        // se algo foi gravado aqui enquanto a nuvem respondia, recomeça para não perder a alteração
        const agora = {}; for (const s of SINCRONIZADOS) agora[s] = await todos(s);
        if (assinatura(agora) !== assinatura(local)) continue;
        await substituir(mescla); if (aoReceber) await aoReceber();
      }
      Object.assign(estado, { ultima: new Date().toISOString(), erro: null, offline: false, versao, porUltimo: remoto ? remoto.atualizado_por : cfg.aparelho, quandoNuvem: remoto ? remoto.atualizado_em : new Date().toISOString() });
      await salvarConfig({ ...cfg, ultima: estado.ultima, versao });
      return;
    }
    throw new Error('Muitas gravações ao mesmo tempo. Tente de novo em instantes.');
  } catch (e) {
    estado.erro = e.offline ? null : e.message; estado.offline = !!e.offline;
    if (!e.offline) console.error(e);
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
export async function conectar({ url, chavePublica, senha, aparelho, modo }) {
  url = normalizarURL(url);
  if (!/^(https:\/\/[^/]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/.test(url)) throw new Error('O endereço do projeto deve ser algo como https://xxxx.supabase.co');
  if (!chavePublica || chavePublica.trim().length < 20) throw new Error('Cole a chave pública (anon ou publishable) do projeto.');
  if (!senha || senha.length < 12) throw new Error('A senha precisa ter pelo menos 12 caracteres. Use 3 ou 4 palavras.');
  const { chave, id } = await derivar(senha);
  const cfg = { url, chavePublica: chavePublica.trim(), id, chave, aparelho: (aparelho || '').trim().slice(0, 60) || nomeAparelho(), ligadoEm: new Date().toISOString(), versao: 0 };
  const remoto = await lerCofre(cfg);
  if (modo === 'entrar' && !remoto) throw new Error('Não encontrei um cofre com esta senha neste projeto. Confira a senha (maiúsculas, acentos e espaços contam) e o endereço.');
  if (remoto) await decifrar(remoto.dados, chave); // confirma que a senha abre o cofre
  await salvarConfig(cfg);
  estado.ligado = true; estado.aparelho = cfg.aparelho; ligarEventos();
  await sincronizar();
  if (estado.erro) throw new Error(estado.erro);
  return { existia: !!remoto };
}
export async function desconectar() { await gravar([{ store: 'meta', del: 'sync' }]); Object.assign(estado, { ligado: false, ultima: null, erro: null, versao: 0 }); avisar(); }

export function nomeAparelho() {
  const u = navigator.userAgent;
  return /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Mac/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : 'Navegador';
}

// Inicia: sincroniza ao abrir, depois de cada alteração, ao voltar para o app e quando a internet volta.
export async function iniciarSync(recarregar) {
  aoReceber = recarregar;
  const cfg = await config();
  quandoGravar(() => agendar());
  if (!cfg) { avisar(); return; }
  Object.assign(estado, { ligado: true, aparelho: cfg.aparelho, ultima: cfg.ultima || null, versao: cfg.versao || 0 });
  ligarEventos(); avisar();
  sincronizar();
}
