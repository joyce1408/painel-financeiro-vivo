// Banco de dados local (IndexedDB). Tudo fica no aparelho; nada é enviado para servidor.
const NOME = 'painel-financeiro-vivo';
const VERSAO = 1;
export const STORES = {
  meta: 'chave', contas: 'id', faturas: 'id', transacoes: 'id', categorias: 'nome',
  regras: 'id', importacoes: 'id', arquivos: 'hash', origens: 'fp',
};

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
export async function gravar(ops) {
  const db = await abrir();
  const stores = [...new Set(ops.map(o => o.store))];
  return new Promise((ok, err) => {
    const tx = db.transaction(stores, 'readwrite');
    for (const o of ops) { const s = tx.objectStore(o.store); if ('put' in o) s.put(o.put); else s.delete(o.del); }
    tx.oncomplete = () => ok(); tx.onerror = () => err(tx.error); tx.onabort = () => err(tx.error || new Error('Gravação cancelada'));
  });
}
export async function limparTudo() {
  const db = await abrir();
  return new Promise((ok, err) => { const tx = db.transaction(Object.keys(STORES), 'readwrite'); Object.keys(STORES).forEach(s => tx.objectStore(s).clear()); tx.oncomplete = ok; tx.onerror = () => err(tx.error); });
}
export async function exportar() { const out = {}; for (const s of Object.keys(STORES)) out[s] = await todos(s); return out; }
export async function restaurar(dados) {
  await limparTudo();
  const ops = []; for (const s of Object.keys(STORES)) for (const o of (dados[s] || [])) ops.push({ store: s, put: o });
  for (let i = 0; i < ops.length; i += 2000) await gravar(ops.slice(i, i + 2000));
}
// Pede ao navegador para não apagar os dados por falta de espaço.
export async function persistir() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; } }
