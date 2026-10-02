// Painel Financeiro Vivo: inicialização, filtros, navegação e eventos comuns.
import { B, carregar, migrarSeNecessario, aoMudar, classificarLancamento, confirmarAuto, editarLancamento, excluirLancamento } from './store.js';
import { anos, mesesDoAno, cartaoDe, entraEmGastos, CONTAS } from './calc.js';
import { esc, mLabel } from './utils.js';
import { $, abertos, detalhe, dialogo, fecharDialogo, toast } from './ui.js';
import { formClassificacao, ligarForm, lerForm, resumoTx } from './views/classificar.js';
import * as visao from './views/visao.js';
import * as entradasV from './views/entradas.js';
import * as saidas from './views/saidas.js';
import * as credito from './views/credito.js';
import * as debito from './views/debito.js';
import * as faturas from './views/faturas.js';
import * as categorias from './views/categorias.js';
import * as parcelamentosV from './views/parcelamentos.js';
import * as tarifas from './views/tarifas.js';
import * as pendencias from './views/pendencias.js';
import * as importar from './views/importar.js';
import * as backup from './views/backup.js';
import * as sincronizarV from './views/sincronizar.js';
import { iniciarSync, aoMudarSync, estado as estadoSync } from './sync.js';

const VIEWS = { visao, entradas: entradasV, saidas, credito, debito, faturas, categorias, parcelamentos: parcelamentosV, tarifas, pendencias, importar, sincronizar: sincronizarV, backup };
const SEM_FILTRO = new Set(['importar', 'backup', 'pendencias', 'sincronizar']);
const s = { ano: '', mes: '', conta: '', cartao: '', cat: '', forma: '', busca: '' };
let rota = 'visao';

const ctx = { B, s, get meses() { return s.ano ? mesesDoAno(B.transacoes, s.ano) : [...new Set(B.transacoes.map(t => t.mes))].sort(); }, rerender: () => render() };

function nav() {
  const n = B.transacoes.filter(t => t.status === 'pendente').length;
  $('nav').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<a href="#${k}" class="${rota === k ? 'on' : ''} ${k === 'importar' ? 'sep' : ''}" ${rota === k ? 'aria-current="page"' : ''}>${k === 'importar' ? '⬆ ' : ''}${v.titulo}${k === 'pendencias' && n ? ` <span class="bdg">${n}</span>` : ''}</a>`).join('');
  const a = $('nav').querySelector('.on'); if (a) a.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function opcoes(sel, lista, todos, valor) {
  sel.innerHTML = `<option value="">${todos}</option>` + lista.map(([v, t]) => `<option value="${esc(v)}">${esc(t)}</option>`).join('');
  sel.value = lista.some(([v]) => v === valor) ? valor : '';
  return sel.value;
}
function filtros() {
  const tx = B.transacoes;
  const As = anos(tx);
  if (s.ano && !As.includes(s.ano)) s.ano = '';
  s.ano = opcoes($('fAno'), As.map(a => [a, a]), 'Todos os anos', s.ano);
  s.mes = opcoes($('fMes'), ctx.meses.map(m => [m, mLabel(m)]), s.ano ? 'Ano inteiro' : 'Todos os meses', s.mes);
  const G = tx.filter(entraEmGastos);
  s.conta = opcoes($('fConta'), [...new Set(tx.map(t => t.conta))].sort().map(c => [c, CONTAS[c] || c]), 'Todas', s.conta);
  s.cartao = opcoes($('fCartao'), [...new Set(G.map(cartaoDe))].sort((a, b) => a.localeCompare(b, 'pt')).map(c => [c, c]), 'Todos', s.cartao);
  s.cat = opcoes($('fCat'), [...new Set(G.map(t => t.cat))].sort((a, b) => (a === 'Não identificado') - (b === 'Não identificado') || a.localeCompare(b, 'pt')).map(c => [c, c]), 'Todas', s.cat);
  s.forma = opcoes($('fForma'), [...new Set(G.map(t => t.forma).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt')).map(c => [c, c]), 'Todas', s.forma);
  if ($('fBusca').value !== s.busca) $('fBusca').value = s.busca;
  const ch = [];
  if (s.mes) ch.push(['mes', mLabel(s.mes)]); if (s.conta) ch.push(['conta', CONTAS[s.conta] || s.conta]); if (s.cartao) ch.push(['cartao', s.cartao]);
  if (s.cat) ch.push(['cat', s.cat]); if (s.forma) ch.push(['forma', s.forma]); if (s.busca) ch.push(['busca', '“' + s.busca + '”']);
  $('chips').hidden = !ch.length;
  $('chips').innerHTML = '<span class="lbl">Filtros ativos:</span>' + ch.map(c => `<span class="chip">${esc(c[1])}<button type="button" data-k="${c[0]}" aria-label="Remover filtro ${esc(c[1])}">×</button></span>`).join('');
  $('filtros').hidden = SEM_FILTRO.has(rota);
}
function cabecalhoSync() {
  const e = estadoSync, el = $('hdrSync'), pv = $('hdrPriv'); if (!el) return;
  if (!e.ligado) { el.textContent = ''; pv.textContent = '🔒 Seus dados ficam só neste aparelho. Nada é enviado para servidor.'; return; }
  pv.textContent = '🔒 Dados criptografados neste aparelho; a nuvem guarda só uma cópia ilegível.';
  el.textContent = e.sincronizando ? '☁ sincronizando…' : e.erro ? '☁ erro na sincronização' : e.offline ? '☁ sem internet' : e.ultima ? '☁ sincronizado ' + new Date(e.ultima).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '☁ ligado';
  el.classList.toggle('erro', !!e.erro);
}
function cabecalho() {
  cabecalhoSync();
  const bb = B.contas.find(c => c.id === 'BB');
  $('hdrNome').textContent = bb && bb.titular ? bb.titular : 'Seu controle financeiro';
  $('hdrContas').textContent = B.contas.map(c => c.nome).join(' · ') || 'Nenhuma conta ainda';
  const ms = [...new Set(B.transacoes.map(t => t.mes))].sort();
  $('hdrPeriodo').textContent = ms.length ? `Lançamentos de ${mLabel(ms[0]).toLowerCase()} a ${mLabel(ms[ms.length - 1]).toLowerCase()} · ${B.transacoes.length} na base` : 'Base vazia: comece em Importar';
  $('hdrPer').textContent = SEM_FILTRO.has(rota) ? VIEWS[rota].titulo : (s.mes ? mLabel(s.mes) : s.ano ? `Ano de ${s.ano}` : 'Todo o período') + (s.conta ? ' · ' + (CONTAS[s.conta] || s.conta) : '') + (s.cat ? ' · ' + s.cat : '');
}
let gen = 0;
export function render() {
  if (!B.transacoes.length && !['importar', 'backup', 'sincronizar'].includes(rota)) rota = 'importar';
  nav(); filtros(); cabecalho();
  const v = VIEWS[rota] || visao;
  const main = $('view');
  const y = window.scrollY;
  const novo = main.cloneNode(false); // troca o nó para descartar ouvintes antigos da tela
  try { novo.innerHTML = v.render(ctx); } catch (e) { console.error(e); novo.innerHTML = `<div class="panel"><b>Erro ao montar esta tela.</b><p class="note">${esc(e.message)}</p></div>`; }
  main.replaceWith(novo);
  if (v.ligar) v.ligar(novo, ctx);
  ligarComuns(novo);
  window.scrollTo(0, y);
  gen++;
}

function rotear() {
  const h = location.hash.replace('#', '').split('?')[0] || 'visao';
  const novaRota = VIEWS[h] ? h : 'visao';
  const mudou = novaRota !== rota; rota = novaRota; render(); if (mudou) window.scrollTo(0, 0);
}

// Eventos comuns a todas as telas (acordeões, detalhes, filtros por clique, edição).
function ligarComuns(root) {
  root.addEventListener('toggle', e => { const d = e.target; if (d.matches && d.matches('details.sec')) { d.open ? abertos.add('sec:' + d.dataset.sec) : abertos.delete('sec:' + d.dataset.sec); } }, true);
  root.addEventListener('click', async e => {
    const h = e.target.closest('.cat-h,.sub-h');
    if (h) { const box = h.parentElement, id = box.dataset.id; const o = !box.classList.contains('open'); box.classList.toggle('open', o); h.setAttribute('aria-expanded', o); o ? abertos.add(id) : abertos.delete(id); return; }
    const t = e.target.closest('tr.tx'); if (t) { toggleTx(t); return; }
    const hb = e.target.closest('.hb[data-cat]'); if (hb) { set('cat', s.cat === hb.dataset.cat ? '' : hb.dataset.cat); return; }
    const hf = e.target.closest('.hb[data-forma]'); if (hf) { set('forma', s.forma === hf.dataset.forma ? '' : hf.dataset.forma); return; }
    const bt = e.target.closest('.bat[data-mes]'); if (bt) { if (!s.ano) s.ano = bt.dataset.mes.slice(0, 4); set('mes', s.mes === bt.dataset.mes ? '' : bt.dataset.mes); return; }
    const go = e.target.closest('[data-go]'); if (go && go.dataset.go) { location.hash = go.dataset.go; return; }
    const ed = e.target.closest('[data-editar]'); if (ed) { editar(ed.dataset.editar); return; }
    const cf = e.target.closest('[data-confirmar]'); if (cf) { await confirmarAuto([cf.dataset.confirmar]); toast('Classificação confirmada.'); return; }
    const mais = e.target.closest('[data-mais]'); if (mais) { const v = VIEWS[rota]; if (v.mais) { v.mais(mais.dataset.mais); render(); } }
  });
  root.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr.tx')) { e.preventDefault(); toggleTx(e.target); } if (e.key === 'Enter' && e.target.matches('[data-go]')) location.hash = e.target.dataset.go; });
}
function toggleTx(tr) {
  const n = tr.nextElementSibling; if (n && n.classList.contains('det')) { n.remove(); return; }
  const t = B.transacoes.find(x => x.id === tr.dataset.tx); if (!t) return;
  tr.insertAdjacentHTML('afterend', `<tr class="det"><td colspan="${tr.children.length}">${detalhe(t, B)}</td></tr>`);
}
function editar(id) {
  const t = B.transacoes.find(x => x.id === id); if (!t) return;
  const d = dialogo(t.status === 'pendente' ? 'Classificar lançamento' : 'Editar lançamento', `<p style="margin:0">${resumoTx(t)}</p><p class="why" style="margin:0">${esc(t.motivo || '')}</p>`
    + formClassificacao(t, B, { edicao: true, id: 'dlg', extra: t.importacaoId === 'manual' ? '<button class="btn danger" type="button" data-excluir>Excluir lançamento</button>' : '' }));
  const f = d.querySelector('[data-form]'); ligarForm(f, t, B);
  f.querySelector('[data-salvar]').onclick = async () => {
    const r = lerForm(f, t); if (r.erro) { f.querySelector('[data-erro]').textContent = r.erro; return; }
    const { data, mes, forma, ...cls } = r.cls;
    if (data !== t.data || mes !== t.mes || forma !== (t.forma || '')) await editarLancamento(t.id, { data, mes, forma });
    const out = await classificarLancamento(t.id, cls, r.opc);
    fecharDialogo(); toast('Lançamento salvo.' + (out && out.regra ? ` Regra criada${out.aplicados ? ` e aplicada a mais ${out.aplicados}` : ''}.` : ''));
  };
  const ex = f.querySelector('[data-excluir]'); if (ex) ex.onclick = async () => { if (!confirm('Excluir este lançamento manual?')) return; await excluirLancamento(t.id); fecharDialogo(); toast('Lançamento excluído.'); };
}

function set(k, v) { s[k] = v; if (k === 'ano') s.mes = ''; render(); }
function ligarFiltros() {
  $('fAno').onchange = e => set('ano', e.target.value);
  $('fMes').onchange = e => set('mes', e.target.value);
  $('fConta').onchange = e => set('conta', e.target.value);
  $('fCartao').onchange = e => set('cartao', e.target.value);
  $('fCat').onchange = e => set('cat', e.target.value);
  $('fForma').onchange = e => set('forma', e.target.value);
  let qt; $('fBusca').oninput = e => { clearTimeout(qt); qt = setTimeout(() => set('busca', e.target.value.trim()), 180); };
  $('limpar').onclick = () => { Object.assign(s, { mes: '', conta: '', cartao: '', cat: '', forma: '', busca: '' }); render(); };
  $('chips').onclick = e => { const x = e.target.closest('button[data-k]'); if (x) set(x.dataset.k, ''); };
  document.addEventListener('click', e => { if (e.target.closest('[data-fechar]')) fecharDialogo(); });
}

async function iniciar() {
  try {
    const migrou = await migrarSeNecessario();
    await carregar();
    const As = anos(B.transacoes); s.ano = As[As.length - 1] || '';
    ligarFiltros();
    aoMudar(() => { if (document.readyState !== 'loading') render(); });
    window.addEventListener('hashchange', rotear);
    aoMudarSync(() => { cabecalhoSync(); if (rota === 'sincronizar' && !document.querySelector('[data-sync-form]')) render(); });
    rotear();
    iniciarSync(async () => { await carregar(); });
    if (migrou) toast('Seus dados validados (jan–ago/2026) foram trazidos para este aparelho.', 5000);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('./sw.js').catch(() => {});
    window.__painel = { B, s, sync: estadoSync, pronto: true };
  } catch (e) {
    console.error(e);
    $('view').innerHTML = `<div class="panel"><b>Não foi possível abrir o banco de dados local.</b><p class="note">${esc(e.message)}</p><p class="note">No iPhone, o modo de navegação privada bloqueia o armazenamento. Abra numa aba normal do Safari ou pelo ícone na tela de início.</p></div>`;
  }
}
iniciar();
