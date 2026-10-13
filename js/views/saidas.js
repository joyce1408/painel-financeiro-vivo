// Saídas: tudo o que saiu, separando consumo (gastos) do que não é gasto.
import { brl, sum } from '../utils.js';
import { gastos, totalGasto, casa, MOV } from '../calc.js';
import { kpis, tabelaTx, secao, bloco, vazio, plural, drill } from '../ui.js';

export const titulo = 'Saídas';
const GRUPOS = [
  ['fatura', 'Pagamentos de fatura', 'Pix e pagamentos que quitam a fatura do cartão. As compras da fatura já estão nos gastos, uma a uma; o pagamento não cria novo gasto.'],
  ['transferencia', 'Transferências entre suas contas', 'Dinheiro que muda de conta, mas continua seu. Não é gasto nem renda.'],
  ['aplicacao', 'Aplicações na poupança', 'Dinheiro guardado. Não é gasto.'],
  ['resgate', 'Resgates da poupança', 'Dinheiro que já era seu voltando para a conta. Não é renda nova.'],
  ['reembolso', 'Reembolsos', 'Valores que voltam ou são repassados por reembolso. Ficam fora dos gastos.'],
];
let lim = 60;
export function render({ B, s }) {
  const tx = B.transacoes;
  const G = gastos(tx, s);
  const nc = tx.filter(t => t.mov !== 'gasto' && t.mov !== 'entrada' && casa(t, s, { cat: true, forma: true, cartao: true }));
  const out = m => -sum(nc.filter(t => t.mov === m && t.valor < 0));
  const todos = tx.filter(t => casa(t, s));
  return kpis([
    { l: 'Gastos (consumo)', v: brl(totalGasto(G)), s: plural(G.length, 'lançamento'), c: 'rose' },
    { l: 'Pagamentos de fatura', v: brl(out('fatura')), s: 'não é gasto: as compras já contam', c: 'n' },
    { l: 'Transferências', v: brl(out('transferencia')), s: 'entre suas contas', c: 'n' },
    { l: 'Aplicado na poupança', v: brl(out('aplicacao')), s: 'dinheiro guardado', c: 'g' },
    { l: 'Reembolsos enviados', v: brl(out('reembolso')), s: 'fora dos gastos', c: 'n' },
  ])
  + `<section style="display:grid;gap:10px"><h2>Gastos <small>categoria › tipo de gasto › lançamento</small></h2>${drill(G, B, { auto: !!(s.busca || s.cat) })}</section>`
  + secao('nc', 'Movimentações que não são gastos', plural(nc.length, 'lançamento') + ', fora dos gastos',
    GRUPOS.map(([m, n, d]) => { const xs = nc.filter(t => t.mov === m); if (!xs.length) return ''; const o = -sum(xs.filter(t => t.valor < 0)), i = sum(xs.filter(t => t.valor > 0));
      return bloco('nc:' + m, n, plural(xs.length, 'lançamento') + (o && i ? ` · saiu ${brl(o)} · entrou ${brl(i)}` : ''), brl(o || i), `<p class="note" style="padding:8px 0">${d}</p>${tabelaTx(xs, { cols: ['data', 'desc', 'valor', 'conta', 'sub', 'status'] })}`); }).join('') || vazio('Nenhuma movimentação com esses filtros.'))
  + secao('todos', 'Todos os lançamentos', `${todos.length} no filtro (gastos, entradas e movimentações)`, tabelaTx(todos, { cols: ['data', 'desc', 'valor', 'conta', 'mov', 'cat', 'sub', 'status'], ordem: 'desc', limite: lim, id: 'todos' }), !!s.busca);
}
export function mais(id) { if (id === 'todos') lim += 100; }
export { MOV };
