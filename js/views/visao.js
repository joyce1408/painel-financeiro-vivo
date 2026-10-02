// Visão geral: o essencial do período, com insights calculados dos seus próprios dados.
import { brl, pct, mLabel, mCurto, esc, sum, addMes, dbr } from '../utils.js';
import { gastos, entradas, totalGasto, agrupar, parcial, resumoMensal, CONTAS, anos, casa } from '../calc.js';
import { gerarInsights } from '../insights.js';
import { kpis, painel, secao, baterias, barrasH, mini, drill, abertos, TAG, plural, vazio } from '../ui.js';

export const titulo = 'Visão geral';

// Aviso de mês incompleto: quando o extrato do banco vai além do fechamento da última fatura importada.
export function avisoIncompleto(B, s) {
  const ult = B.faturas.filter(f => f.cartao === 'Nu').sort((a, b) => b.fechamento.localeCompare(a.fechamento))[0];
  const ultBB = B.transacoes.filter(t => t.fonteFp && t.fonteFp.startsWith('BB|')).map(t => t.data).sort().pop();
  if (!ult || !ultBB || ultBB <= ult.fechamento) return '';
  const mesAviso = ult.fechamento.slice(0, 7);
  if (s.mes && s.mes < mesAviso) return '';
  if (s.conta && s.conta !== 'Nu') return '';
  return `<div class="banner">As compras do Nubank feitas depois de ${dbr(ult.fechamento)} (fechamento da última fatura importada) só entram quando a próxima fatura for importada. O extrato do Banco do Brasil vai até ${dbr(ultBB)}; os Pix para a Joyce desse período aparecem como pagamento de fatura e não entram nos gastos.</div>`;
}

export function render({ B, s, meses }) {
  const tx = B.transacoes;
  const G = gastos(tx, s), E = entradas(tx, s), totG = totalGasto(G), totE = sum(E), part = parcial(s), res = Math.round((totE - totG) * 100) / 100;
  const per = s.mes ? mLabel(s.mes) : (s.ano ? s.ano : 'todo o período');
  let cmp = '';
  if (s.mes) { const P = addMes(s.mes, -1); const pg = totalGasto(gastos(tx, { ...s, mes: P, ano: '' }));
    if (pg) { const d = (totG - pg) / pg * 100; cmp = `${Math.abs(d) < 2 ? '→ estável' : d > 0 ? '⬆ ' + pct(d) : '⬇ ' + pct(-d)} vs ${mCurto(P)}`; } }
  const inv = tx.filter(t => t.tipo === 'investimento' && casa(t, { ano: s.ano, mes: s.mes, conta: s.conta }));
  const ap = -sum(inv.filter(t => t.valor < 0)), rs = sum(inv.filter(t => t.valor > 0));
  const pend = tx.filter(t => t.status === 'pendente');
  const K = kpis([
    { l: 'Entradas', v: brl(totE), s: s.conta && s.conta !== 'BB' ? 'as entradas caem só no Banco do Brasil' : `dinheiro que entrou · ${per}`, c: 'g', go: 'entradas' },
    { l: 'Gastos', v: brl(totG), s: `consumo real · ${per}${cmp ? ' · ' + cmp : ''}`, c: 'rose', go: 'saidas' },
    { l: 'Resultado', v: part ? '—' : `<span class="${res >= 0 ? 'pos' : 'neg'}">${brl(res)}</span>`, s: part ? 'não se aplica com categoria, forma, cartão, busca ou conta de cartão' : `entradas − gastos${totE ? ' · ' + pct(res / totE * 100) + ' das entradas' : ''}` },
    { l: 'Poupança (líquido)', v: `<span class="${ap - rs >= 0 ? 'pos' : 'neg'}">${brl(ap - rs)}</span>`, s: `aplicado ${brl(ap)} · resgatado ${brl(rs)}` },
    { l: 'Pendências', v: String(pend.length), s: pend.length ? `${brl(-sum(pend.filter(t => t.valor < 0)))} sem categoria segura · toque para classificar` : 'nada para revisar', c: 'n', go: 'pendencias' },
  ]);
  const notaRes = `<p class="note" style="margin-top:-8px"><b>Resultado:</b> diferença entre o que entrou e o que foi gasto. Não é saldo em conta nem valor guardado. Pagamentos de fatura, transferências entre suas contas, poupança e reembolsos não são gastos.</p>`;

  // insights
  const I = gerarInsights(tx, s);
  const itens = I.itens || [];
  const mud = itens.filter(i => i.tipo !== 'economia'), eco = itens.filter(i => i.tipo === 'economia');
  const card = i => `<div class="in-c ${i.tipo}"><b>${esc(i.titulo)}</b><p>${esc(i.texto)}</p></div>`;
  const ins = painel('O que os seus números mostram', mud.length ? `<div class="ins">${mud.map(card).join('')}</div>` : vazio('Ainda não há meses suficientes para comparar.'), 'c12', I.mes ? `referência: ${mLabel(I.mes)}` : '')
    + painel('Onde dá para economizar', eco.length ? `<div class="ins">${eco.map(card).join('')}</div>` : `<p class="note">Nenhuma categoria de gasto variável cresceu de forma consistente nos últimos 3 meses em relação aos 3 anteriores. Quando isso acontecer, aparece aqui com os valores que sustentam a sugestão.</p>`, 'c12', 'só com evidência nos seus dados');

  // gráficos
  const GM = gastos(tx, s, { mes: true });
  const porMes = meses.map(m => totalGasto(GM.filter(t => t.mes === m)));
  const GA = gastos(tx, s, { conta: true }), ta = totalGasto(GA) || 1;
  const contas = ['BB', 'Nu', 'Porto', ...new Set(GA.map(t => t.conta).filter(c => !CONTAS[c]))];
  const accs = contas.map(a => { const xs = GA.filter(t => t.conta === a); const v = totalGasto(xs); const kid = 'acc:' + a; const o = abertos.has(kid);
    return `<div class="cat ${o ? 'open' : ''} ${s.conta === a ? 'sel' : ''}" data-id="${kid}"><button type="button" class="acc-h cat-h" aria-expanded="${o}"><span class="car">▸</span><span><span class="nm">${CONTAS[a] || a}</span> <span class="tag ${TAG[a] || ''}">${pct(v / ta * 100)}</span><br><span class="mt">${plural(xs.length, 'lançamento')} de gasto</span></span><span class="amt">${brl(v)}</span><span class="pbar"><i style="width:${v / ta * 100}%"></i></span></button>
      <div class="acc-b">${xs.length ? `<div><h3>Como foi pago</h3>${mini(agrupar(xs, t => t.forma || '—'), v)}</div><div><h3>Com o que foi gasto</h3>${mini(agrupar(xs, t => t.cat), v)}</div>` : vazio('Nenhum gasto com esses filtros.')}</div></div>`; }).join('');
  const GC = gastos(tx, s, { cat: true });
  const grid = `<div class="grid">
    ${painel('Gastos por mês', baterias(meses, porMes, s.mes), 'c7', 'toque num mês para filtrar')}
    ${painel('Gastos por conta', `<div class="dims"><span><b>Onde:</b> conta ou cartão</span><span><b>Como:</b> forma de pagamento</span><span><b>Com o quê:</b> categoria</span></div><div class="accs">${accs}<div class="mini" style="padding:4px 12px"><div><b>Total</b><span class="p">${GA.length} lanç.</span><span class="v">${brl(totalGasto(GA))}</span></div></div></div><p class="note">Compras no cartão aparecem no cartão de origem, não no banco que pagou a fatura.</p>`, 'c5', 'quanto em cada conta e com o quê')}
    ${painel('Gastos por categoria', barrasH(agrupar(GC, t => t.cat), 'cat', s.cat), 'c12', 'toque para filtrar')}
  </div>`;

  // comparação mês a mês por categoria
  const cats = agrupar(gastos(tx, s, { mes: true }), t => t.cat);
  const cmpT = meses.length > 1 ? secao('cmp', 'Comparação mês a mês', 'gastos de cada categoria em cada mês',
    `<div class="tbl"><table class="cmp"><tr><th>Categoria</th>${meses.map(m => `<th class="r">${mCurto(m)}</th>`).join('')}<th class="r">Média</th></tr>${cats.map(c => { const vs = meses.map(m => totalGasto(c.xs.filter(t => t.mes === m))); const md = vs.reduce((a, b) => a + b, 0) / meses.length;
      return `<tr><td>${esc(c.k)}</td>${vs.map((v, i) => { const pr = i ? vs[i - 1] : null; const cl = pr != null && v - pr >= 100 && v > pr * 1.3 ? 'up' : pr != null && pr - v >= 100 && v < pr * 0.7 ? 'down' : ''; return `<td class="r num ${cl} ${s.mes === meses[i] ? 'sel' : ''}">${v ? brl(v) : '—'}</td>`; }).join('')}<td class="r num muted">${brl(md)}</td></tr>`; }).join('')}
      <tr class="tot"><td>Total</td>${porMes.map(v => `<td class="r num">${brl(v)}</td>`).join('')}<td class="r num">${brl(porMes.reduce((a, b) => a + b, 0) / meses.length)}</td></tr></table></div><p class="note">Em vermelho: subiu R$ 100 ou mais e mais de 30% em relação ao mês anterior. Em verde: caiu na mesma proporção.</p>`) : '';

  // resumo mensal
  const R = resumoMensal(tx, s, meses); const T = k => R.reduce((a, r) => a + Math.round(r[k] * 100), 0) / 100;
  const resumo = secao('mes', 'Resumo mensal', 'entrou, gastos, resultado, poupança e transferências',
    `${part ? '<p class="note"><b>Resultado</b> não se aplica: com esses filtros os gastos mostrados são só uma parte do total.</p>' : ''}<div class="tbl"><table><tr><th>Mês</th><th class="r">Entrou</th><th class="r">Gastos</th><th class="r">Resultado</th><th class="r">Aplicado na poupança</th><th class="r">Resgatado</th><th class="r">Transferências</th><th class="r">Pagamento de fatura</th></tr>
    ${R.map(r => `<tr class="${s.mes === r.m ? 'sel' : ''}"><td>${mLabel(r.m)}</td><td class="r num">${brl(r.e)}</td><td class="r num">${brl(r.g)}</td><td class="r num ${part ? '' : r.r >= 0 ? 'pos' : 'neg'}">${part ? '—' : brl(r.r)}</td><td class="r num muted">${brl(r.ap)}</td><td class="r num muted">${brl(r.rs)}</td><td class="r num muted">${brl(r.tr)}</td><td class="r num muted">${brl(r.fa)}</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td class="r num">${brl(T('e'))}</td><td class="r num">${brl(T('g'))}</td><td class="r num">${part ? '—' : brl(T('r'))}</td><td class="r num">${brl(T('ap'))}</td><td class="r num">${brl(T('rs'))}</td><td class="r num">${brl(T('tr'))}</td><td class="r num">${brl(T('fa'))}</td></tr></table></div>
    <p class="note">O mês de cada gasto é a data da compra; o INSS entra no mês de competência. Parcelas futuras não entram aqui (veja Parcelamentos).</p>`);

  // visão anual
  const As = anos(tx);
  const anual = secao('ano', 'Visão anual', plural(As.length, 'ano') + ' com dados', `<div class="tbl"><table><tr><th>Ano</th><th class="r">Meses com dados</th><th class="r">Entrou</th><th class="r">Gastos</th><th class="r">Resultado</th><th class="r">Gasto médio/mês</th></tr>${As.map(a => { const sa = { ...s, ano: a, mes: '' }; const e = sum(entradas(tx, sa)), g = totalGasto(gastos(tx, sa)); const nm = new Set(tx.filter(t => t.mes.startsWith(a)).map(t => t.mes)).size;
    return `<tr class="${s.ano === a ? 'sel' : ''}"><td>${a}</td><td class="r num">${nm}</td><td class="r num">${brl(e)}</td><td class="r num">${brl(g)}</td><td class="r num ${part ? '' : e - g >= 0 ? 'pos' : 'neg'}">${part ? '—' : brl(e - g)}</td><td class="r num">${brl(g / (nm || 1))}</td></tr>`; }).join('')}</table></div><p class="note">Cada ano mostra só os meses que existem na base. Nada é projetado.</p>`);

  return K + notaRes + avisoIncompleto(B, s) + `<div class="grid">${ins}</div>` + grid + cmpT
    + `<section style="display:grid;gap:10px"><h2>Onde o dinheiro foi <small>categoria › tipo de gasto › lançamento</small></h2>${drill(G, B, { auto: !!(s.busca || s.cat) })}</section>`
    + resumo + anual;
}
