// Registro dos leitores de arquivo. Para um banco novo: crie js/parsers/<banco>.js com
// detectar(texto) → 'csv' | 'pdf' | null, lerCSV(texto) e/ou lerPDF(linhas), e acrescente aqui.
import * as bb from './bb.js';
import * as nubank from './nubank.js';

export const LEITORES = [bb, nubank];

export const SUPORTADOS = [
  'Banco do Brasil: extrato de conta corrente em CSV ou PDF',
  'Nubank: fatura do cartão de crédito em PDF',
];
export const NAO_SUPORTADOS = [
  'Cartão Porto: só prints (imagens). Imagens não são lidas automaticamente; a cobrança do Petlove já entra pelo Pix do Banco do Brasil. Outras compras no Porto podem ser lançadas à mão.',
  'Outros bancos e formatos (OFX, Excel, prints): ainda sem leitor. Envie um exemplo para o Claude criar o leitor.',
];

export function identificar(texto) {
  for (const L of LEITORES) { const f = L.detectar(texto); if (f) return { leitor: L, formato: f }; }
  return null;
}
