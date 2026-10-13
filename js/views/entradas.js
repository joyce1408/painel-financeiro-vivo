// Entradas: só dinheiro novo (salário, restituição, Nota Fiscal Paulista...). Resgate e transferência não são entrada.
import { brl, mLabel, sum } from '../utils.js';
import { entradas, agrupar } from '../calc.js';
import { kpis, painel, baterias, barrasH, tabelaTx, secao } from '../ui.js';

export const titulo = 'Entradas';
export function render({ B, s, meses }) {
  const tx = B.transacoes;
  const E = entradas(tx, s), tot = sum(E);
  const EM = entradas(tx, s, { mes: true });
  const porMes = meses.map(m => sum(EM.filter(t => t.mes === m)));
  const comDados = porMes.filter(v => v > 0);
  const fontes = agrupar(E, t => t.sub, t => t.valor);
  const pend = tx.filter(t => t.status === 'pendente' && t.valor > 0);
  return kpis([
    { l: 'Entradas no período', v: brl(tot), s: s.mes ? mLabel(s.mes) : s.ano || 'todo o período', c: 'g' },
    { l: 'Média por mês', v: brl(comDados.length ? comDados.reduce((a, b) => a + b, 0) / comDados.length : 0), s: `${comDados.length} mês(es) com entrada no ano` },
    { l: 'Maior fonte', v: fontes[0] ? fontes[0].k : '—', s: fontes[0] ? brl(fontes[0].v) : '' },
    { l: 'Entradas pendentes', v: String(pend.length), s: pend.length ? 'créditos sem origem identificada' : 'nenhuma', c: 'n', go: pend.length ? 'pendencias' : '' },
  ], 'k4')
  + `<p class="note" style="margin-top:-8px">Entradas não têm categoria, forma de pagamento nem cartão: esses filtros não se aplicam aqui. Resgates da poupança, transferências entre suas contas e reembolsos recebidos não contam como entrada.</p>`
  + `<div class="grid">${painel('Entradas por mês', baterias(meses, porMes, s.mes), 'c7')}${painel('De onde veio', barrasH(fontes), 'c5')}</div>`
  + secao('ent', 'Lançamentos de entrada', `${E.length} no filtro`, tabelaTx(E, { cols: ['data', 'desc', 'valor', 'conta', 'sub', 'status'], ordem: 'desc' }), true);
}
