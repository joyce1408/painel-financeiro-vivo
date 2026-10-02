// Impressão digital estável de cada lançamento de origem.
// conta | cartão (4 dígitos) | data | valor em centavos | ordem entre lançamentos idênticos no mesmo arquivo.
// Reimportar o mesmo extrato ou fatura (em PDF ou CSV) gera exatamente as mesmas impressões.
import { cents } from './utils.js';

export function carimbar(linhas, conta) {
  const seen = {};
  return linhas.map(l => {
    const base = `${conta}|${l.cartao4 || ''}|${l.data}|${cents(l.valor)}`;
    const n = (seen[base] = (seen[base] || 0) + 1);
    return { ...l, fp: base + '|' + n };
  });
}
