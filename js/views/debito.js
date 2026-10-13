// Débito: gastos que saíram direto da conta (débito, Pix, débito automático, guias e tarifas).
import { brl, pct } from '../utils.js';
import { gastos, totalGasto, agrupar } from '../calc.js';
import { kpis, painel, barrasH, tabelaTx, secao, plural, baterias } from '../ui.js';

export const titulo = 'Débito';
export function render({ B, s, meses }) {
  const tx = B.transacoes;
  const ehDeb = t => t.forma !== 'Crédito';
  const G = gastos(tx, s).filter(ehDeb), tot = totalGasto(G);
  const formas = agrupar(G, t => t.forma || '—');
  const GM = gastos(tx, s, { mes: true }).filter(ehDeb);
  return kpis([
    { l: 'Gastos fora do cartão', v: brl(tot), s: plural(G.length, 'lançamento'), c: 'rose' },
    ...formas.slice(0, 3).map(f => ({ l: f.k, v: brl(f.v), s: `${plural(f.n, 'lançamento')} · ${pct(f.v / (tot || 1) * 100)}` })),
  ], formas.length >= 3 ? 'k4' : '')
  + (s.forma === 'Crédito' ? `<div class="banner">O filtro de forma de pagamento está em “Crédito”; aqui só entram débito, Pix e débitos em conta.</div>` : '')
  + `<div class="grid">${painel('Débito e Pix por mês', baterias(meses, meses.map(m => totalGasto(GM.filter(t => t.mes === m))), s.mes), 'c7')}
    ${painel('Como foi pago', barrasH(formas, 'forma', s.forma), 'c5', 'toque para filtrar')}
    ${painel('Por categoria', barrasH(agrupar(G, t => t.cat), 'cat', s.cat), 'c12')}</div>`
  + secao('deb', 'Lançamentos', `${G.length} no filtro`, tabelaTx(G, { cols: ['data', 'desc', 'valor', 'forma', 'cat', 'sub', 'status'], ordem: 'desc' }), !!s.busca);
}
