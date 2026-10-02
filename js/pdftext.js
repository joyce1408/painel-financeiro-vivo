// Extrai o texto de um PDF, linha por linha, no próprio aparelho.
// Usa o pdf.js (Mozilla, licença Apache 2.0) que vem junto do painel em vendor/pdfjs: nada é baixado nem enviado.
let _lib = null;
async function lib() {
  if (_lib) return _lib;
  const base = new URL('../vendor/pdfjs/', import.meta.url);
  _lib = await import(new URL('pdf.min.mjs', base).href);
  if (typeof window !== 'undefined') _lib.GlobalWorkerOptions.workerSrc = new URL('pdf.worker.min.mjs', base).href;
  return _lib;
}
export function usarBiblioteca(l) { _lib = l; } // para testes em Node

// Agrupa os pedaços de texto pela altura (y) e ordena pela posição horizontal (x).
export function agruparLinhas(itens) {
  const its = itens.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str, x0: i.transform[4], x1: i.transform[4] + i.width, y: i.transform[5] }))
    .sort((a, b) => b.y - a.y || a.x0 - b.x0);
  const linhas = [];
  for (const it of its) {
    const l = linhas[linhas.length - 1];
    if (l && Math.abs(l.y - it.y) <= 2.5) l.its.push(it); else linhas.push({ y: it.y, its: [it] });
  }
  return linhas.map(l => {
    l.its.sort((a, b) => a.x0 - b.x0);
    let s = '', px = null;
    for (const it of l.its) {
      if (px !== null) { const gap = it.x0 - px; s += gap > 12 ? '   ' : gap > 0.8 ? ' ' : ''; }
      s += it.s; px = it.x1;
    }
    return s.replace(/\s+$/, '').replace(/^\s+/, '');
  });
}

export async function linhasDoPDF(buffer) {
  const pdfjs = await lib();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    out.push(...agruparLinhas(tc.items), '--- fim da página ---');
  }
  await doc.destroy();
  return out;
}
