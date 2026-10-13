// Parcelamentos: parcelas já cobradas contam no mês em que foram cobradas; as futuras ficam só aqui.
import { brl, mLabel, esc, mCurto } from '../utils.js';
import { parcelamentos, casa } from '../calc.js';
import { kpis, painel, secao, vazio, tagConta } from '../ui.js';

export const titulo = 'Parcelamentos';
export function render({ B, s }) {
  const tx = B.transacoes.filter(t => casa(t, s, { ano: true, mes: true }));
  const P = parcelamentos(tx), at = P.filter(p => p.ativo), enc = P.filter(p => !p.ativo);
  const total = at.reduce((a, p) => a + p.totalFuturo, 0);
  const porMes = {}; at.forEach(p => p.futuras.forEach(f => porMes[f.mes] = (porMes[f.mes] || 0) + Math.round(f.valor * 100)));
  const ms = Object.keys(porMes).sort();
  const linha = p => `<tr><td><b>${esc(p.nome)}</b><div class="note">${p.n}x de ${brl(p.valor)} · total ${brl(p.n * p.valor)}</div></td><td>${tagConta(p.conta)}<div class="note">${esc(p.cartao || '')}</div></td><td>${esc(p.cat)} › ${esc(p.sub)}</td><td class="r num">${p.atual}/${p.n}</td><td class="num">${mLabel(p.inicio)}</td><td class="num">${mLabel(p.termino)}</td><td class="r num">${p.ativo ? `${p.futuras.length} · ${brl(p.totalFuturo)}` : '<span class="tag">encerrado</span>'}</td></tr>`;
  const cab = '<tr><th>Compra</th><th>Cartão</th><th>Categoria</th><th class="r">Última cobrada</th><th>Início</th><th>Término</th><th class="r">Futuras</th></tr>';
  return kpis([
    { l: 'Comprometido em parcelas futuras', v: brl(total), s: `${at.length} parcelamento(s) em andamento`, c: 'rose' },
    { l: 'Próximo mês', v: ms[0] ? brl(porMes[ms[0]] / 100) : brl(0), s: ms[0] ? mLabel(ms[0]) : 'nenhuma parcela futura' },
    { l: 'Último mês com parcela', v: ms.length ? mLabel(ms[ms.length - 1]) : '—', s: ms.length ? `${ms.length} mês(es) com parcela a vencer` : '' },
    { l: 'Encerrados', v: String(enc.length), s: 'todas as parcelas já cobradas' },
  ], 'k4')
  + `<p class="note" style="margin-top:-8px">As parcelas futuras são calculadas só a partir das parcelas que aparecem nas suas faturas (ex.: “Parcela 3/10” → faltam 7). Elas não entram nos gastos até serem cobradas. Se uma fatura ainda não foi importada, a parcela daquele mês ainda aparece como futura.</p>`
  + (ms.length ? `<div class="grid">${painel('Compromisso por mês', `<div class="tbl"><table><tr>${ms.map(m => `<th class="r">${mCurto(m)}/${m.slice(2, 4)}</th>`).join('')}</tr><tr>${ms.map(m => `<td class="r num">${brl(porMes[m] / 100)}</td>`).join('')}</tr></table></div>`, 'c12', 'quanto já está comprometido em cada mês')}</div>` : '')
  + secao('pat', 'Em andamento', `${at.length}`, at.length ? `<div class="tbl"><table>${cab}${at.map(linha).join('')}</table></div>` : vazio('Nenhum parcelamento em andamento.'), true)
  + secao('pen', 'Encerrados', `${enc.length}`, enc.length ? `<div class="tbl"><table>${cab}${enc.map(linha).join('')}</table></div>` : vazio('Nenhum parcelamento encerrado.'));
}
