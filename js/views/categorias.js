// Categorias: onde o dinheiro foi, definições editáveis e o gerenciador de regras.
import { brl, esc, dbr } from '../utils.js';
import { gastos, MOV, MOVS } from '../calc.js';
import { REGRAS_SISTEMA, TIPO_CAT } from '../classify.js';
import { drill, secao, vazio, dialogo, fecharDialogo, toast } from '../ui.js';
import { salvarRegra, excluirRegra, salvarCategoria, casamRegra } from '../store.js';

export const titulo = 'Categorias';
export function render({ B, s }) {
  const G = gastos(B.transacoes, s);
  const uso = c => B.transacoes.filter(t => t.cat === c.nome).length;
  const cats = B.categorias.map(c => `<tr><td><b>${esc(c.nome)}</b>${c.definicao ? `<div class="note">${esc(c.definicao)}</div>` : ''}</td><td>${c.subs.map(esc).join(', ')}</td><td class="r num">${uso(c)}</td><td><button class="btn sm ghost" type="button" data-cat-edit="${esc(c.nome)}">Editar</button></td></tr>`).join('');
  const regras = B.regras.slice().sort((a, b) => a.padrao.localeCompare(b.padrao, 'pt'));
  const rg = regras.map(r => { const n = casamRegra(r, B.transacoes).length;
    return `<tr class="${r.ativa === false ? 'muted' : ''}"><td><code>${esc(r.padrao)}</code>${r.valor != null ? `<div class="note">só com valor ${brl(r.valor)}</div>` : ''}${r.conta ? `<div class="note">só na conta ${esc(r.conta)}</div>` : ''}</td><td>${MOV[r.mov]}<div class="note">${esc(r.cat)} › ${esc(r.sub)}</div></td><td class="r num">${n}</td><td>${r.ativa === false ? '<span class="tag">desligada</span>' : '<span class="st confirmado">ativa</span>'}<div class="note">${r.origem === 'confirmada' ? 'confirmada por você' : esc(r.origem || '')}${r.criadoEm ? ' · ' + dbr(r.criadoEm.slice(0, 10)) : ''}</div></td><td><div class="acts"><button class="btn sm ghost" type="button" data-regra-edit="${r.id}">Editar</button><button class="btn sm ghost" type="button" data-regra-tog="${r.id}">${r.ativa === false ? 'Ligar' : 'Desligar'}</button></div></td></tr>`; }).join('');
  return `<section style="display:grid;gap:10px"><h2>Onde o dinheiro foi <small>categoria › tipo de gasto › lançamento</small></h2>${drill(G, B, { auto: !!(s.busca || s.cat) })}</section>`
    + secao('regras', 'Suas regras de classificação', `${regras.length} regras · aplicadas a cada nova importação`,
      `<p class="note">Ordem de classificação de um lançamento novo: 1) regras fixas do sistema; 2) suas regras (abaixo); 3) histórico: o mesmo estabelecimento recebe a mesma categoria só se todas as vezes anteriores foram iguais; 4) se nada disso der certeza, vai para Pendências. Uma regra com valor exato (ex.: Apple R$ 19,90) vale só para aquele valor; outros valores do mesmo estabelecimento vão para Pendências.</p>
      <div class="acts"><button class="btn pri sm" type="button" data-regra-nova>+ Nova regra</button></div>
      ${rg ? `<div class="tbl"><table><tr><th>Quando a descrição contiver</th><th>Classifica como</th><th class="r">Casa com</th><th>Situação</th><th></th></tr>${rg}</table></div>` : vazio('Nenhuma regra ainda.')}`, true)
    + secao('cats', 'Categorias e tipos de gasto', `${B.categorias.length} categorias`, `<div class="tbl"><table><tr><th>Categoria</th><th>Tipos de gasto</th><th class="r">Lançamentos</th><th></th></tr>${cats}</table></div>`)
    + secao('sis', 'Regras fixas do sistema', `${REGRAS_SISTEMA.length} · não editáveis`, `<p class="note">Definem o que não é gasto (pagamento de fatura, transferência, poupança) e os lançamentos do banco que têm forma fixa.</p><ul style="margin:0;padding-left:18px;font-size:.86rem">${REGRAS_SISTEMA.map(r => `<li>${esc(r.nome)}</li>`).join('')}</ul>`);
}

function formRegra(r, B) {
  const cats = B.categorias.filter(c => c.nome !== 'Não identificado');
  return `<div class="form">
    <label class="full">Quando a descrição contiver<input type="text" name="padrao" value="${esc(r.padrao || '')}"></label>
    <label>O que é<select name="mov">${MOVS.map(([t, m]) => `<option value="${t}|${m}" ${r.tipo === t && r.mov === m ? 'selected' : ''}>${MOV[m]}</option>`).join('')}</select></label>
    <label>Categoria (para gasto)<select name="cat">${cats.map(c => `<option ${c.nome === r.cat ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
    <label>Tipo de gasto / detalhe<input type="text" name="sub" value="${esc(r.sub || '')}"></label>
    <label>Só com o valor (opcional)<input type="text" name="valor" inputmode="decimal" placeholder="ex.: 19,90" value="${r.valor != null ? Math.abs(r.valor).toFixed(2).replace('.', ',') : ''}"></label>
    <label>Só na conta<select name="conta"><option value="">Qualquer</option>${['BB', 'Nu', 'Porto'].map(c => `<option ${r.conta === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label class="ck"><input type="checkbox" name="ativa" ${r.ativa !== false ? 'checked' : ''}> Regra ativa</label>
    <p class="note full">A regra vale para as próximas importações. Lançamentos já classificados não mudam.</p>
    <div class="full acts"><button class="btn pri" type="button" data-regra-salvar>Salvar</button>${r.id ? '<button class="btn danger" type="button" data-regra-del>Excluir regra</button>' : ''}<span class="why" data-erro></span></div></div>`;
}
function abrirRegra(r, B) {
  const d = dialogo(r.id ? 'Editar regra' : 'Nova regra', formRegra(r, B));
  const q = n => d.querySelector(`[name="${n}"]`);
  d.querySelector('[data-regra-salvar]').onclick = async () => {
    const [tipo, mov] = q('mov').value.split('|'); const padrao = q('padrao').value.trim(); const sub = q('sub').value.trim();
    const vtxt = q('valor').value.trim(); let valor = null;
    if (vtxt) { valor = -Math.abs(Number(vtxt.replace(/\./g, '').replace(',', '.'))); if (!isFinite(valor)) return d.querySelector('[data-erro]').textContent = 'Valor inválido.'; if (tipo === 'receita') valor = -valor; }
    if (padrao.length < 3) return d.querySelector('[data-erro]').textContent = 'Use pelo menos 3 letras.';
    if (!sub) return d.querySelector('[data-erro]').textContent = 'Preencha o tipo de gasto.';
    await salvarRegra({ ...r, padrao, tipo, mov, cat: tipo === 'despesa' ? q('cat').value : (tipo === 'investimento' ? 'Poupança' : TIPO_CAT[tipo]), sub, valor, conta: q('conta').value || null, ativa: q('ativa').checked });
    fecharDialogo(); toast('Regra salva.');
  };
  const del = d.querySelector('[data-regra-del]');
  if (del) del.onclick = async () => { if (!confirm('Excluir esta regra? Os lançamentos já classificados não mudam.')) return; await excluirRegra(r.id); fecharDialogo(); toast('Regra excluída.'); };
}
function abrirCategoria(c) {
  const d = dialogo('Editar categoria', `<div class="form"><label class="full">Nome<input type="text" name="nome" value="${esc(c.nome)}"></label>
    <label class="full">Tipos de gasto (um por linha)<textarea name="subs">${esc(c.subs.join('\n'))}</textarea></label>
    <label class="full">O que é<input type="text" name="definicao" value="${esc(c.definicao || '')}"></label>
    <label class="full">Entra<input type="text" name="entra" value="${esc(c.entra || '')}"></label>
    <label class="full">Não entra<input type="text" name="naoEntra" value="${esc(c.naoEntra || '')}"></label>
    <p class="note full">Renomear a categoria atualiza todos os lançamentos e regras que usam o nome antigo.</p>
    <div class="full acts"><button class="btn pri" type="button" data-cat-salvar>Salvar</button></div></div>`);
  const q = n => d.querySelector(`[name="${n}"]`);
  d.querySelector('[data-cat-salvar]').onclick = async () => {
    const nome = q('nome').value.trim(); if (!nome) return;
    await salvarCategoria({ ...c, nome, subs: q('subs').value.split('\n').map(x => x.trim()).filter(Boolean), definicao: q('definicao').value.trim(), entra: q('entra').value.trim(), naoEntra: q('naoEntra').value.trim() }, c.nome);
    fecharDialogo(); toast('Categoria salva.');
  };
}
export function ligar(root, { B }) {
  root.addEventListener('click', async e => {
    const ed = e.target.closest('[data-regra-edit]'); if (ed) return abrirRegra(B.regras.find(r => r.id === ed.dataset.regraEdit), B);
    if (e.target.closest('[data-regra-nova]')) return abrirRegra({ tipo: 'despesa', mov: 'gasto', ativa: true }, B);
    const tg = e.target.closest('[data-regra-tog]'); if (tg) { const r = B.regras.find(x => x.id === tg.dataset.regraTog); await salvarRegra({ ...r, ativa: r.ativa === false }); toast(r.ativa === false ? 'Regra ligada.' : 'Regra desligada.'); return; }
    const ce = e.target.closest('[data-cat-edit]'); if (ce) return abrirCategoria(B.categorias.find(c => c.nome === ce.dataset.catEdit));
  });
}
