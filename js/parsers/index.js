// Registro dos leitores de arquivo. Para um banco novo: crie js/parsers/<banco>.js com
// detectar(texto) → 'csv' | 'pdf' | null, lerCSV(texto) e/ou lerPDF(linhas), e acrescente aqui.
import * as bb from './bb.js';
import * as nubank from './nubank.js';

export const LEITORES = [bb, nubank];

export const SUPORTADOS = [
  'Banco do Brasil: extrato em CSV ou PDF (leitura exata, com conferência de saldo)',
  'Nubank: fatura em PDF (leitura exata, com conferência de total)',
  'Qualquer outro banco ou cartão: PDF com texto, CSV (inclusive o do app do Nubank) e OFX, por leitura genérica com conferência antes de importar',
  'Foto ou print de fatura/extrato (JPG, PNG; HEIC no Safari) e PDF escaneado: leitura por OCR ou Texto ao Vivo, sempre com revisão antes de importar',
];
export const NAO_SUPORTADOS = [
  'Planilha Excel/Numbers (.xlsx, .xls, .numbers): salve ou exporte como CSV.',
];

export function identificar(texto) {
  for (const L of LEITORES) { const f = L.detectar(texto); if (f) return { leitor: L, formato: f }; }
  return null;
}
