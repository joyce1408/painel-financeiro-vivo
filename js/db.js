// Banco de dados local (IndexedDB). Tudo fica no aparelho; nada é enviado para servidor.
const NOME = 'painel-financeiro-vivo';
const VERSAO = 3; // v2: lixeira (exclusões, para a sincronização) · v3: cópias automáticas e registro de conflitos
export const STORES = {
  meta: 'chave', contas: 'id', faturas: 'id', transacoes: 'id', categorias: 'nome',
  regras: 'id', importacoes: 'id', arquivos: 'hash', origens: 'fp', lixeira: 'id',
  copias: 'id', conflitos: 'id',
};
// Lojas que ficam só neste aparelho e não vão para o arquivo de backup.
export const SO_LOCAIS = ['copias', 'conflitos'];
// Dados que vão para o cofre sincronizado. meta fica só no aparelho (senha, configurações).
export const SINCRONIZADOS = ['contas', 'faturas', 'transacoes', 'categorias', 'regras', 'importacoes', 'arquivos', 'origens', 'lixeira'];
let aoGravar = null;
// Relógio das alterações: nunca anda para trás em relação ao que já foi visto de outro aparelho.
// Assim, um celular com o relógio atrasado não faz uma alteração nova parecer "mais antiga".
let relogio = 0;
export const ajustarRelogio = ms => { if (ms > relogio) relogio = ms; };
const marca = () => { relogio = Math.max(Date.now(), relogio + 1); return relogio; };
export const quandoGravar = f => { aoGravar = f; };

let _db = null;
export function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, err) => {
    const rq = indexedDB.open(NOME, VERSAO);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      for (const [s, k] of Object.entries(STORES)) if (!db.objectStoreNames.contains(s)) {
        const os = db.createObjectStore(s, { keyPath: k });
        if (s === 'transacoes') { os.createIndex('mes', 'mes'); os.createIndex('faturaId', 'faturaId'); os.createIndex('importacaoId', 'importacaoId'); os.createIndex('status', 'status'); }
        if (s === 'origens') os.createIndex('importacaoId', 'importacaoId');
        if (s === 'arquivos') os.createIndex('importacaoId', 'importacaoId');
      }
    };
    rq.onsuccess = () => { _db = rq.result; ok(_db); };
    rq.onerror = () => err(rq.error);
    rq.onblocked = () => err(new Error('Feche outras abas do painel e recarregue.'));
  });
}
const p = rq => new Promise((ok, err) => { rq.onsuccess = () => ok(rq.result); rq.onerror = () => err(rq.error); });

export async function todos(store) { const db = await abrir(); return p(db.transaction(store).objectStore(store).getAll()); }
export async function um(store, key) { const db = await abrir(); return p(db.transaction(store).objectStore(store).get(key)); }

// Grava várias alterações de uma vez, tudo ou nada.
// ops: [{store, put: obj} | {store, del: chave}]
// Cada registro gravado recebe _mod (quando foi alterado) e cada exclusão deixa um registro na lixeira:
// é assim que dois aparelhos sabem qual versão é a mais nova ao sincronizar.
// opc.carimbar=false mantém o _mod que veio (restaurar backup, dados validados, sincronização).
export async function gravar(ops, opc = {}) {
  const db = await abrir();
  const carimbar = opc.carimbar !== false, agora = marca();
  // Recriar algo que já foi excluído (ex.: reimportar um arquivo depois de desfazer a importação) precisa ser
  // explícito: o registro ganha _revive e a exclusão antiga deixa de valer para ele. Edições comuns feitas num
  // aparelho que ainda não sabia da exclusão NÃO têm _revive, então a exclusão continua valendo.
  const lixo = carimbar && ops.some(o => 'put' in o && !SO_LOCAIS.includes(o.store) && o.store !== 'meta' && o.store !== 'lixeira') ? new Set((await todos('lixeira')).map(r => r.id)) : new Set();
  const fin = [];
  for (const o of ops) {
    if (o.store === 'meta' || o.store === 'lixeira' || SO_LOCAIS.includes(o.store) || !carimbar) { fin.push(o); continue; }
    if ('put' in o) {
      const idL = o.store + '|' + o.put[STORES[o.store]];
      if (lixo.has(idL)) { fin.push({ store: o.store, put: { ...o.put, _mod: agora, _revive: agora } }); fin.push({ store: 'lixeira', del: idL }); }
      else fin.push({ store: o.store, put: { ...o.put, _mod: agora } });
    }
    else { fin.push(o); fin.push({ store: 'lixeira', put: { id: o.store + '|' + o.del, store: o.store, chave: o.del, em: agora } }); }
  }
  const stores = [...new Set(fin.map(o => o.store))];
  if (!stores.length) return;
  await new Promise((ok, err) => {
    const tx = db.transaction(stores, 'readwrite');
    for (const o of fin) { const s = tx.objectStore(o.store); if ('put' in o) s.put(o.put); else s.delete(o.del); }
    tx.oncomplete = () => ok(); tx.onerror = () => err(tx.error); tx.onabort = () => err(tx.error || new Error('Gravação cancelada'));
  });
  if (carimbar && aoGravar && fin.some(o => o.store !== 'meta' && !SO_LOCAIS.includes(o.store))) aoGravar();
}
// Troca o conteúdo das lojas sincronizadas pelo resultado da mescla, numa única transação.
export async function substituir(dados) {
  const db = await abrir();
  return new Promise((ok, err) => {
    const tx = db.transaction(SINCRONIZADOS, 'readwrite');
    for (const s of SINCRONIZADOS) { const os = tx.objectStore(s); os.clear(); for (const r of dados[s] || []) os.put(r); }
    tx.oncomplete = () => ok(); tx.onerror = () => err(tx.error); tx.onabort = () => err(tx.error || new Error('Gravação cancelada'));
  });
}
// Limpa a base, mas mantém as cópias automáticas e o registro de conflitos (rede de segurança).
export async function limparTudo() {
  const db = await abrir(); const ss = Object.keys(STORES).filter(s => !SO_LOCAIS.includes(s));
  return new Promise((ok, err) => { const tx = db.transaction(ss, 'readwrite'); ss.forEach(s => tx.objectStore(s).clear()); tx.oncomplete = ok; tx.onerror = () => err(tx.error); });
}
export async function exportar() { const out = {}; for (const s of Object.keys(STORES)) if (!SO_LOCAIS.includes(s)) out[s] = await todos(s); return out; }

// Cópia automática de segurança, guardada neste aparelho (ex.: antes da primeira sincronização).
// Guarda as últimas 8; a mais antiga sai quando entra uma nova.
export async function copiaDeSeguranca(motivo) {
  const dados = await exportar(); dados.meta = (dados.meta || []).filter(m => m.chave !== 'sync');
  const c = { id: 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), em: new Date().toISOString(), motivo, n: (dados.transacoes || []).length, dados };
  const antigas = (await todos('copias')).sort((a, b) => a.em.localeCompare(b.em));
  const ops = [{ store: 'copias', put: c }, ...antigas.slice(0, Math.max(0, antigas.length - 7)).map(x => ({ store: 'copias', del: x.id }))];
  await gravar(ops);
  return c;
}
export async function restaurar(dados) {
  await limparTudo();
  const ops = []; for (const s of Object.keys(STORES)) for (const o of (dados[s] || [])) ops.push({ store: s, put: o });
  for (let i = 0; i < ops.length; i += 2000) await gravar(ops.slice(i, i + 2000), { carimbar: false });
}
// Pede ao navegador para não apagar os dados por falta de espaço.
export async function persistir() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; } }
