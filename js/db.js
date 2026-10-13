// Banco de dados local (IndexedDB), com criptografia de cada registro.
//
// Como os dados ficam guardados neste aparelho:
//  • cada registro é cifrado com AES-256-GCM (IV aleatório novo a cada gravação; o nome da loja e a posição do
//    registro entram como dado autenticado, então um registro não pode ser trocado de lugar);
//  • a chave de cada registro (id, impressão digital, nome…) é guardada como HMAC-SHA256, porque algumas chaves
//    contêm data e valor (ex.: impressão digital "BB||2026-01-02|-3088|1");
//  • as duas chaves (AES e HMAC) são aleatórias e ficam guardadas "embrulhadas" (cifradas) pela senha de abertura
//    e, separadamente, pelo código de recuperação. Só a loja "cofre" (configuração da proteção) fica sem cifrar.
//  • com o painel bloqueado, as chaves não ficam na memória: nada pode ser lido nem gravado.
const NOME = 'painel-financeiro-vivo-protegido';
const NOME_ANTIGO = 'painel-financeiro-vivo'; // base sem proteção (versões até 05/10/2026)
const VERSAO = 1;
// Campo que identifica cada registro (o lógico; fisicamente a chave é o HMAC em "k").
export const STORES = {
  meta: 'chave', contas: 'id', faturas: 'id', transacoes: 'id', categorias: 'nome',
  regras: 'id', importacoes: 'id', arquivos: 'hash', origens: 'fp', lixeira: 'id',
  copias: 'id', conflitos: 'id',
};
// Lojas que ficam só neste aparelho e não vão para o arquivo de backup.
export const SO_LOCAIS = ['copias', 'conflitos'];
// Dados que vão para o cofre sincronizado. meta fica só no aparelho (configurações).
export const SINCRONIZADOS = ['contas', 'faturas', 'transacoes', 'categorias', 'regras', 'importacoes', 'arquivos', 'origens', 'lixeira'];
let aoGravar = null;
let relogio = 0;
export const ajustarRelogio = ms => { if (ms > relogio) relogio = ms; };
const marca = () => { relogio = Math.max(Date.now(), relogio + 1); return relogio; };
export const quandoGravar = f => { aoGravar = f; };

// ---------- chaves da sessão (só existem com o painel desbloqueado) ----------
let K = null; // { aes: CryptoKey, hmac: CryptoKey }
const cacheK = new Map();
export const destravado = () => !!K;
export async function usarChaves(material) { // material: 64 bytes (32 AES + 32 HMAC); é zerado depois
  const aes = await crypto.subtle.importKey('raw', material.slice(0, 32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const hmac = await crypto.subtle.importKey('raw', material.slice(32, 64), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  material.fill(0); K = { aes, hmac }; cacheK.clear();
}
export function esquecerChaves() { K = null; cacheK.clear(); }
const semChave = () => { const e = new Error('Painel bloqueado.'); e.bloqueado = true; return e; };
const enc = new TextEncoder(), dec = new TextDecoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
async function hk(store, chave) {
  if (!K) throw semChave();
  const id = store + '\u0000' + String(chave);
  let h = cacheK.get(id);
  if (!h) { h = hex(await crypto.subtle.sign('HMAC', K.hmac, enc.encode(id))); cacheK.set(id, h); }
  return h;
}
async function cifrarReg(store, obj) {
  const k = await hk(store, obj[STORES[store]]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(store + '|' + k) }, K.aes, enc.encode(JSON.stringify(obj)));
  return { k, iv, ct };
}
async function decifrarReg(store, r) {
  if (!K) throw semChave();
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: r.iv, additionalData: enc.encode(store + '|' + r.k) }, K.aes, r.ct);
  return JSON.parse(dec.decode(pt));
}

// ---------- abertura ----------
let _db = null;
export function abrir() {
  if (_db) return Promise.resolve(_db);
  return new Promise((ok, err) => {
    const rq = indexedDB.open(NOME, VERSAO);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('cofre')) db.createObjectStore('cofre', { keyPath: 'chave' });
      for (const s of Object.keys(STORES)) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'k' });
    };
    rq.onsuccess = () => { _db = rq.result; _db.onversionchange = () => { _db.close(); _db = null; }; ok(_db); };
    rq.onerror = () => err(rq.error);
    rq.onblocked = () => err(new Error('Feche outras abas do painel e recarregue.'));
  });
}
const p = rq => new Promise((ok, err) => { rq.onsuccess = () => ok(rq.result); rq.onerror = () => err(rq.error); });

// Configuração da proteção (não cifrada: sal, chaves embrulhadas, tentativas). Não contém senha nem dados.
export async function lerProtecao() { const db = await abrir(); return p(db.transaction('cofre').objectStore('cofre').get('protecao')); }
export async function gravarProtecao(cfg) { const db = await abrir(); return p(db.transaction('cofre', 'readwrite').objectStore('cofre').put({ ...cfg, chave: 'protecao' })); }

export async function todos(store) {
  const db = await abrir(); if (!K) throw semChave();
  const rs = await p(db.transaction(store).objectStore(store).getAll());
  return Promise.all(rs.map(r => decifrarReg(store, r)));
}
export async function um(store, key) {
  const db = await abrir(); const k = await hk(store, key);
  const r = await p(db.transaction(store).objectStore(store).get(k));
  return r ? decifrarReg(store, r) : undefined;
}
async function escrever(fisicos, limpar = []) {
  const db = await abrir();
  const stores = [...new Set([...fisicos.map(o => o.store), ...limpar])];
  if (!stores.length) return;
  await new Promise((ok, err) => {
    const tx = db.transaction(stores, 'readwrite');
    for (const s of limpar) tx.objectStore(s).clear();
    for (const o of fisicos) { const s = tx.objectStore(o.store); if ('put' in o) s.put(o.put); else s.delete(o.del); }
    tx.oncomplete = () => ok(); tx.onerror = () => err(tx.error); tx.onabort = () => err(tx.error || new Error('Gravação cancelada'));
  });
}
// Cifra antes de abrir a transação (o IndexedDB não espera operações assíncronas no meio dela).
async function fisicos(ops) {
  return Promise.all(ops.map(async o => 'put' in o ? { store: o.store, put: await cifrarReg(o.store, o.put) } : { store: o.store, del: await hk(o.store, o.del) }));
}

// Grava várias alterações de uma vez, tudo ou nada.
// ops: [{store, put: obj} | {store, del: chave}]
// Cada registro gravado recebe _mod (quando foi alterado) e cada exclusão deixa um registro na lixeira:
// é assim que dois aparelhos sabem qual versão é a mais nova ao sincronizar.
// opc.carimbar=false mantém o _mod que veio (restaurar backup, dados validados, sincronização).
export async function gravar(ops, opc = {}) {
  if (!K) throw semChave();
  const carimbar = opc.carimbar !== false, agora = marca();
  // Recriar algo que já foi excluído (ex.: reimportar um arquivo depois de desfazer a importação) precisa ser
  // explícito: o registro ganha _revive e a exclusão antiga deixa de valer para ele.
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
  if (!fin.length) return;
  await escrever(await fisicos(fin));
  if (carimbar && aoGravar && fin.some(o => o.store !== 'meta' && !SO_LOCAIS.includes(o.store))) aoGravar();
}
// Troca o conteúdo das lojas sincronizadas pelo resultado da mescla, numa única transação.
export async function substituir(dados) {
  const ops = []; for (const s of SINCRONIZADOS) for (const r of dados[s] || []) ops.push({ store: s, put: r });
  await escrever(await fisicos(ops), SINCRONIZADOS);
}
// Limpa a base, mas mantém as cópias automáticas e o registro de conflitos (rede de segurança).
export async function limparTudo() { if (!K) throw semChave(); await escrever([], Object.keys(STORES).filter(s => !SO_LOCAIS.includes(s))); }
export async function exportar() { const out = {}; for (const s of Object.keys(STORES)) if (!SO_LOCAIS.includes(s)) out[s] = await todos(s); return out; }

// Cópia automática de segurança, guardada (cifrada) neste aparelho. Guarda as últimas 8.
export async function copiaDeSeguranca(motivo) {
  const dados = await exportar(); dados.meta = (dados.meta || []).filter(m => m.chave !== 'sync');
  const c = { id: 'c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), em: new Date().toISOString(), motivo, n: (dados.transacoes || []).length, dados };
  const antigas = (await todos('copias')).sort((a, b) => a.em.localeCompare(b.em));
  await gravar([{ store: 'copias', put: c }, ...antigas.slice(0, Math.max(0, antigas.length - 7)).map(x => ({ store: 'copias', del: x.id }))]);
  return c;
}
export async function restaurar(dados) {
  await limparTudo();
  const ops = []; for (const s of Object.keys(STORES)) for (const o of (dados[s] || [])) ops.push({ store: s, put: o });
  for (let i = 0; i < ops.length; i += 2000) await gravar(ops.slice(i, i + 2000), { carimbar: false });
}
export async function persistir() { try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; } }

// ---------- base antiga, sem proteção ----------
// Lê a base antiga só para migrar. Nunca grava nela. Devolve null se ela não existir ou estiver vazia.
export async function lerBaseAntiga() {
  if (indexedDB.databases) { const ls = await indexedDB.databases(); if (!ls.some(d => d.name === NOME_ANTIGO)) return null; }
  const db = await new Promise((ok, err) => { const rq = indexedDB.open(NOME_ANTIGO); rq.onsuccess = () => ok(rq.result); rq.onerror = () => err(rq.error); rq.onupgradeneeded = () => {}; });
  const nomes = [...db.objectStoreNames];
  const out = {};
  for (const s of nomes) out[s] = await p(db.transaction(s).objectStore(s).getAll());
  db.close();
  const total = nomes.reduce((a, s) => a + out[s].length, 0);
  if (!total) { await apagarBaseAntiga(); return null; }
  return out;
}
export function apagarBaseAntiga() { return new Promise(ok => { const rq = indexedDB.deleteDatabase(NOME_ANTIGO); rq.onsuccess = rq.onerror = rq.onblocked = () => ok(); }); }
// Apaga a base protegida inteira deste aparelho (só por pedido explícito, na tela "sem senha e sem código").
export function apagarBaseProtegida() { if (_db) { _db.close(); _db = null; } esquecerChaves(); return new Promise(ok => { const rq = indexedDB.deleteDatabase(NOME); rq.onsuccess = rq.onerror = rq.onblocked = () => ok(); }); }
