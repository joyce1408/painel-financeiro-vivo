// Tarifas, juros e IOF: o custo de usar o banco.
import { brl, mLabel } from '../utils.js';
import { gastos, totalGasto, agrupar } from '../calc.js';
import { kpis, painel, barrasH, tabelaTx, secao, baterias, vazio } from '../ui.js';

export const titulo = 'Tarifas';
export const ehTarifa = t => t.cat === 'Financeiro' || /tarifa|juros|iof|anuidade|multa/i.test(t.sub || '');
export function render({ B, s, meses }) {
  const tx = B.transacoes;
  const G = gastos(tx, s).filter(ehTarifa), tot = totalGasto(G);
  const GM = gastos(tx, s, { mes: true }).filter(ehTarifa);
  const porMes = meses.map(m => totalGasto(GM.filter(t => t.mes === m)));
  const comDado = meses.filter((m, i) => tx.some(t => t.mes === m));
  const media = comDado.length ? porMes.reduce((a, b) => a + b, 0) / comDado.length : 0;
  const tipos = agrupar(G, t => t.sub);
  const juros = tipos.filter(t => /juros|iof/i.test(t.k));
  return kpis([
    { l: 'Tarifas, juros e IOF', v: brl(tot), s: s.mes ? mLabel(s.mes) : s.ano || 'todo o período', c: 'rose' },
    { l: 'Média por mês', v: brl(media), s: `nos ${comDado.length} meses com dados do ano` },
    { l: 'No ritmo atual, por ano', v: brl(media * 12), s: 'média mensal × 12 (estimativa)' },
    { l: 'Juros e IOF', v: brl(juros.reduce((a, j) => a + j.v, 0)), s: 'cheque especial e similares' },
  ], 'k4')
  + (juros.length ? `<div class="banner">Juros e IOF aparecem quando a conta fica negativa (cheque especial). Manter um pequeno saldo no fim do mês evita esse custo.</div>` : '')
  + `<div class="grid">${painel('Por mês', baterias(meses, porMes, s.mes), 'c7')}${painel('Por tipo', tipos.length ? barrasH(tipos) : vazio('Nenhuma tarifa no filtro.'), 'c5')}</div>`
  + secao('tar', 'Lançamentos', `${G.length} no filtro`, tabelaTx(G, { cols: ['data', 'desc', 'valor', 'conta', 'sub', 'status'], ordem: 'desc' }), true);
}
