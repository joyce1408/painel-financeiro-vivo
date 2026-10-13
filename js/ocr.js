// Leitura de fotos de fatura (OCR) no próprio aparelho.
//
// Biblioteca: Tesseract.js 5.1.1 (Apache 2.0). Não vem junto do painel: é baixada de cdn.jsdelivr.net na
// primeira vez, só depois do seu consentimento (≈ 5,5 MB: programa + leitor + dicionário de português).
// A foto nunca sai do aparelho: o reconhecimento roda num processo separado (Web Worker) do próprio navegador.
// Versão fixa e verificada: o arquivo principal tem a impressão SHA-256 conferida pelo navegador (SRI);
// a política de segurança do site só permite carregar estes caminhos exatos do CDN.
export const OCR = {
  versao: '5.1.1',
  script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  sri: 'sha256-qOKZGNCYsrBuEBK9rv+0rsBEXF1WVHCQI+C9H0QqgOg=',
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
  corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
  langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/por@1.0.0/4.0.0_best_int',
  tamanhoMB: 5.5,
};

// ---------- imagem ----------
// Abre JPG/PNG/WebP (e HEIC onde o navegador decodifica: Safari). Corrige a rotação da câmera, reduz fotos
// grandes, amplia prints pequenos e aumenta o contraste. Nada é gravado: a imagem só existe na memória.
export async function prepararImagem(file) {
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const heic = /hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name || '');
    throw new Error(heic ? 'Este navegador não abre fotos HEIC. No iPhone, escolha a foto pela galeria do próprio Safari (ele converte para JPG) ou ajuste Ajustes › Câmera › Formatos › Mais Compatível.' : 'Não foi possível abrir esta imagem. Use JPG ou PNG.');
  }
  const maior = Math.max(bmp.width, bmp.height), menor = Math.min(bmp.width, bmp.height);
  let esc = 1; if (maior > 2600) esc = 2600 / maior; else if (menor < 900) esc = Math.min(2.5, 1100 / menor);
  const w = Math.round(bmp.width * esc), h = Math.round(bmp.height * esc);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, w, h); bmp.close && bmp.close();
  // tons de cinza + esticar o contraste (ignorando 1% dos extremos); telas escuras são invertidas
  const img = g.getImageData(0, 0, w, h), d = img.data, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
  const tot = w * h; let a = 0, lo = 0, hi = 255; for (; lo < 255 && (a += hist[lo]) < tot * 0.01; lo++); a = 0; for (; hi > 0 && (a += hist[hi]) < tot * 0.01; hi--);
  let media = 0; for (let v = 0; v < 256; v++) media += v * hist[v]; media /= tot;
  const inv = media < 110, faixa = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) { let y = Math.max(0, Math.min(255, (d[i] - lo) * 255 / faixa)); if (inv) y = 255 - y; d[i] = d[i + 1] = d[i + 2] = y; }
  g.putImageData(img, 0, 0);
  const legivel = hi - lo > 40 && w * h > 200000;
  return { canvas: cv, largura: w, altura: h, contrasteBaixo: !legivel };
}

// PDF escaneado (sem texto): transforma cada página em imagem, com o pdf.js que já vem no painel.
export async function paginasDoPDF(buffer, max = 8) {
  const pdfjs = await import(new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url).href);
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let n = 1; n <= Math.min(doc.numPages, max); n++) {
    const pg = await doc.getPage(n), vp = pg.getViewport({ scale: 2.2 });
    const cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
    await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
    out.push(await new Promise(ok => cv.toBlob(ok, 'image/png')));
  }
  await doc.destroy();
  return out;
}

// ---------- Tesseract.js ----------
let carregando = null, worker = null;
function carregarScript() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (carregando) return carregando;
  carregando = new Promise((ok, err) => {
    const s = document.createElement('script');
    s.src = OCR.script; s.integrity = OCR.sri; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
    s.onload = () => window.Tesseract ? ok(window.Tesseract) : err(new Error('Leitor de texto não carregou.'));
    s.onerror = () => { carregando = null; err(new Error('Não foi possível baixar o leitor de texto (sem internet, ou o arquivo do CDN não conferiu com a versão esperada).')); };
    document.head.appendChild(s);
  });
  return carregando;
}
export async function lerTexto(imagem, aoProgresso = () => {}) {
  const T = await carregarScript();
  if (!worker) {
    worker = await T.createWorker('por', 1, {
      workerPath: OCR.workerPath, corePath: OCR.corePath, langPath: OCR.langPath, gzip: true,
      logger: m => { if (m && typeof m.progress === 'number') aoProgresso(m.status, m.progress); },
    });
    await worker.setParameters({ preserve_interword_spaces: '1', tessedit_pageseg_mode: '6' });
  }
  const { data } = await worker.recognize(imagem);
  const linhas = (data.lines || []).map(l => ({ texto: l.text.replace(/\s+$/, ''), conf: l.confidence }));
  return { texto: data.text || '', confianca: data.confidence ?? null, linhas };
}
export async function encerrarOCR() { if (worker) { await worker.terminate(); worker = null; } }
