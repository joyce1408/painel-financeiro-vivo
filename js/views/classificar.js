// Formulário de classificação (Pendências e edição de lançamento), com a opção de criar regra para os próximos.
import { esc, brl, dbr } from '../utils.js';
import { MOV, MOVS } from '../calc.js';
import { TIPO_CAT } from '../classify.js';
import { casamRegra } from '../store.js';

const SUB_PADRAO = { transferencia: 'Transferência para outra conta sua', fatura: 'Pagamento de fatura', aplicacao: 'Aplicação', resgate: 'Resgate' };
export const sugestaoPadrao = t => String(t.descOriginal || t.desc).replace(/^[\d.\s/-]+/, '').replace(/\s*-?\s*Parcela.*$/i, '').trim() || (t.descOriginal || t.desc);

export function formClassificacao(t, B, o = {}) {
  const k = o.id || t.id;
  const sel = `${t.tipo}|${t.mov}`;
  const cats = B.categorias.filter(c => c.nome !== 'Não identificado').map(c => c.nome);
  const ehNI = t.cat === 'Não identificado';
  return `<div class="form" data-form="${k}">
    ${o.edicao ? `<label class="full">Descrição<input type="text" name="desc" value="${esc(t.desc)}"></label>
      <label>Data<input type="date" name="data" value="${t.data}"></label>
      <label>Mês no relatório<input type="month" name="mes" value="${t.mes}"></label>
      <label>Forma de pagamento<input type="text" name="forma" value="${esc(t.forma || '')}" list="dl-formas"></label>` : ''}
    <label>O que é<select name="mov">${MOVS.map(([tp, mv]) => `<option value="${tp}|${mv}" ${sel === `${tp}|${mv}` ? 'selected' : ''}>${MOV[mv]}</option>`).join('')}</select></label>
    <label data-so="gasto">Categoria<select name="cat"><option value="">Escolha…</option>${cats.map(c => `<option ${!ehNI && c === t.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="__nova">+ Nova categoria…</option></select></label>
    <label data-so="nova" hidden>Nome da nova categoria<input type="text" name="catNova"></label>
    <label>Tipo de gasto / detalhe<input type="text" name="sub" value="${ehNI ? '' : esc(t.sub)}" list="dl-sub-${k}" placeholder="Ex.: Supermercado"><datalist id="dl-sub-${k}"></datalist></label>
    <label class="full">Observação (opcional)<input type="text" name="obs" value="${esc(t.obs || '')}"></label>
    <div class="full pend" style="padding:10px 12px;background:var(--surface-2)">
      <label class="ck"><input type="checkbox" name="regra" ${o.regraMarcada ? 'checked' : ''}> Aplicar a lançamentos futuros (cria uma regra que você pode editar em Categorias › Regras)</label>
      <div data-so="regra" hidden class="form">
        <label class="full">Quando a descrição contiver<input type="text" name="padrao" value="${esc(sugestaoPadrao(t))}"></label>
        <label class="ck"><input type="checkbox" name="valorExato"> Só quando o valor for ${brl(t.valor)}</label>
        <label class="ck"><input type="checkbox" name="soConta"> Só nesta conta</label>
        <label class="ck full"><input type="checkbox" name="aplicarPend" checked> Aplicar também aos pendentes iguais <span class="muted" data-qtd></span></label>
      </div>
    </div>
    <div class="full acts"><button class="btn pri" type="button" data-salvar="${k}">${o.edicao ? 'Salvar' : 'Classificar'}</button>${o.extra || ''}<span class="why" data-erro></span></div>
  </div>`;
}

// Liga o comportamento do formulário (mostrar/ocultar campos, sugestões de subcategoria, contagem de pendentes).
export function ligarForm(root, t, B) {
  const q = n => root.querySelector(`[name="${n}"]`);
  const subsCat = c => (B.categorias.find(x => x.nome === c) || { subs: [] }).subs;
  const subsTipo = tp => [...new Set(B.transacoes.filter(x => x.tipo === tp && x.cat !== 'Não identificado').map(x => x.sub))].sort();
  const atual = () => {
    const [tp, mv] = q('mov').value.split('|'), gasto = tp === 'despesa';
    root.querySelector('[data-so="gasto"]').hidden = !gasto;
    root.querySelector('[data-so="nova"]').hidden = !(gasto && q('cat').value === '__nova');
    const dl = root.querySelector('datalist');
    dl.innerHTML = (gasto ? subsCat(q('cat').value) : subsTipo(tp)).map(s => `<option value="${esc(s)}">`).join('');
    if (!gasto && !q('sub').value && SUB_PADRAO[mv]) q('sub').value = SUB_PADRAO[mv];
    root.querySelector('[data-so="regra"]').hidden = !q('regra').checked;
    if (q('regra').checked) {
      const r = { padrao: q('padrao').value, valor: q('valorExato').checked ? t.valor : null, conta: q('soConta').checked ? (t.fonteFp ? t.fonteFp.split('|')[0] : t.conta) : null };
      const n = r.padrao.trim().length >= 3 ? casamRegra(r, B.transacoes.filter(x => x.status === 'pendente' && x.id !== t.id)).length : 0;
      root.querySelector('[data-qtd]').textContent = `(${n} encontrado${n === 1 ? '' : 's'})`;
    }
  };
  root.addEventListener('input', atual); root.addEventListener('change', atual); atual();
}

export function lerForm(root, t) {
  const q = n => root.querySelector(`[name="${n}"]`);
  const [tipo, mov] = q('mov').value.split('|');
  let cat = tipo === 'despesa' ? (q('cat').value === '__nova' ? q('catNova').value.trim() : q('cat').value) : (tipo === 'investimento' ? 'Poupança' : TIPO_CAT[tipo]);
  const sub = q('sub').value.trim();
  if (tipo === 'despesa' && !cat) return { erro: 'Escolha a categoria.' };
  if (!sub) return { erro: 'Preencha o tipo de gasto / detalhe.' };
  const cls = { tipo, mov, cat, sub, obs: q('obs').value.trim() };
  if (q('desc')) { cls.desc = q('desc').value.trim() || t.desc; cls.data = q('data').value || t.data; cls.mes = q('mes').value || t.mes; cls.forma = q('forma').value.trim(); }
  const opc = { criarRegra: q('regra').checked, padrao: q('padrao').value, valorExato: q('valorExato').checked, soEstaConta: q('soConta').checked, aplicarPendentes: q('aplicarPend').checked };
  if (opc.criarRegra && opc.padrao.trim().length < 3) return { erro: 'O texto da regra precisa ter pelo menos 3 letras.' };
  return { cls, opc };
}
export const resumoTx = t => `${dbr(t.data)} · ${esc(t.desc)} · <b class="num">${brl(t.valor)}</b>`;
