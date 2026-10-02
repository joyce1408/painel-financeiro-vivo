// Importar: envie extratos e faturas; revise antes de gravar. Também: lançamento manual e histórico.
import { brl, esc, dbr, mLabel } from '../utils.js';
import { MOV, MOVS } from '../calc.js';
import { TIPO_CAT } from '../classify.js';
import { kpis, vazio, secao, tabelaTx, toast, tagConta } from '../ui.js';
import { lerArquivo, prepararImportacao, confirmarImportacao, desfazerImportacao } from '../importer.js';
import { SUPORTADOS, NAO_SUPORTADOS } from '../parsers/index.js';
import { B as Base, carregar, novoLancamentoManual, restaurarBackup } from '../store.js';

export const titulo = 'Importar';
let prev = null, lendo = false, ultimo = null;

function resumoHTML(r) {
  return `<div class="res">${[['Encontrados', r.encontrados], ['Novos', r.novos], ['Já existentes', r.existentes], ['Classificados', r.classificados], ['Pendentes', r.pendentes], ['Erros', r.erros]].map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join('')}</div>`;
}
function previaHTML(B) {
  const p = prev;
  const arqs = p.arquivos.map(a => `<tr><td><b>${esc(a.nome)}</b>${a.aviso ? `<div class="note">${esc(a.aviso)}</div>` : ''}${a.erro ? `<div class="note neg">${esc(a.erro)}</div>` : ''}</td><td>${a.instituicao ? esc(a.instituicao) + `<div class="note">${esc(a.tipo)} · ${esc(a.formato)}</div>` : '—'}</td><td class="num">${a.periodoInicio ? dbr(a.periodoInicio) + ' a ' + dbr(a.periodoFim) : '—'}${a.fatura ? `<div class="note">fatura ${esc(a.fatura.id)}${a.faturaExiste ? ' (já existe)' : ' (nova)'}</div>` : ''}</td><td class="r num">${a.encontrados}</td><td class="r num">${a.novos}</td><td class="r num">${a.existentes}</td><td>${a.conferencia ? `<span class="${a.conferencia.ok === false ? 'neg' : a.conferencia.ok ? 'pos' : 'muted'}">${a.conferencia.ok === false ? '✗' : a.conferencia.ok ? '✓' : '·'}</span> <span class="note">${esc(a.conferencia.texto)}</span>` : ''}</td></tr>`).join('');
  const temErroConf = p.arquivos.some(a => a.conferencia && a.conferencia.ok === false);
  return `<div class="panel"><h2>Revisão da importação <small>nada foi gravado ainda</small></h2>${resumoHTML(p.resumo)}
    <div class="tbl"><table><tr><th>Arquivo</th><th>Banco</th><th>Período</th><th class="r">Encontrados</th><th class="r">Novos</th><th class="r">Já existentes</th><th>Conferência</th></tr>${arqs}</table></div>
    ${temErroConf ? '<div class="banner">A conferência de pelo menos um arquivo não bateu. Os lançamentos lidos podem ser gravados, mas confira o arquivo: pode haver linha que o leitor não reconheceu.</div>' : ''}
    ${p.erros.length ? `<div class="tbl"><table><tr><th>Arquivo</th><th>Problema</th></tr>${p.erros.map(e => `<tr><td>${esc(e.arquivo)}</td><td>${esc(e.motivo)}${e.linha ? `<div><code>${esc(e.linha)}</code></div>` : ''}</td></tr>`).join('')}</table></div>` : ''}
    ${p.novos.length ? `<h2 style="margin-top:6px">Lançamentos novos <small>${p.resumo.classificados} classificados · ${p.resumo.pendentes} vão para Pendências</small></h2>${tabelaTx(p.novos, { cols: ['data', 'desc', 'valor', 'conta', 'mov', 'cat', 'sub', 'status'], ordem: 'desc' })}` : `<p class="note">Nenhum lançamento novo: tudo o que está nesses arquivos já existe na base.</p>`}
    <div class="acts"><button class="btn pri" type="button" data-imp-ok ${p.novos.length || p.arquivos.some(a => a.instituicao && !a.jaImportado) ? '' : 'disabled'}>${p.novos.length ? `Gravar ${p.novos.length} lançamento(s)` : 'Registrar arquivos'}</button><button class="btn ghost" type="button" data-imp-cancel>Cancelar</button></div></div>`;
}
function manualHTML(B) {
  const cats = B.categorias.filter(c => c.nome !== 'Não identificado');
  return `<div class="form" data-manual>
    <label>Data<input type="date" name="data" required></label>
    <label>Valor (R$)<input type="text" name="valor" inputmode="decimal" placeholder="ex.: 45,90"></label>
    <label>Entrou ou saiu<select name="sinal"><option value="-1">Saiu</option><option value="1">Entrou</option></select></label>
    <label>Conta / cartão<select name="conta"><option value="BB">Banco do Brasil</option><option value="Nu">Nubank</option><option value="Porto">Cartão Porto</option></select></label>
    <label class="full">Descrição<input type="text" name="desc" placeholder="ex.: Farmácia São Paulo"></label>
    <label>O que é<select name="mov">${MOVS.map(([t, m]) => `<option value="${t}|${m}">${MOV[m]}</option>`).join('')}</select></label>
    <label>Categoria (para gasto)<select name="cat">${cats.map(c => `<option>${esc(c.nome)}</option>`).join('')}</select></label>
    <label>Tipo de gasto / detalhe<input type="text" name="sub"></label>
    <label>Forma de pagamento<select name="forma"><option>Crédito</option><option>Débito</option><option>Pix</option><option>Dinheiro</option><option>Débito automático</option><option>Boleto</option></select></label>
    <label>Cartão (opcional)<input type="text" name="cartao" placeholder="ex.: Porto •••• 1117"></label>
    <div class="full acts"><button class="btn pri" type="button" data-manual-ok>Lançar</button><span class="why" data-erro></span></div>
    <p class="note full">Use para o que não vem em arquivo (ex.: compra no cartão Porto vista só no print). Lançamentos manuais não têm impressão digital: se depois o mesmo lançamento vier num arquivo importado, ele aparece duas vezes e você exclui o manual.</p></div>`;
}
export function render({ B }) {
  const hist = B.importacoes.map(i => `<tr><td class="num">${dbr(i.data.slice(0, 10))}<div class="note">${i.data.slice(11, 16)}</div></td><td>${esc(i.descricao || '')}${(i.conferencias || []).some(c => c.ok === false) ? '<div class="note neg">conferência não bateu em algum arquivo</div>' : ''}</td><td class="r num">${i.encontrados ?? '—'}</td><td class="r num">${i.novos ?? '—'}</td><td class="r num">${i.existentes ?? '—'}</td><td class="r num">${i.pendentes ?? '—'}</td><td class="r num">${i.erros ?? 0}</td><td><span class="st ${i.status}">${i.status}</span>${i.id !== 'migracao-inicial' && i.status !== 'desfeita' ? `<div><button class="btn sm danger" type="button" data-desfazer="${i.id}" style="margin-top:4px">Desfazer</button></div>` : ''}</td></tr>`).join('');
  const boasVindas = B.transacoes.length ? '' : `<div class="panel" style="border-left:4px solid var(--gold)"><h2>Primeiro uso neste aparelho</h2><p class="note">A base está vazia. Para começar com os seus dados de janeiro a agosto de 2026 já conferidos, carregue o arquivo <code>painel-dados-validados.json</code> (ele fica com você, fora do site). Ou importe seus extratos e faturas abaixo para começar do zero. Se outra pessoa já usa o painel com sincronização, entre por <a href="#sincronizar">Sincronizar</a>.</p><div class="acts"><label class="btn pri">Carregar dados validados<input type="file" accept=".json,application/json" data-rest-ini hidden></label></div></div>`;
  return boasVindas + (ultimo ? `<div class="panel" style="border-left:4px solid var(--pos)"><h2>Importação gravada <small>${dbr(ultimo.data.slice(0, 10))}</small></h2>${resumoHTML(ultimo)}<p class="note">Os números do painel já foram recalculados.${ultimo.pendentes ? ` ${ultimo.pendentes} lançamento(s) esperam você em Pendências.` : ''}</p></div>` : '')
    + (prev ? previaHTML(B) : `<div class="panel"><h2>Importar arquivos <small>extratos e faturas · vários de uma vez</small></h2>
    <label class="drop" id="drop"><input type="file" id="arqs" multiple accept=".pdf,.csv,.txt,application/pdf,text/csv" hidden><b>${lendo ? 'Lendo arquivos…' : 'Toque para escolher os arquivos'}</b><span class="note">ou arraste para cá · PDF e CSV · a leitura acontece neste aparelho</span></label>
    <div class="note"><b>Lê hoje:</b> ${SUPORTADOS.map(esc).join(' · ')}.<br><b>Ainda não lê:</b> ${NAO_SUPORTADOS.map(esc).join(' ')}</div>
    <p class="note">Pode enviar arquivos repetidos ou com períodos sobrepostos (ex.: o CSV e o PDF do mesmo mês): cada lançamento tem uma impressão digital (conta, cartão, data, valor e ordem) e o que já existe não é duplicado.</p></div>`)
    + secao('manual', 'Lançamento manual', 'para o que não vem em arquivo', manualHTML(B))
    + secao('hist', 'Histórico de importações', `${B.importacoes.length}`, hist ? `<div class="tbl"><table><tr><th>Quando</th><th>Arquivos</th><th class="r">Encontrados</th><th class="r">Novos</th><th class="r">Existentes</th><th class="r">Pendentes</th><th class="r">Erros</th><th>Status</th></tr>${hist}</table></div><p class="note">Desfazer remove os lançamentos, arquivos e faturas que aquela importação criou (inclusive classificações feitas neles depois). A migração inicial não pode ser desfeita aqui; use Backup › Recomeçar.</p>` : vazio('Nenhuma importação.'), true)
    + secao('arqs', 'Arquivos já importados', `${B.arquivos.length}`, `<div class="tbl"><table><tr><th>Arquivo</th><th>Banco</th><th>Período</th><th>Importado em</th></tr>${B.arquivos.slice().sort((a, b) => (b.periodoFim || '').localeCompare(a.periodoFim || '')).map(a => `<tr><td>${esc(a.nome)}<div class="note">${esc(a.formato || '')}</div></td><td>${tagConta(a.conta)}</td><td class="num">${dbr(a.periodoInicio)} a ${dbr(a.periodoFim)}</td><td class="num">${dbr((a.importadoEm || '').slice(0, 10))}</td></tr>`).join('')}</table></div>`);
}

async function processar(files, ctx) {
  if (!files.length) return;
  lendo = true; ultimo = null; ctx.rerender();
  try {
    const lidos = []; for (const f of files) lidos.push(await lerArquivo(f));
    prev = prepararImportacao(lidos, Base);
  } catch (e) { toast('Erro: ' + e.message, 6000); }
  lendo = false; ctx.rerender();
}
export function ligar(root, ctx) {
  const ri = root.querySelector('[data-rest-ini]');
  if (ri) ri.onchange = async () => { try { await restaurarBackup(JSON.parse(await ri.files[0].text())); location.hash = 'visao'; toast('Dados carregados neste aparelho.'); } catch (er) { toast(er.message, 6000); } };
  const inp = root.querySelector('#arqs'), drop = root.querySelector('#drop');
  if (inp) inp.onchange = () => processar([...inp.files], ctx);
  if (drop) {
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); processar([...e.dataTransfer.files], ctx); });
  }
  root.addEventListener('click', async e => {
    if (e.target.closest('[data-imp-cancel]')) { prev = null; ctx.rerender(); return; }
    const ok = e.target.closest('[data-imp-ok]');
    if (ok) { ok.disabled = true; try { ultimo = await confirmarImportacao(prev, Base); prev = null; await carregar(); toast(`${ultimo.novos} lançamento(s) gravado(s).`); } catch (er) { ok.disabled = false; toast('Não foi possível gravar: ' + er.message, 6000); } return; }
    const dz = e.target.closest('[data-desfazer]');
    if (dz) { const i = Base.importacoes.find(x => x.id === dz.dataset.desfazer); if (!confirm(`Desfazer esta importação? ${i.novos} lançamento(s) serão removidos.`)) return; await desfazerImportacao(i.id, Base); ultimo = null; await carregar(); toast('Importação desfeita.'); return; }
    const mn = e.target.closest('[data-manual-ok]');
    if (mn) {
      const f = root.querySelector('[data-manual]'); const q = n => f.querySelector(`[name="${n}"]`); const err = m => f.querySelector('[data-erro]').textContent = m;
      const v = Number(q('valor').value.replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.'));
      if (!q('data').value) return err('Informe a data.'); if (!isFinite(v) || v <= 0) return err('Informe o valor.'); if (!q('desc').value.trim()) return err('Informe a descrição.');
      const [tipo, mov] = q('mov').value.split('|'); const sub = q('sub').value.trim(); if (!sub) return err('Preencha o tipo de gasto / detalhe.');
      const t = await novoLancamentoManual({ data: q('data').value, valor: v * Number(q('sinal').value), conta: q('conta').value, desc: q('desc').value.trim(), tipo, mov, cat: tipo === 'despesa' ? q('cat').value : (tipo === 'investimento' ? 'Poupança' : TIPO_CAT[tipo]), sub, forma: q('forma').value, cartao: q('cartao').value.trim() });
      toast(`Lançado: ${t.desc} ${brl(t.valor)} em ${mLabel(t.mes)}.`);
    }
  });
}
