// Cálculos: tudo sai daqui, a partir da base de lançamentos.
import { sum, cents, norm, addMes } from './utils.js';

export const CONTAS = { BB: 'Banco do Brasil', Nu: 'Nubank', Porto: 'Cartão Porto' };
export const MOV = { gasto: 'Gasto', entrada: 'Entrada', transferencia: 'Transferência entre contas', fatura: 'Pagamento de fatura', aplicacao: 'Aplicação na poupança', resgate: 'Resgate da poupança', reembolso: 'Reembolso' };
export const MOVS = [['despesa', 'gasto'], ['receita', 'entrada'], ['interna', 'transferencia'], ['interna', 'fatura'], ['investimento', 'aplicacao'], ['investimento', 'resgate'], ['reembolso', 'reembolso']];
export const FORMAS_DEBITO = ['Débito', 'Pix', 'Débito automático', 'Débito em conta (guias e tarifas)'];

// Função central: só despesa real entra em gastos.
export const entraEmGastos = t => t.tipo === 'despesa' && t.mov === 'gasto';
export const ehEntrada = t => t.tipo === 'receita' && t.mov === 'entrada';
export const cartaoDe = t => t.cartao || 'Sem cartão';
export const ano = t => t.mes.slice(0, 4);

export function anos(tx) { return [...new Set(tx.map(ano))].sort(); }
export function mesesDoAno(tx, a) { return [...new Set(tx.filter(t => ano(t) === a).map(t => t.mes))].sort(); }

// Filtro global. "ignore" deixa um gráfico mostrar o todo de uma dimensão (ex.: todas as contas).
export function casa(t, s, ig = {}) {
  if (!ig.ano && s.ano && ano(t) !== s.ano) return false;
  if (!ig.mes && s.mes && t.mes !== s.mes) return false;
  if (!ig.conta && s.conta && t.conta !== s.conta) return false;
  if (!ig.cat && s.cat && t.cat !== s.cat) return false;
  if (!ig.forma && s.forma && t.forma !== s.forma) return false;
  if (!ig.cartao && s.cartao && cartaoDe(t) !== s.cartao) return false;
  if (s.busca) { const q = norm(s.busca); if (!norm([t.desc, t.descOriginal, t.cat, t.sub, t.obs, t.forma, t.cartao, MOV[t.mov]].join(' ')).includes(q)) return false; }
  return true;
}
export const gastos = (tx, s, ig) => tx.filter(t => entraEmGastos(t) && casa(t, s, ig));
// Entradas não têm categoria, forma nem cartão: só período, conta e busca valem para elas.
export const entradas = (tx, s, ig = {}) => tx.filter(t => ehEntrada(t) && casa(t, { ...s, cat: '', forma: '', cartao: '' }, ig));
export const parcial = s => !!(s.cat || s.busca || s.forma || s.cartao || (s.conta && s.conta !== 'BB'));
export const totalGasto = xs => sum(xs, t => -t.valor);

export function agrupar(xs, f, val = t => -t.valor) {
  const o = new Map();
  for (const t of xs) { const k = f(t); const e = o.get(k) || { k, v: 0, n: 0, xs: [] }; e.v += cents(val(t)); e.n++; e.xs.push(t); o.set(k, e); }
  return [...o.values()].map(e => ({ ...e, v: e.v / 100 })).sort((a, b) => b.v - a.v);
}

// Parcelamentos: só com as parcelas que existem na base. Futuras = as que ainda faltam depois da última cobrada.
export function parcelamentos(tx) {
  const P = new Map();
  for (const t of tx) {
    if (!t.parcela || !entraEmGastos(t)) continue;
    const m = t.parcela.match(/(\d+)\s*\/\s*(\d+)/); if (!m) continue;
    const nome = t.desc.replace(/\s*-?\s*Parcela.*$/i, '').trim();
    const k = t.conta + '|' + nome + '|' + m[2] + '|' + cents(t.valor);
    const e = P.get(k) || { nome, conta: t.conta, cartao: t.cartao, n: +m[2], valor: -t.valor, cat: t.cat, sub: t.sub, pagas: [] };
    e.pagas.push({ num: +m[1], data: t.data, mes: t.mes, id: t.id }); P.set(k, e);
  }
  return [...P.values()].map(p => {
    p.pagas.sort((a, b) => a.num - b.num);
    const ult = p.pagas[p.pagas.length - 1], pri = p.pagas[0];
    const inicio = addMes(pri.data.slice(0, 7), -(pri.num - 1)), termino = addMes(ult.data.slice(0, 7), p.n - ult.num);
    const futuras = []; for (let i = ult.num + 1; i <= p.n; i++) futuras.push({ num: i, mes: addMes(ult.data.slice(0, 7), i - ult.num), valor: p.valor });
    return { ...p, atual: ult.num, inicio, termino, futuras, totalFuturo: Math.round(futuras.length * p.valor * 100) / 100, ativo: futuras.length > 0 };
  }).sort((a, b) => (b.ativo - a.ativo) || b.totalFuturo - a.totalFuturo || b.n * b.valor - a.n * a.valor);
}

// Resumo por mês de um ano: entrou, gastos, resultado e movimentações técnicas.
export function resumoMensal(tx, s, meses) {
  const mv = (m, k) => sum(tx.filter(t => t.mes === m && t.mov === k && (!s.conta || t.conta === s.conta)));
  return meses.map(m => {
    const e = sum(entradas(tx, { ...s, mes: m }));
    const g = totalGasto(gastos(tx, { ...s, mes: m }));
    return { m, e, g, r: Math.round((e - g) * 100) / 100, ap: -mv(m, 'aplicacao'), rs: mv(m, 'resgate'), tr: -mv(m, 'transferencia'), fa: -mv(m, 'fatura') };
  });
}
