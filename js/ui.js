// Peças visuais compartilhadas pelas telas (mesmo visual do Raio-X).
import { esc, brl, pct, dbr, mLabel, mCurto, sum } from './utils.js';
import { CONTAS, MOV, agrupar, totalGasto } from './calc.js';

export const $ = id => document.getElementById(id);
export const TAG = { BB: 'bb', Nu: 'nu', Porto: 'porto' };
export const tagConta = c => `<span class="tag ${TAG[c] || ''}">${esc(CONTAS[c] || c)}</span>`;
export const STATUS = { auto: 'automática', confirmado: 'confirmada', pendente: 'pendente' };
export const stTx = t => `<span class="st ${t.status}" title="${esc(t.motivo || '')}">${STATUS[t.status] || t.status}</span>`;
export const plural = (n, s, p = s + 's') => `${n} ${n === 1 ? s : p}`;

// Estado de acordeões abertos: sobrevive às re-renderizações.
export const abertos = new Set();

export function kpis(itens, cls = '') {
  return `<section class="kpis ${cls}" aria-live="polite">${itens.map(k => `<div class="kpi ${k.c || ''} ${k.go ? 'click' : ''}" ${k.go ? `data-go="${k.go}" role="link" tabindex="0"` : ''}><span class="l">${k.l}</span><span class="v">${k.v}</span><span class="s">${k.s || ''}</span></div>`).join('')}</section>`;
}
export const painel = (titulo, corpo, cls = 'c12', sub = '') => `<div class="panel ${cls}"><h2>${titulo}${sub ? ` <small>${sub}</small>` : ''}</h2>${corpo}</div>`;
export const secao = (id, titulo, meta, corpo, aberto) => `<details class="sec" data-sec="${id}" ${aberto || abertos.has('sec:' + id) ? 'open' : ''}><summary><span><span class="car">▸</span>${titulo}</span><span class="muted" style="font-weight:600;font-size:.84rem">${meta || ''}</span></summary><div class="in">${corpo}</div></details>`;
export const vazio = (t = 'Nenhum lançamento com esses filtros.') => `<div class="empty">${t}</div>`;

// Gráfico de baterias por mês (intensidade relativa ao maior mês exibido).
export function baterias(meses, valores, sel) {
  if (!meses.length) return vazio('Sem meses neste período.');
  const mx = Math.max(...valores, 1), lvl = p => p <= 60 ? 1 : p <= 75 ? 2 : p <= 90 ? 3 : 4;
  return `<div class="batts" style="--n:${meses.length}">${meses.map((m, i) => { const p = valores[i] / mx * 100;
    return `<button type="button" class="bat ${sel === m ? 'on' : sel ? 'dim' : ''}" data-mes="${m}" style="border:0;background:transparent;color:inherit;padding:0" aria-label="${mLabel(m)}: ${brl(valores[i])}" title="${mLabel(m)}: ${brl(valores[i])}"><span class="cap"></span><span class="body"><span class="fill lvl${lvl(p)}" style="height:${p}%"></span><span class="pc">${valores[i] ? Math.round(p) + '%' : '—'}</span></span><span class="m">${mCurto(m)}</span><span class="val">${brl(valores[i])}</span></button>`; }).join('')}</div>
  <div class="blg"><span>100% = maior valor entre os meses exibidos</span><span><i class="lvl1"></i>baixo (até 60%)</span><span><i class="lvl2"></i>intermediário (até 75%)</span><span><i class="lvl3"></i>elevado (até 90%)</span><span><i class="lvl4"></i>muito elevado</span></div>`;
}
export function barrasH(grupos, attr, sel) {
  if (!grupos.length) return vazio('Nenhum gasto com esses filtros.');
  const mx = grupos[0].v || 1;
  return `<div class="hbars">${grupos.map(g => `<button type="button" class="hb ${sel === g.k ? 'on' : ''}" ${attr ? `data-${attr}="${esc(g.k)}"` : ''}><span class="t">${esc(g.k)}</span><span class="trk"><i style="width:${Math.max(0, g.v / mx * 100)}%"></i></span><span class="v">${brl(g.v)}</span></button>`).join('')}</div>`;
}
export const mini = (grupos, tot) => `<div class="mini">${grupos.map(g => `<div><span>${esc(g.k)}</span><span class="p">${pct(g.v / (tot || 1) * 100)}</span><span class="v">${brl(g.v)}</span></div>`).join('')}</div>`;

export function tabelaTx(xs, o = {}) {
  const cols = o.cols || ['data', 'desc', 'valor', 'conta', 'cat', 'sub'];
  const H = { data: 'Data', desc: 'Descrição', valor: 'Valor', conta: 'Conta', cat: 'Categoria', sub: 'Tipo de gasto', mov: 'Movimentação', forma: 'Forma', cartao: 'Cartão', status: 'Classificação', parcela: 'Parcela', mes: 'Mês' };
  const C = {
    data: t => `<td class="num">${dbr(t.data)}</td>`, desc: t => `<td>${esc(t.desc)}${t.parcela && !cols.includes('parcela') ? ` <span class="muted" style="font-size:.76rem">${esc(t.parcela)}</span>` : ''}</td>`,
    valor: t => `<td class="r num ${t.valor > 0 ? 'pos' : ''}">${brl(t.valor)}</td>`, conta: t => `<td>${tagConta(t.conta)}</td>`,
    cat: t => `<td>${esc(t.cat)}</td>`, sub: t => `<td>${esc(t.sub)}</td>`, mov: t => `<td>${MOV[t.mov] || t.mov}</td>`, forma: t => `<td>${esc(t.forma || '—')}</td>`,
    cartao: t => `<td>${esc(t.cartao || '—')}</td>`, status: t => `<td>${stTx(t)}</td>`, parcela: t => `<td>${esc(t.parcela || '')}</td>`, mes: t => `<td>${mLabel(t.mes)}</td>`,
  };
  const ys = o.ordem === 'desc' ? xs.slice().sort((a, b) => b.data.localeCompare(a.data) || a.valor - b.valor) : xs.slice().sort((a, b) => a.data.localeCompare(b.data));
  const lim = o.limite || 1e9;
  return `<div class="tbl"><table><tr>${cols.map(c => `<th class="${c === 'valor' ? 'r' : ''}">${H[c]}</th>`).join('')}</tr>${ys.slice(0, lim).map(t => `<tr class="tx" data-tx="${t.id}" tabindex="0">${cols.map(c => C[c](t)).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="empty">Nenhum lançamento com esses filtros.</td></tr>`}</table></div>${ys.length > lim ? `<button class="more" type="button" data-mais="${o.id || ''}">Mostrar mais (${ys.length - lim} restantes)</button>` : ''}`;
}

// Detalhe de um lançamento, com a origem completa.
export function detalhe(t, B) {
  const imp = B.importacoes.find(i => i.id === t.importacaoId);
  const f = [['Data', dbr(t.data)], ['Valor', brl(t.valor)], ['Conta', CONTAS[t.conta] || t.conta], ['Forma de pagamento', t.forma || '—'], ['Cartão', t.cartao || 'Sem cartão'], ['Tipo de movimentação', MOV[t.mov]], ['Categoria', t.cat], ['Tipo de gasto', t.sub], ['Mês no relatório', mLabel(t.mes)]];
  if (t.parcela) f.push(['Parcela', t.parcela]);
  if (t.faturaId) f.push(['Fatura', t.faturaId]);
  f.push(['Classificação', (STATUS[t.status] || t.status) + (t.motivo ? ' · ' + t.motivo : '')]);
  f.push(['Origem', t.arquivo ? `${t.arquivo}${t.instituicao ? ' · ' + t.instituicao : ''}` : t.importacaoId === 'manual' ? 'Lançado à mão' : 'Ajuste da migração (sem arquivo de origem)']);
  if (imp) f.push(['Importado em', dbr(imp.data.slice(0, 10)) + (imp.id === 'migracao-inicial' ? ' (migração do Raio-X)' : '')]);
  if (t.descOriginal && t.descOriginal !== t.desc) f.push(['Texto no arquivo', t.descOriginal]);
  if (t.obs) f.push(['Observação', t.obs]);
  return `<div class="dl">${f.map(x => `<div><span>${x[0]}</span>${esc(x[1])}</div>`).join('')}</div><div class="acts" style="margin-top:8px"><button class="btn sm" type="button" data-editar="${t.id}">${t.status === 'pendente' ? 'Classificar' : 'Editar'}</button>${t.status === 'auto' ? `<button class="btn sm ghost" type="button" data-confirmar="${t.id}">Confirmar classificação</button>` : ''}</div>`;
}

// "Onde o dinheiro foi": categoria › tipo de gasto › lançamento.
export function drill(G, B, o = {}) {
  const tot = totalGasto(G);
  const cats = agrupar(G, t => t.cat).sort((a, b) => (a.k === 'Não identificado') - (b.k === 'Não identificado') || b.v - a.v);
  if (!cats.length) return vazio('Nenhum gasto com esses filtros.');
  return `<div class="cats">${cats.map(c => {
    const subs = agrupar(c.xs, t => t.sub); const kid = 'c:' + c.k; const op = abertos.has(kid) || (o.auto && cats.length <= 3);
    const d = B.categorias.find(x => x.nome === c.k);
    return `<div class="cat ${op ? 'open' : ''}" data-id="${esc(kid)}"><button type="button" class="cat-h" aria-expanded="${op}"><span class="car">▸</span><span><span class="nm">${esc(c.k)}</span> <span class="mt">${plural(subs.length, 'tipo')} de gasto · ${plural(c.n, 'lançamento')} · ${pct(c.v / (tot || 1) * 100)}</span></span><span></span><span class="amt">${brl(c.v)}</span><span class="pbar"><i style="width:${c.v / (tot || 1) * 100}%"></i></span></button>
      <div class="cat-b">${d && d.definicao ? `<div class="def"><span><b>O que é:</b> ${esc(d.definicao)}</span>${d.entra ? `<span><b>Entra:</b> ${esc(d.entra)}</span>` : ''}${d.naoEntra ? `<span><b>Não entra:</b> ${esc(d.naoEntra)}</span>` : ''}</div>` : ''}
      ${subs.map(s => { const sid = kid + '|' + s.k; const so = abertos.has(sid) || (o.auto && subs.length === 1 && op);
        return `<div class="sub ${so ? 'open' : ''}" data-id="${esc(sid)}"><button type="button" class="sub-h" aria-expanded="${so}"><span class="car">▸</span><span>${esc(s.k)} <span class="muted" style="font-size:.78rem">· ${plural(s.n, 'lançamento')}</span></span><span class="muted num" style="font-size:.78rem">${pct(s.v / (c.v || 1) * 100)}</span><span class="num" style="font-weight:700">${brl(s.v)}</span></button><div class="sub-b">${tabelaTx(s.xs)}</div></div>`; }).join('')}</div></div>`;
  }).join('')}</div>`;
}

// Bloco expansível genérico (cat) com tabela de lançamentos.
export function bloco(id, nome, meta, valor, corpo) {
  const op = abertos.has(id);
  return `<div class="cat ${op ? 'open' : ''}" data-id="${esc(id)}"><button type="button" class="cat-h" aria-expanded="${op}"><span class="car">▸</span><span><span class="nm">${nome}</span> <span class="mt">${meta}</span></span><span></span><span class="amt">${valor}</span></button><div class="cat-b">${corpo}</div></div>`;
}

export function toast(msg, ms = 3200) {
  const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms);
}
export function dialogo(titulo, html) {
  $('dlgT').textContent = titulo; $('dlgB').innerHTML = html; const d = $('dlg'); if (!d.open) d.showModal(); return $('dlgB');
}
export const fecharDialogo = () => $('dlg').close();
export { sum };
