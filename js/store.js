// Fonte única de verdade em memória, carregada do IndexedDB. Toda alteração passa por aqui e é gravada no banco local.
import { abrir, todos, gravar, um, restaurar, limparTudo, exportar, persistir, copiaDeSeguranca } from './db.js';
import { uid, norm, cents } from './utils.js';
import { statusFaturas } from './importer.js';

export const B = { contas: [], faturas: [], transacoes: [], categorias: [], regras: [], importacoes: [], arquivos: [], origens: new Set(), origensLista: [], meta: {} };
const ouvintes = new Set();
export const aoMudar = f => ouvintes.add(f);
const avisar = () => ouvintes.forEach(f => f());

export async function carregar() {
  await abrir();
  const [contas, faturas, transacoes, categorias, regras, importacoes, arquivos, origens, meta] = await Promise.all(['contas', 'faturas', 'transacoes', 'categorias', 'regras', 'importacoes', 'arquivos', 'origens', 'meta'].map(todos));
  Object.assign(B, { contas, faturas: statusFaturas(faturas), transacoes: transacoes.sort((a, b) => a.data.localeCompare(b.data) || a.id.localeCompare(b.id)), categorias: categorias.sort((a, b) => a.nome.localeCompare(b.nome, 'pt')), regras, importacoes: importacoes.sort((a, b) => b.data.localeCompare(a.data)), arquivos, origensLista: origens, origens: new Set(origens.map(o => o.fp)), meta: Object.fromEntries(meta.map(m => [m.chave, m.valor])) });
  avisar();
}

// Primeira abertura: se o arquivo data/seed.json existir ao lado do painel (uso local), traz os dados validados
// do Raio-X (jan–ago/2026). Ele NÃO deve ser publicado: no GitHub Pages, carregue o arquivo em Backup › Restaurar.
export async function migrarSeNecessario(urlSeed = './data/seed.json') {
  const m = await um('meta', 'migracao');
  if (m) return false;
  if ((await todos('transacoes')).length) { await gravar([{ store: 'meta', put: { chave: 'migracao', valor: { em: new Date().toISOString(), pulada: true } } }]); return false; }
  let seed = null;
  try { const r = await fetch(urlSeed, { cache: 'no-store' }); if (r.ok) seed = await r.json(); } catch { /* sem arquivo local: tudo bem */ }
  if (!seed || !Array.isArray(seed.transacoes)) return false;
  await importarSeed(seed);
  return true;
}
export async function importarSeed(seed) {
  const ops = [];
  for (const s of ['contas', 'faturas', 'transacoes', 'categorias', 'regras', 'importacoes', 'arquivos', 'origens']) for (const o of seed[s] || []) ops.push({ store: s, put: o });
  ops.push({ store: 'meta', put: { chave: 'migracao', valor: { em: new Date().toISOString(), versaoSeed: seed.versao, geradoEm: seed.geradoEm } } });
  for (let i = 0; i < ops.length; i += 1500) await gravar(ops.slice(i, i + 1500), { carimbar: false });
  persistir();
}

const agora = () => new Date().toISOString();
const reler = async () => { await carregar(); };

// Classificar (ou reclassificar) um lançamento. Opcional: criar regra para os próximos e aplicar aos pendentes iguais.
export async function classificarLancamento(id, cls, opc = {}) {
  const t = B.transacoes.find(x => x.id === id); if (!t) return;
  const ops = [];
  const upd = x => ({ ...x, tipo: cls.tipo, mov: cls.mov, cat: cls.cat, sub: cls.sub, status: 'confirmado', classificacao: 'confirmada', motivo: 'Classificado por você', alteradoEm: agora() });
  ops.push({ store: 'transacoes', put: { ...upd(t), ...(cls.desc ? { desc: cls.desc } : {}), ...(cls.obs != null ? { obs: cls.obs } : {}) } });
  let regra = null, aplicados = 0;
  if (opc.criarRegra) {
    regra = { id: uid('r'), padrao: opc.padrao.trim(), tipo: cls.tipo, mov: cls.mov, cat: cls.cat, sub: cls.sub, valor: opc.valorExato ? t.valor : null, conta: opc.soEstaConta ? (t.fonteFp ? t.fonteFp.split('|')[0] : t.conta) : null, origem: 'confirmada', ativa: true, criadoEm: agora(), criadaDe: id };
    ops.push({ store: 'regras', put: regra });
    if (opc.aplicarPendentes) for (const x of casamRegra(regra, B.transacoes.filter(x => x.status === 'pendente' && x.id !== id))) { ops.push({ store: 'transacoes', put: { ...upd(x), status: 'auto', classificacao: 'automatica', motivo: `Sua regra: "${regra.padrao}"`, regraId: regra.id } }); aplicados++; }
  }
  garantirCategoria(cls, ops);
  await gravar(ops); await reler();
  return { regra, aplicados };
}
export function casamRegra(r, txs) {
  return txs.filter(t => norm(t.descOriginal || t.desc).includes(norm(r.padrao)) && (r.valor == null || cents(r.valor) === cents(t.valor)) && (!r.conta || r.conta === (t.fonteFp ? t.fonteFp.split('|')[0] : t.conta)));
}
function garantirCategoria(cls, ops) {
  if (cls.tipo !== 'despesa') return;
  const c = B.categorias.find(c => c.nome === cls.cat);
  if (!c) ops.push({ store: 'categorias', put: { nome: cls.cat, subs: [cls.sub], definicao: '', entra: '', naoEntra: '', criadaEm: agora() } });
  else if (!c.subs.includes(cls.sub)) ops.push({ store: 'categorias', put: { ...c, subs: [...c.subs, cls.sub].sort((a, b) => a.localeCompare(b, 'pt')) } });
}
export async function confirmarAuto(ids) {
  const ops = ids.map(id => B.transacoes.find(t => t.id === id)).filter(Boolean).map(t => ({ store: 'transacoes', put: { ...t, status: 'confirmado', classificacao: 'confirmada', alteradoEm: agora() } }));
  if (ops.length) { await gravar(ops); await reler(); }
}
export async function editarLancamento(id, campos) {
  const t = B.transacoes.find(x => x.id === id); if (!t) return;
  const n = { ...t, ...campos, alteradoEm: agora() };
  if (campos.data && !campos.mes && !/INSS GPS/.test(n.desc)) n.mes = campos.data.slice(0, 7);
  const ops = [{ store: 'transacoes', put: n }]; garantirCategoria(n, ops);
  await gravar(ops); await reler();
}
export async function excluirLancamento(id) { await gravar([{ store: 'transacoes', del: id }]); await reler(); }

export async function novoLancamentoManual(c) {
  const t = { id: uid('t'), data: c.data, mes: c.data.slice(0, 7), conta: c.conta, cartao: c.cartao || '', forma: c.forma, desc: c.desc, descOriginal: c.desc, valor: c.valor, tipo: c.tipo, mov: c.mov, cat: c.cat, sub: c.sub, obs: c.obs || '', parcela: c.parcela || '', faturaId: null, fonteFp: null, arquivo: null, importacaoId: 'manual', status: 'confirmado', classificacao: 'confirmada', motivo: 'Lançado à mão', criadoEm: agora() };
  const ops = [{ store: 'transacoes', put: t }]; garantirCategoria(t, ops);
  await gravar(ops); await reler(); return t;
}

export async function salvarRegra(r) { await gravar([{ store: 'regras', put: { ...r, id: r.id || uid('r'), origem: r.origem || 'confirmada', criadoEm: r.criadoEm || agora(), alteradoEm: agora() } }]); await reler(); }
export async function excluirRegra(id) { await gravar([{ store: 'regras', del: id }]); await reler(); }
export async function salvarCategoria(c, nomeAntigo) {
  const ops = [{ store: 'categorias', put: c }];
  if (nomeAntigo && nomeAntigo !== c.nome) {
    ops.push({ store: 'categorias', del: nomeAntigo });
    B.transacoes.filter(t => t.cat === nomeAntigo).forEach(t => ops.push({ store: 'transacoes', put: { ...t, cat: c.nome } }));
    B.regras.filter(r => r.cat === nomeAntigo).forEach(r => ops.push({ store: 'regras', put: { ...r, cat: c.nome } }));
  }
  await gravar(ops); await reler();
}

export async function backupJSON() { const d = await exportar(); d.meta = (d.meta || []).filter(m => !LOCAIS.includes(m.chave)); return { app: 'painel-financeiro-vivo', versao: 1, exportadoEm: agora(), dados: d }; }
const LOCAIS = ['sync', 'ultimoBackup'];
async function guardarLocais() { const ms = []; for (const k of LOCAIS) { const m = await um('meta', k); if (m) ms.push({ store: 'meta', put: m }); } return ms; }
// Aceita um backup do painel ou o arquivo de dados validados (migração do Raio-X).
// Antes de substituir qualquer coisa, guarda uma cópia automática do que existe hoje neste aparelho.
export async function restaurarBackup(obj) {
  const locais = await guardarLocais();
  const valido = (obj && obj.app === 'painel-financeiro-vivo' && obj.dados && Array.isArray(obj.dados.transacoes)) || (obj && Array.isArray(obj.transacoes) && obj.geradoEm && Array.isArray(obj.origens));
  if (!valido) throw new Error('Este arquivo não é um backup do Painel Financeiro Vivo nem o arquivo de dados validados.');
  if ((await todos('transacoes')).length) await copiaDeSeguranca('antes de restaurar um backup');
  if (obj && obj.app === 'painel-financeiro-vivo' && obj.dados && Array.isArray(obj.dados.transacoes)) {
    await restaurar(obj.dados);
    if (!obj.dados.meta || !obj.dados.meta.find(m => m.chave === 'migracao')) await gravar([{ store: 'meta', put: { chave: 'migracao', valor: { em: agora(), restaurado: true } } }]);
  } else if (obj && Array.isArray(obj.transacoes) && obj.geradoEm && Array.isArray(obj.origens)) {
    await limparTudo(); await importarSeed(obj);
  } else throw new Error('Este arquivo não é um backup do Painel Financeiro Vivo nem o arquivo de dados validados.');
  if (locais.length) await gravar(locais);
  await reler();
}
// Apagar tudo também desliga a sincronização neste aparelho (o cofre na nuvem não é apagado).
export async function apagarTudo() { if ((await todos('transacoes')).length) await copiaDeSeguranca('antes de apagar tudo'); await limparTudo(); await gravar([{ store: 'meta', put: { chave: 'migracao', valor: { em: agora(), zerado: true } } }]); await reler(); }
