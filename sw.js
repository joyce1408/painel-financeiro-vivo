// Service worker: guarda o próprio painel no aparelho para abrir sem internet.
// Só arquivos do app; seus dados ficam no IndexedDB e nunca passam por aqui.
const VERSAO = 'painel-vivo-v6';
// data/ (seus dados) nunca entra no cache do código.
const ARQUIVOS = ['./', "./css/app.css","./icons/icon-180.png","./icons/icon-192.png","./icons/icon-512.png","./icons/icon-maskable-512.png","./icons/icon.svg","./index.html","./js/app.js","./js/calc.js","./js/classify.js","./js/db.js","./js/fingerprint.js","./js/importer.js","./js/insights.js","./js/ocr.js","./js/parsers/bb.js","./js/parsers/index.js","./js/parsers/nubank.js","./js/parsers/texto-fatura.js","./js/pdftext.js","./js/protecao.js","./js/store.js","./js/sync.js","./js/trava.js","./js/ui.js","./js/utils.js","./js/views/arquivo-backup.js","./js/views/backup.js","./js/views/categorias.js","./js/views/classificar.js","./js/views/credito.js","./js/views/debito.js","./js/views/entradas.js","./js/views/faturas.js","./js/views/foto.js","./js/views/importar.js","./js/views/parcelamentos.js","./js/views/pendencias.js","./js/views/saidas.js","./js/views/seguranca.js","./js/views/sincronizar.js","./js/views/tarifas.js","./js/views/visao.js","./manifest.webmanifest","./vendor/pdfjs/LICENSE","./vendor/pdfjs/pdf.min.mjs","./vendor/pdfjs/pdf.worker.min.mjs"];
self.addEventListener('install', e => e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSAO && !k.startsWith('painel-ocr-')).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Rede primeiro (para pegar atualizações do código); sem internet, usa a cópia guardada.
// Leitor de texto (OCR), só nas versões fixas: guardado no aparelho depois do primeiro uso, para funcionar sem internet.
const OCR_PREFIXOS = ['https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/', 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/', 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/'];
self.addEventListener('fetch', e => {
  if (e.request.method === 'GET' && OCR_PREFIXOS.some(p => e.request.url.startsWith(p))) {
    e.respondWith(caches.open('painel-ocr-5.1.1').then(c => c.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.includes('/data/')) return; // Supabase (outra origem) também passa direto
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSAO).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
