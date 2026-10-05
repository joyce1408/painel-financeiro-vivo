// Service worker: guarda o próprio painel no aparelho para abrir sem internet.
// Só arquivos do app; seus dados ficam no IndexedDB e nunca passam por aqui.
const VERSAO = 'painel-vivo-v3';
// data/ (seus dados) nunca entra no cache do código.
const ARQUIVOS = ['./', "./css/app.css","./icons/icon-180.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./js/app.js","./js/calc.js","./js/classify.js","./js/db.js","./js/fingerprint.js","./js/importer.js","./js/insights.js","./js/parsers/bb.js","./js/parsers/index.js","./js/parsers/nubank.js","./js/pdftext.js","./js/store.js","./js/sync.js","./js/ui.js","./js/utils.js","./js/views/backup.js","./js/views/categorias.js","./js/views/classificar.js","./js/views/credito.js","./js/views/debito.js","./js/views/entradas.js","./js/views/faturas.js","./js/views/importar.js","./js/views/parcelamentos.js","./js/views/pendencias.js","./js/views/saidas.js","./js/views/sincronizar.js","./js/views/tarifas.js","./js/views/visao.js","./manifest.webmanifest","./vendor/pdfjs/LICENSE","./vendor/pdfjs/pdf.min.mjs","./vendor/pdfjs/pdf.worker.min.mjs"];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Rede primeiro (para pegar atualizações do código); sem internet, usa a cópia guardada.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/data/')) return; // Supabase (outra origem) também passa direto
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSAO).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
