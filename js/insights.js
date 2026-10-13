// Insights calculados só com os seus dados. Cada um mostra o número que o sustenta; sem evidência, não aparece.
import { gastos, entradas, totalGasto, agrupar, parcelamentos, mesesDoAno, ano } from './calc.js';
import { brl, pct, mLabel, addMes } from './utils.js';

const DISCRICIONARIAS = ['Alimentação fora de casa', 'Vestuário', 'Beleza', 'Compras online', 'Casa', 'Assinaturas', 'Esporte', 'Transporte'];

export function gerarInsights(tx, s) {
  const out = [];
  const todosMeses = [...new Set(tx.map(t => t.mes))].sort();
  const meses = s.ano ? mesesDoAno(tx, s.ano) : todosMeses;
  const M = s.mes || meses[meses.length - 1];
  if (!M) return out;
  const base = { ...s, mes: '', ano: '' };
  const gm = m => gastos(tx, { ...base, mes: m });
  const G = gm(M), totM = totalGasto(G);
  const P = addMes(M, -1);
  const temP = todosMeses.includes(P);

  // 1) mês contra o mês anterior, e de onde veio a diferença
  if (temP) {
    const GP = gm(P), totP = totalGasto(GP), d = Math.round((totM - totP) * 100) / 100;
    if (Math.abs(d) >= 50) {
      const cm = new Map(); agrupar(G, t => t.cat).forEach(c => cm.set(c.k, c.v)); agrupar(GP, t => t.cat).forEach(c => cm.set(c.k, (cm.get(c.k) || 0) - c.v));
      const contrib = [...cm.entries()].map(([k, v]) => [k, Math.round(v * 100) / 100]).filter(([, v]) => Math.sign(v) === Math.sign(d)).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
      out.push({ tipo: d > 0 ? 'alta' : 'baixa', titulo: `Gastos ${d > 0 ? 'subiram' : 'caíram'} ${brl(Math.abs(d))} em ${mLabel(M)}`,
        texto: `${mLabel(P)}: ${brl(totP)} → ${mLabel(M)}: ${brl(totM)} (${d > 0 ? '+' : '−'}${pct(Math.abs(d) / (totP || 1) * 100)}).` + (contrib.length ? ` A maior parte veio de ${contrib.map(([k, v]) => `${k} (${v > 0 ? '+' : '−'}${brl(Math.abs(v))})`).join(', ')}.` : '') });
    }
  }
  // 2) categorias acima da média dos 3 meses anteriores
  const ant = [1, 2, 3].map(i => addMes(M, -i)).filter(m => todosMeses.includes(m));
  if (ant.length >= 2) {
    const media = new Map();
    ant.forEach(m => agrupar(gm(m), t => t.cat).forEach(c => media.set(c.k, (media.get(c.k) || 0) + c.v / ant.length)));
    agrupar(G, t => t.cat).filter(c => c.k !== 'Não identificado').forEach(c => {
      const a = media.get(c.k) || 0, dif = c.v - a;
      if (dif >= 150 && c.v >= a * 1.3) out.push({ tipo: 'atencao', titulo: `${c.k} acima da média`, texto: a ? `${brl(c.v)} em ${mLabel(M)} contra média de ${brl(a)} nos ${ant.length} meses anteriores (+${brl(dif)}).` : `${brl(c.v)} em ${mLabel(M)}; nos ${ant.length} meses anteriores não houve gasto nesta categoria.`, cat: c.k });
    });
  }
  // 3) tendência de 3 meses contra os 3 anteriores (onde dá para economizar)
  const ult3 = [0, 1, 2].map(i => addMes(M, -i)), ant3 = [3, 4, 5].map(i => addMes(M, -i));
  if ([...ult3, ...ant3].every(m => todosMeses.includes(m))) {
    const med = ms => { const r = new Map(); ms.forEach(m => agrupar(gm(m), t => t.cat).forEach(c => r.set(c.k, (r.get(c.k) || 0) + c.v / 3))); return r; };
    const a = med(ant3), b = med(ult3);
    DISCRICIONARIAS.forEach(k => { const x = a.get(k) || 0, y = b.get(k) || 0;
      if (x > 50 && y - x >= 100 && y >= x * 1.2) out.push({ tipo: 'economia', titulo: `${k} cresceu ${pct((y - x) / x * 100)} nos últimos 3 meses`, texto: `Média de ${brl(x)}/mês (${mLabel(ant3[2])} a ${mLabel(ant3[0])}) passou para ${brl(y)}/mês (${mLabel(ult3[2])} a ${mLabel(M)}). Voltar ao nível anterior seria ${brl(y - x)}/mês, ${brl((y - x) * 12)}/ano.`, cat: k }); });
  }
  // 4) concentração
  const per = s.mes ? G : gastos(tx, s);
  const ag = agrupar(per, t => t.cat), tot = totalGasto(per);
  if (ag.length >= 4 && tot > 0) { const t3 = ag.slice(0, 3), v3 = t3.reduce((a, c) => a + c.v, 0);
    out.push({ tipo: 'info', titulo: `${pct(v3 / tot * 100)} dos gastos em 3 categorias`, texto: `${t3.map(c => `${c.k} ${brl(c.v)}`).join(' · ')} de ${brl(tot)} ${s.mes ? 'em ' + mLabel(s.mes) : 'no período'}.` }); }
  // 5) parcelas futuras
  const pf = parcelamentos(tx).filter(p => p.ativo);
  if (pf.length) { const v = pf.reduce((a, p) => a + p.totalFuturo, 0);
    out.push({ tipo: 'info', titulo: `${brl(v)} em parcelas futuras`, texto: `${pf.length} parcelamento${pf.length > 1 ? 's' : ''} em andamento: ${pf.slice(0, 3).map(p => `${p.nome} (${p.futuras.length}x ${brl(p.valor)})`).join(', ')}${pf.length > 3 ? '…' : ''}.` }); }
  // 6) entradas
  if (temP) { const e1 = entradas(tx, { ...base, mes: M }).reduce((a, t) => a + t.valor, 0), e0 = entradas(tx, { ...base, mes: P }).reduce((a, t) => a + t.valor, 0);
    if (e0 && Math.abs(e1 - e0) >= 300) out.push({ tipo: e1 > e0 ? 'baixa' : 'alta', titulo: `Entradas ${e1 > e0 ? 'maiores' : 'menores'} que no mês anterior`, texto: `${mLabel(P)}: ${brl(e0)} → ${mLabel(M)}: ${brl(e1)}.` }); }
  return { mes: M, itens: out.slice(0, 7) };
}
