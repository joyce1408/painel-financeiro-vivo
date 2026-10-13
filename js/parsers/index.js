// Registro dos leitores de arquivo. Para um banco novo: crie js/parsers/<banco>.js com
// detectar(texto) → 'csv' | 'pdf' | null, lerCSV(texto) e/ou lerPDF(linhas), e acrescente aqui.
import * as bb from './bb.js';
import * as nubank from './nubank.js';

export const LEITORES = [bb, nubank];

export const SUPORTADOS = [
  'Banco do Brasil: extrato de conta corrente em CSV ou PDF',
  'Nubank: fatura do cartão de crédito em PDF',
  'Foto ou print de fatura/extrato (JPG, PNG; HEIC no Safari) e PDF escaneado: leitura por OCR ou Texto ao Vivo, sempre com revisão antes de importar',
];
export const NAO_SUPORTADOS = [
  'Cartão Porto: os prints agora podem ser lidos por foto (revisão obrigatória). Se uma cobrança do cartão já entrou por outro caminho (ex.: Pix), a revisão marca como possível duplicata.',
  'OFX e Excel: ainda sem leitor. Envie um exemplo para o Claude criar o leitor.',
];

export function identificar(texto) {
  for (const L of LEITORES) { const f = L.detectar(texto); if (f) return { leitor: L, formato: f }; }
  return null;
}
