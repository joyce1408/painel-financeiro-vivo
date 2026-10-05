// Crédito: compras no cartão, por cartão de origem.
import { brl, pct, esc } from '../utils.js';
import { gastos, totalGasto, agrupar } from '../calc.js';
import { kpis, painel, barrasH, mini, tabelaTx, secao, bloco, vazio, plural, baterias } from '../ui.js';

export const titulo = 'Crédito';
export function render({ B, s, meses }) {
  const tx = B.transacoes;
  const sc = { ...s, forma: 'Crédito' };
  const G = gastos(tx, sc), tot = totalGasto(G);
  const parc = G.filter(t => t.parcela), av = G.filter(t => !t.parcela);
  const porCartao = agrupar(G, t => t.cartao || 'Sem cartão');
  const GM = gastos(tx, sc, { mes: true });
  return kpis([
    { l: 'Gastos no crédito', v: brl(tot), s: plural(G.length, 'compra'), c: 'rose' },
    { l: 'À vista', v: brl(totalGasto(av)), s: pct(totalGasto(av) / (tot || 1) * 100) },
    { l: 'Parcelas cobradas', v: brl(totalGasto(parc)), s: `${pct(totalGasto(parc) / (tot || 1) * 100)} · futuras em Parcelamentos`, go: 'parcelamentos' },
    { l: 'Cartões', v: String(porCartao.length), s: porCartao.map(c => c.k.replace(/^\w+ /, '')).join(' · ') },
  ], 'k4')
  + (s.forma && s.forma !== 'Crédito' ? `<div class="banner">O filtro de forma de pagamento está em “${esc(s.forma)}”; esta tela mostra sempre o crédito.</div>` : '')
  + `<div class="grid">${painel('Crédito por mês', baterias(meses, meses.map(m => totalGasto(GM.filter(t => t.mes === m))), s.mes), 'c7')}
    ${painel('Por cartão', porCartao.length ? `<div class="accs">${porCartao.map(c => bloco('cc:' + c.k, c.k, `${plural(c.n, 'compra')} · ${pct(c.v / (tot || 1) * 100)}`, brl(c.v), `<div style="padding:8px 0;display:grid;gap:8px"><h3 style="margin:0;font-size:.68rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)">Com o que foi gasto</h3>${mini(agrupar(c.xs, t => t.cat), c.v)}</div>`)).join('')}</div>` : vazio(), 'c5')}
    ${painel('Crédito por categoria', barrasH(agrupar(G, t => t.cat), 'cat', s.cat), 'c12')}</div>`
  + secao('cred', 'Compras no crédito', `${G.length} no filtro`, tabelaTx(G, { cols: ['data', 'desc', 'valor', 'cartao', 'parcela', 'cat', 'sub', 'status'], ordem: 'desc' }), !!s.busca);
}
