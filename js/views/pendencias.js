// Pendências: a fila do que não foi identificado com segurança. Classifique uma vez; opcionalmente vira regra.
import { brl, esc, dbr, sum } from '../utils.js';
import { kpis, vazio, secao, tabelaTx, toast, tagConta } from '../ui.js';
import { formClassificacao, ligarForm, lerForm } from './classificar.js';
import { classificarLancamento, confirmarAuto } from '../store.js';
import { MSG_INSEGURO } from '../importer.js';

export const titulo = 'Pendências';
export const contar = B => B.transacoes.filter(t => t.status === 'pendente').length;
const abertosForm = new Set();

export function render({ B }) {
  const P = B.transacoes.filter(t => t.status === 'pendente').sort((a, b) => b.data.localeCompare(a.data));
  const A = B.transacoes.filter(t => t.status === 'auto' && t.importacaoId !== 'migracao-inicial');
  const naoLidas = B.importacoes.filter(i => i.status !== 'desfeita').flatMap(i => (i.errosDetalhe || []).map(e => ({ ...e, data: i.data })));
  const cards = P.map(t => `<div class="pend" data-pend="${t.id}"><div class="hd"><b>${esc(t.desc)}</b><span class="num ${t.valor > 0 ? 'pos' : ''}" style="font-weight:800">${brl(t.valor)}</span></div>
    <div class="acts" style="gap:6px 12px;font-size:.82rem"><span class="num">${dbr(t.data)}</span>${tagConta(t.conta)}<span>${esc(t.forma || '')}</span>${t.cartao ? `<span class="muted">${esc(t.cartao)}</span>` : ''}${t.arquivo ? `<span class="muted">${esc(t.arquivo)}</span>` : ''}</div>
    <div class="why">${esc(t.motivo || MSG_INSEGURO)}${t.descOriginal && t.descOriginal !== t.desc ? ` · texto no arquivo: “${esc(t.descOriginal)}”` : ''}</div>
    ${abertosForm.has(t.id) ? formClassificacao(t, B) : `<div class="acts"><button class="btn sm" type="button" data-abrir-form="${t.id}">Classificar</button></div>`}</div>`).join('');
  return kpis([
    { l: 'Sem categoria (pendentes)', v: String(P.length), s: brl(-sum(P.filter(t => t.valor < 0))) + ' em gastos', c: 'n' },
    { l: 'Automáticas a conferir', v: String(A.length), s: 'importadas e classificadas por regra ou histórico' },
    { l: 'Linhas não lidas', v: String(naoLidas.length), s: 'erros de leitura de arquivo' },
    { l: 'Enquanto pendente', v: 'é gasto', s: 'entra em “Não identificado” até você classificar' },
  ], 'k4')
  + `<section style="display:grid;gap:10px"><h2>Fila de classificação <small>${P.length ? 'do mais recente para o mais antigo' : ''}</small></h2>${cards || vazio('Nenhum lançamento pendente. Tudo classificado.')}</section>`
  + (A.length ? secao('auto', 'Classificados automaticamente', `${A.length} para conferir`, `<p class="note">Toque num lançamento para ver por que ele foi classificado assim e corrigir, se precisar.</p><div class="acts"><button class="btn sm" type="button" data-confirmar-todos>Confirmar todos (${A.length})</button></div>${tabelaTx(A, { cols: ['data', 'desc', 'valor', 'conta', 'cat', 'sub', 'status'], ordem: 'desc' })}`) : '')
  + (naoLidas.length ? secao('nl', 'Linhas que não foram lidas', String(naoLidas.length), `<p class="note">${MSG_INSEGURO} Confira no arquivo e, se for um gasto, lance à mão em Importar › Lançamento manual.</p><div class="tbl"><table><tr><th>Arquivo</th><th>Linha</th><th>Motivo</th></tr>${naoLidas.map(e => `<tr><td>${esc(e.arquivo)}</td><td><code>${esc(e.linha || '—')}</code></td><td>${esc(e.motivo)}</td></tr>`).join('')}</table></div>`, true) : '');
}

export function ligar(root, ctx) {
  const { B } = ctx;
  root.querySelectorAll('[data-form]').forEach(f => ligarForm(f, B.transacoes.find(t => t.id === f.dataset.form), B));
  root.addEventListener('click', async e => {
    const ab = e.target.closest('[data-abrir-form]'); if (ab) { abertosForm.add(ab.dataset.abrirForm); ctx.rerender(); return; }
    const sv = e.target.closest('[data-salvar]');
    if (sv) { const f = sv.closest('[data-form]'); const t = B.transacoes.find(x => x.id === f.dataset.form); const r = lerForm(f, t);
      if (r.erro) { f.querySelector('[data-erro]').textContent = r.erro; return; }
      sv.disabled = true; abertosForm.delete(t.id);
      const out = await classificarLancamento(t.id, r.cls, r.opc);
      toast(`Classificado como ${r.cls.cat} › ${r.cls.sub}.` + (out.regra ? ` Regra criada${out.aplicados ? ` e aplicada a mais ${out.aplicados}` : ''}.` : ''));
      return; }
    if (e.target.closest('[data-confirmar-todos]')) { const ids = B.transacoes.filter(t => t.status === 'auto' && t.importacaoId !== 'migracao-inicial').map(t => t.id); await confirmarAuto(ids); toast(`${ids.length} classificações confirmadas.`); }
  });
}
