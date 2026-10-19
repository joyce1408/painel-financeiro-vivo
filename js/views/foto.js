// Fatura por foto: galeria, câmera ou PDF escaneado → leitura (OCR no aparelho ou Texto ao Vivo do iPhone)
// → revisão campo a campo → a MESMA importação dos arquivos (duplicatas, fatura, regras, pendências, desfazer).
import { esc, brl, dbr, sha256, cents, iso, addMes } from '../utils.js';
import { CONTAS } from '../calc.js';
import { toast } from '../ui.js';
import { gravar } from '../db.js';
import { prepararImagem, paginasDoPDF, lerTexto, OCR } from '../ocr.js';
import { lerTextoFatura, juntarPaginas } from '../parsers/texto-fatura.js';
import { prepararImportacao } from '../importer.js';

let E = novo();
function novo() { return { fase: 'inicio', imagens: [], conta: '', venc: '', progresso: '', erro: '', linhas: [], total: null, pagamentos: [], ignoradas: [], repetidas: 0, texto: '', aviso: '', origem: null, fila: [], acumulados: [], extras: [], avisos: [] }; }
export const ativo = () => E.fase !== 'inicio';
function limpar() { for (const i of E.imagens) { if (i.url) URL.revokeObjectURL(i.url); if (i.urlOriginal) URL.revokeObjectURL(i.urlOriginal); } E = novo(); }

const ehImagem = f => /^image\//.test(f.type) || /\.(jpe?g|png|webp|hei[cf]|gif|bmp)$/i.test(f.name || '');
export const separarImagens = files => [files.filter(ehImagem), files.filter(f => !ehImagem(f))];

function vencPadrao(conta, B) {
  const c = B.contas.find(x => x.id === conta); const dia = c && c.vencimentoDia;
  if (!dia) return '';
  const hoje = new Date(); let ym = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
  if (hoje.getDate() > dia) ym = addMes(ym, 1);
  return `${ym}-${String(dia).padStart(2, '0')}`;
}

// ---------- entrada ----------
export async function adicionarImagens(files, ctx) {
  E.erro = ''; E.fase = 'preparando'; ctx.rerender();
  for (const f of files) {
    try {
      const buf = await f.arrayBuffer();
      const p = await prepararImagem(f);
      const blob = await new Promise(ok => p.canvas.toBlob(ok, 'image/png'));
      E.imagens.push({ nome: f.name || 'foto', tamanho: f.size, hash: await sha256(buf), canvas: p.canvas, url: URL.createObjectURL(blob), urlOriginal: URL.createObjectURL(f), contrasteBaixo: p.contrasteBaixo, largura: p.largura, altura: p.altura });
    } catch (e) { E.erro = (E.erro ? E.erro + ' ' : '') + `${f.name || 'Imagem'}: ${e.message}`; }
  }
  E.fase = E.imagens.length ? 'fotos' : 'inicio';
  if (!E.imagens.length && E.erro) { toast(E.erro, 7000); }
  ctx.rerender();
}
export async function adicionarPDFEscaneado(file, ctx) {
  E.fase = 'preparando'; ctx.rerender();
  try {
    const paginas = await paginasDoPDF(await file.arrayBuffer());
    await adicionarImagens(paginas.map((b, i) => new File([b], `${file.name} (página ${i + 1}).png`, { type: 'image/png' })), ctx);
  } catch (e) { E.fase = 'inicio'; toast('Não foi possível abrir o PDF: ' + e.message, 6000); ctx.rerender(); }
}

// ---------- arquivos sem leitor próprio (CSV, OFX ou PDF de qualquer banco) ----------
// Cada arquivo passa por esta mesma revisão, um de cada vez; os arquivos reconhecidos (extras) entram junto no final.
const fmt = v => (v < 0 ? '-' : '') + Math.abs(v).toFixed(2).replace('.', ',');
const PAG_FATURA = /\bpagamento (recebido|efetuado|da fatura|de fatura)|\bpagto\.? fatura|\bpag\.? fatura/i;
export function abrirGenericos(genericos, extras, ctx) { limpar(); E.fila = [...genericos]; E.extras = extras; proximo(ctx); }
function proximo(ctx) {
  const g = E.fila.shift(), G = g.generico;
  const fica = { fila: E.fila, acumulados: E.acumulados, extras: E.extras };
  E = { ...novo(), ...fica, origem: { nome: g.nome, hash: g.hash, tamanho: g.tamanho, formato: G.formato }, avisos: [...(G.avisos || [])], conta: G.conta || '' };
  if (G.colunas) E.avisos.push(`Colunas usadas: data = “${G.colunas.data}”, descrição = “${G.colunas.descricao}”, valor = “${G.colunas.valor}”.`);
  if (G.venc) { E.venc = G.venc; E.vencLido = true; }
  if (G.tipo === 'texto') { E.paginas = G.paginas; E.texto = G.paginas.map(p => p.map(l => l.texto).join('\n')).join('\n\n'); interpretar(G.paginas, ctx); return; }
  E.texto = G.linhas.map(l => l.texto).join('\n');
  const cartao = G.convencao === 'compra-positiva' || G.cartao;
  const sinal = G.convencao === 'compra-positiva' ? -1 : 1;
  if (G.convencao === 'compra-positiva') E.avisos.push('Neste arquivo as compras vêm com valor positivo (padrão de fatura de cartão): elas foram trocadas para negativo, que é como o painel registra um gasto. Se estiver ao contrário, use “Inverter sinais”.');
  E.ignoradas = G.ignoradas || [];
  for (const l of G.linhas) {
    const v = Math.round(l.valor * sinal * 100) / 100;
    if (cartao && v > 0 && PAG_FATURA.test(l.descricao)) { E.pagamentos.push({ texto: l.texto, valor: v }); continue; }
    E.linhas.push({ id: E.linhas.length, incluir: true, data: l.data, descricao: l.descricao, valor: fmt(v), parcela: l.parcela || '', cartao4: '', duvidas: [...(l.duvidas || [])], texto: l.texto });
  }
  marcarDuplicatas(ctx.B);
  E.fase = E.linhas.length ? 'revisao' : 'vazio';
  ctx.rerender();
}
function finalizar(definirPrevia, B, info) {
  const lidos = [...E.extras, ...E.acumulados];
  limpar();
  if (!lidos.length) return;
  const prev = prepararImportacao(lidos, B); if (info) prev.foto = info;
  definirPrevia(prev);
}

// ---------- leitura ----------
async function lerAutomatico(ctx) {
  E.fase = 'lendo'; E.erro = ''; ctx.rerender();
  const paginas = [];
  try {
    for (let i = 0; i < E.imagens.length; i++) {
      const img = E.imagens[i];
      const r = await lerTexto(img.canvas, (st, pr) => { const el = document.querySelector('[data-progresso]'); if (el) el.textContent = `Foto ${i + 1} de ${E.imagens.length}: ${st === 'recognizing text' ? 'lendo o texto' : 'preparando o leitor'} ${Math.round(pr * 100)}%`; });
      img.confianca = r.confianca;
      paginas.push(r.linhas.length ? r.linhas : r.texto.split('\n').map(texto => ({ texto, conf: null })));
    }
  } catch (e) { E.fase = 'fotos'; E.erro = e.message + ' Você pode usar o Texto ao Vivo do iPhone (botão ao lado).'; ctx.rerender(); return; }
  E.texto = paginas.map(p => p.map(l => l.texto).join('\n')).join('\n\n');
  interpretar(paginas, ctx);
}
function lerColado(texto, ctx) { E.texto = texto; interpretar(texto.split(/\n{3,}/).map(bloco => bloco.split('\n').map(t => ({ texto: t, conf: null }))), ctx); }

function interpretar(paginas, ctx) {
  const B = ctx.B;
  const venc = E.venc ? { ano: +E.venc.slice(0, 4), mes: +E.venc.slice(5, 7) } : {};
  const tipo = E.conta === 'BB' ? 'extrato' : 'fatura';
  let r = juntarPaginas(paginas.map(p => lerTextoFatura(p, venc, { tipo, ignorarSemData: !!E.origem })));
  // instituição e vencimento lidos da própria foto, se você ainda não escolheu
  if (!E.conta && r.instituicao) E.conta = r.instituicao;
  if (r.vencimento && (!E.venc || E.vencAuto)) {
    const a = r.vencimento.a || (E.venc ? +E.venc.slice(0, 4) : new Date().getFullYear());
    E.venc = iso(a, r.vencimento.m, r.vencimento.d); E.vencLido = true;
    r = juntarPaginas(paginas.map(p => lerTextoFatura(p, { ano: a, mes: r.vencimento.m }, { tipo: E.conta === 'BB' ? 'extrato' : 'fatura', ignorarSemData: !!E.origem })));
  }
  if (!E.conta && !E.origem) E.conta = 'Nu';
  if (!E.venc && E.conta !== 'BB') E.venc = vencPadrao(E.conta, B);
  Object.assign(E, { total: r.total, pagamentos: r.pagamentos, ignoradas: r.ignoradas, repetidas: r.repetidas });
  E.linhas = r.linhas.map((l, i) => ({ id: i, incluir: true, data: l.data || '', descricao: l.descricao, valor: l.valor == null ? '' : l.valor.toFixed(2).replace('.', ','), parcela: l.parcela, cartao4: l.cartao4, duvidas: [...l.duvidas], texto: l.texto, foto: l.foto }));
  marcarDuplicatas(B);
  E.fase = E.linhas.length ? 'revisao' : 'vazio';
  ctx.rerender();
}

// Compara com o que já existe no painel: mesma conta, mesmo valor, mesma data (já existe) ou até 6 dias de
// diferença (parecido). Esses ficam desmarcados até você conferir.
function marcarDuplicatas(B) {
  const conta = E.conta, usados = new Set();
  for (const l of E.linhas) {
    l.dup = ''; const v = numero(l.valor); if (v == null || !l.data) continue;
    const mesmos = B.transacoes.filter(t => t.conta === conta && cents(t.valor) === cents(v) && !usados.has(t.id));
    const exato = mesmos.find(t => t.data === l.data);
    if (exato) { usados.add(exato.id); l.dup = `já existe no painel (${dbr(exato.data)} · ${exato.desc})`; l.incluir = false; continue; }
    const perto = mesmos.find(t => Math.abs(new Date(t.data) - new Date(l.data)) <= 6 * 864e5);
    if (perto) { usados.add(perto.id); l.dup = `parecido com ${dbr(perto.data)} · ${perto.desc} · ${brl(perto.valor)}`; l.incluir = false; }
  }
}
const numero = s => { if (s === '' || s == null) return null; const t = String(s).replace(/\s|R\$/g, ''); const neg = /^[-−]/.test(t); const n = Number(t.replace(/^[-−+]/, '').replace(/\./g, '').replace(',', '.')); return isFinite(n) && n > 0 ? (neg ? -n : n) : null; };

// ---------- montar a importação ----------
async function continuar(ctx, definirPrevia) {
  const erros = [];
  const inc = E.linhas.filter(l => l.incluir);
  for (const l of inc) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(l.data)) erros.push(`linha ${l.id + 1}: data`);
    if (numero(l.valor) == null) erros.push(`linha ${l.id + 1}: valor`);
    if (!l.descricao || l.descricao.trim().length < 2) erros.push(`linha ${l.id + 1}: descrição`);
  }
  if (!inc.length) return toast('Nenhum lançamento marcado para importar. Para deixar este arquivo de fora, use “Pular este arquivo”.');
  if (!E.conta) { E.aviso = 'Escolha a conta ou o cartão deste arquivo.'; ctx.rerender(); return; }
  if (erros.length) { E.aviso = 'Corrija antes de continuar: ' + erros.slice(0, 6).join(', ') + (erros.length > 6 ? '…' : ''); ctx.rerender(); return; }
  if (E.conta !== 'BB' && !/^\d{4}-\d{2}-\d{2}$/.test(E.venc)) { E.aviso = 'Informe o vencimento da fatura.'; ctx.rerender(); return; }
  const conta = E.conta, tipo = conta === 'BB' ? 'extrato' : 'fatura';
  const linhas = inc.map(l => ({ data: l.data, dataLancamento: l.data, descricao: l.descricao.trim(), lancamento: l.descricao.trim(), detalhe: l.texto || '', valor: numero(l.valor), cartao4: (l.cartao4 || '').trim(), parcela: l.parcela ? (/^parcela/i.test(l.parcela) ? l.parcela : `Parcela ${l.parcela}`) : '', competencia: null }))
    .sort((a, b) => a.data.localeCompare(b.data));
  const datas = linhas.map(l => l.data).sort();
  const soma = Math.round(-linhas.reduce((a, l) => a + l.valor, 0) * 100) / 100;
  const B = ctx.B;
  let fatura = null;
  if (tipo === 'fatura') {
    const id = `${conta}-${E.venc.slice(0, 7)}`;
    fatura = B.faturas.find(f => f.id === id) || { id, cartao: conta, competencia: E.venc.slice(0, 7), periodoInicio: datas[0], fechamento: null, vencimento: E.venc, proximoFechamento: null, totalAPagar: E.total, faturaAnterior: null, pagamentoRecebido: null, totalCompras: null, outrosLancamentos: null, pagamentos: [], origem: 'foto' };
  }
  const O = E.origem;
  const doc = { instituicao: CONTAS[conta] || conta, conta, tipo, formato: O ? `${O.formato} (leitura genérica)` : 'Foto', revisado: true, periodoInicio: datas[0], periodoFim: datas[datas.length - 1], linhas, fatura };
  const hash = O ? O.hash : await sha256(new TextEncoder().encode(E.imagens.map(i => i.hash).sort().join('|') || E.texto));
  const onde = O ? 'no arquivo' : 'na foto';
  const conferencia = E.total != null && tipo === 'fatura'
    ? { ok: Math.abs(soma - E.total) < 0.005 ? true : null, texto: Math.abs(soma - E.total) < 0.005 ? `Soma dos lançamentos (${brl(soma)}) = total lido ${onde}. Confere.` : `Soma dos lançamentos marcados: ${brl(soma)}. Total lido ${onde}: ${brl(E.total)} (o total da fatura pode incluir saldo anterior, juros ou lançamentos de outras páginas).` }
    : { ok: null, texto: `Sem total ${onde} para conferir. Soma dos lançamentos marcados: ${brl(soma)}.` };
  const nome = O ? O.nome : E.imagens.length ? `Foto da fatura ${CONTAS[conta] || conta}${E.imagens.length > 1 ? ` (${E.imagens.length} imagens)` : ''}` : `Texto colado (${CONTAS[conta] || conta})`;
  const lido = { nome, hash, tamanho: O ? O.tamanho : E.imagens.reduce((a, i) => a + i.tamanho, 0), doc, leitor: O ? `Leitura genérica (${O.formato}) com a sua revisão` : 'Foto (OCR/Texto ao Vivo) com revisão', conferencia };
  const info = O ? null : { lidos: E.linhas.length, desmarcados: E.linhas.length - inc.length, duvidas: inc.filter(l => l.duvidas.length).length, repetidas: E.repetidas };
  E.acumulados.push(lido);
  if (E.fila.length) { proximo(ctx); window.scrollTo(0, 0); return; }
  finalizar(definirPrevia, B, info);
}

// ---------- tela ----------
const chip = t => `<span class="st pendente" style="text-transform:none;letter-spacing:0">${esc(t)}</span>`;
export function render({ B }) {
  const opConta = ['Nu', 'Porto', 'BB'].map(c => `<option value="${c}" ${E.conta === c ? 'selected' : ''}>${c === 'BB' ? 'Banco do Brasil (extrato)' : esc(CONTAS[c] || c)}</option>`).join('');
  const escolher = `<div class="acts">
      <label class="btn pri">📷 Tirar foto<input type="file" accept="image/*" capture="environment" data-foto hidden></label>
      <label class="btn">🖼 Escolher da galeria<input type="file" accept="image/*,.heic,.heif" multiple data-foto hidden></label>
      <button class="btn ghost" type="button" data-colar-direto>Colar texto</button></div>`;
  if (E.fase === 'inicio') return `<div class="panel"><h2>Fatura por foto <small>galeria ou câmera · lida neste aparelho</small></h2>${escolher}
    <p class="note">Tire a foto de frente, com boa luz e sem reflexo; uma foto por tela ou página. Pode escolher várias fotos da mesma fatura: lançamentos repetidos entre elas entram uma vez só. Depois da leitura você confere e corrige cada lançamento antes de importar. As fotos não são guardadas nem enviadas.</p></div>`;
  if (E.fase === 'preparando') return `<div class="panel"><h2>Fatura por foto</h2><p class="note">Abrindo as imagens…</p></div>`;
  const miniaturas = E.imagens.length ? `<div class="fotos">${E.imagens.map((i, n) => `<figure><img src="${i.url}" alt="Foto ${n + 1}"><figcaption>${n + 1}. ${esc(i.nome)}${i.contrasteBaixo ? '<br><span class="neg">pouco contraste: pode não dar para ler</span>' : ''}</figcaption></figure>`).join('')}</div>` : '';
  const config = `<div class="form"><label>Conta ou cartão<select data-conta><option value="">${E.origem ? 'Escolha…' : 'Descobrir pela foto'}</option>${opConta}</select></label>
      ${E.conta === 'BB' ? '' : `<label>Vencimento da fatura<input type="date" data-venc value="${esc(E.venc)}"></label>`}</div>
      <p class="note">${E.conta === 'BB' ? 'Extrato de conta: cada lançamento entra pela data dele.' : 'A fatura é definida pelo vencimento (não pela data de cada compra). Se a foto mostrar o vencimento, ele é lido automaticamente.'}</p>`;
  const sair = E.origem ? `<button class="btn ghost" type="button" data-foto-pular>Pular este arquivo</button>` : `<button class="btn ghost" type="button" data-foto-cancelar>Cancelar</button>`;
  const origem = E.origem ? `<div class="banner">“${esc(E.origem.nome)}” (${esc(E.origem.formato)}) não tem leitor próprio: foi lido de forma genérica. Confira a conta, o vencimento, os sinais e os valores antes de importar. Nada é gravado sem a sua confirmação.${E.fila.length ? ` Depois deste: mais ${E.fila.length} arquivo(s).` : ''}</div>${E.avisos.map(a => `<p class="note">${esc(a)}</p>`).join('')}` : '';
  if (E.fase === 'fotos' || E.fase === 'lendo') {
    const permitido = B.meta && B.meta.ocrPermitido;
    return `<div class="panel"><h2>Fatura por foto <small>${E.imagens.length} imagem(ns)</small></h2>${miniaturas}${config}
      ${E.erro ? `<div class="banner" style="border-left-color:var(--neg)">${esc(E.erro)}</div>` : ''}
      ${E.fase === 'lendo' ? `<p class="note" data-progresso>Preparando o leitor…</p>` : `
      <div class="acts"><button class="btn pri" type="button" data-ler>Ler automaticamente</button><button class="btn" type="button" data-colar>Usar Texto ao Vivo do iPhone</button>${sair}</div>
      ${permitido ? '' : `<p class="note"><b>Ler automaticamente</b> usa o leitor de texto Tesseract.js (código aberto). Na primeira vez ele é baixado de <code>cdn.jsdelivr.net</code> (≈ ${OCR.tamanhoMB} MB) e fica guardado no aparelho. Só o programa é baixado: <b>suas fotos não saem do celular</b>. O painel vai pedir sua confirmação antes de baixar.</p>`}
      <p class="note"><b>Texto ao Vivo</b> usa o reconhecimento do próprio iPhone: nada é baixado.</p>`}</div>`;
  }
  if (E.fase === 'colar') return `<div class="panel"><h2>Texto ao Vivo do iPhone</h2>
      <ol class="note" style="margin:0;padding-left:18px"><li>Toque e segure sobre o texto da foto abaixo até aparecer a seleção (ou toque no ícone de texto no canto da foto).</li><li>Toque em <b>Selecionar Tudo</b> e depois em <b>Copiar</b>.</li><li>Toque na caixa abaixo e cole. Com várias fotos, cole uma depois da outra.</li></ol>
      ${E.imagens.length ? `<div class="fotos grande">${E.imagens.map((i, n) => `<figure><img src="${i.urlOriginal}" alt="Foto ${n + 1}"></figure>`).join('')}</div>` : ''}
      ${config}<label class="fl">Texto copiado<textarea data-texto rows="10" placeholder="Cole aqui o texto da fatura">${esc(E.texto)}</textarea></label>
      <div class="acts"><button class="btn pri" type="button" data-ler-colado>Ler texto</button>${sair}</div></div>`;
  if (E.fase === 'vazio') return `<div class="panel"><h2>Não deu para ler lançamentos${E.origem ? ` <small>${esc(E.origem.nome)}</small>` : ''}</h2>
      <p>Nenhuma linha com data e valor foi reconhecida${E.texto.trim() ? '' : ' (a imagem parece sem texto legível)'}. Nada foi inventado nem importado.</p>
      <ul class="note" style="margin:0;padding-left:18px"><li>Tire outra foto mais de perto, de frente, com boa luz e sem reflexo.</li><li>Se a fatura for do app, prefira o print da tela (é mais nítido que foto da tela).</li><li>Se tiver o PDF da fatura, envie o PDF: a leitura é exata.</li></ul>
      ${E.texto.trim() ? `<details class="sec"><summary><span><span class="car">▸</span>Texto que foi lido</span></summary><div class="in"><pre style="white-space:pre-wrap;font-size:.78rem;margin:0">${esc(E.texto.slice(0, 4000))}</pre></div></details>` : ''}
      <div class="acts">${E.imagens.length ? '<button class="btn" type="button" data-colar>Tentar com Texto ao Vivo</button>' : ''}${sair}</div></div>`;
  // revisão
  const inc = E.linhas.filter(l => l.incluir), duv = inc.filter(l => l.duvidas.length).length, dups = E.linhas.filter(l => l.dup).length;
  const soma = Math.round(-inc.reduce((a, l) => a + (numero(l.valor) || 0), 0) * 100) / 100;
  const linha = l => `<tr class="${l.incluir ? '' : 'muted'}" data-l="${l.id}">
      <td><input type="checkbox" data-c="incluir" ${l.incluir ? 'checked' : ''} aria-label="Importar esta linha"></td>
      <td><input type="date" data-c="data" value="${esc(l.data)}" class="${l.data ? '' : 'inval'}"></td>
      <td><input type="text" data-c="descricao" value="${esc(l.descricao)}" class="${l.descricao.trim().length < 3 ? 'inval' : ''}"></td>
      <td><input type="text" data-c="valor" inputmode="decimal" value="${esc(l.valor)}" class="r ${numero(l.valor) == null ? 'inval' : ''}" style="width:7.5em"></td>
      <td><input type="text" data-c="parcela" value="${esc(l.parcela)}" placeholder="parcela" style="width:7em"></td>
      <td><input type="text" data-c="cartao4" value="${esc(l.cartao4)}" placeholder="final" maxlength="4" inputmode="numeric" style="width:4.2em"></td>
      <td>${l.dup ? chip(l.dup) + ' ' : ''}${l.duvidas.map(chip).join(' ')}${l.texto ? `<div class="note" title="texto lido">“${esc(l.texto.slice(0, 90))}”</div>` : ''}</td></tr>`;
  return `<div class="panel"><h2>Confira antes de importar <small>${E.linhas.length} lançamento(s) lido(s)${E.imagens.length ? ` de ${E.imagens.length} imagem(ns)` : ''}</small></h2>
    <div class="res"><div><span>Lidos</span><b>${E.linhas.length}</b></div><div><span>Marcados</span><b>${inc.length}</b></div><div><span>Com dúvida</span><b>${duv}</b></div><div><span>Possíveis duplicatas</span><b>${dups}</b></div><div><span>Repetidos entre fotos</span><b>${E.repetidas}</b></div><div><span>Soma marcada</span><b style="font-size:1rem">${brl(soma)}</b></div></div>
    ${origem}${config}
    ${E.total != null ? `<p class="note">Total lido ${E.origem ? 'no arquivo' : 'na foto'}: <b>${brl(E.total)}</b> · soma dos marcados: <b>${brl(soma)}</b> ${Math.abs(E.total - soma) < 0.005 ? '<span class="pos">✓ confere</span>' : '<span class="neg">diferente (confira se falta alguma linha ou foto; o total pode incluir saldo anterior ou juros)</span>'}</p>` : ''}
    ${E.pagamentos.length ? `<p class="note">${E.pagamentos.length} pagamento(s) de fatura encontrados ${E.origem ? 'no arquivo' : 'na foto'} não entram como gasto.</p>` : ''}
    <p class="note">Sinais: compra = valor negativo (ex.: -23,40); estorno/crédito = positivo. Linhas com aviso em vermelho precisam da sua conferência. Os desmarcados não são importados. Valores e datas vazios não são preenchidos por conta própria.</p>
    ${E.aviso ? `<div class="banner" style="border-left-color:var(--neg)">${esc(E.aviso)}</div>` : ''}
    <div class="tbl"><table class="rev"><tr><th></th><th>Data</th><th>Descrição</th><th class="r">Valor</th><th>Parcela</th><th>Cartão</th><th>Avisos</th></tr>${E.linhas.map(linha).join('')}</table></div>
    <div class="acts"><button class="btn sm ghost" type="button" data-nova-linha>+ Adicionar linha</button><button class="btn sm ghost" type="button" data-inverter>Inverter sinais</button></div>
    ${E.ignoradas.length ? `<details class="sec"><summary><span><span class="car">▸</span>Linhas ignoradas (${E.ignoradas.length})</span></summary><div class="in"><ul class="note" style="margin:0;padding-left:18px">${E.ignoradas.map(i => `<li>${esc(i.texto)} — ${esc(i.motivo)}</li>`).join('')}</ul></div></details>` : ''}
    <div class="acts"><button class="btn pri" type="button" data-continuar>Continuar para a importação (${inc.length})</button>${sair}</div></div>`;
}

export function ligar(root, ctx, definirPrevia) {
  root.querySelectorAll('[data-foto]').forEach(inp => inp.onchange = () => { const fs = [...inp.files]; inp.value = ''; if (fs.length) adicionarImagens(fs, ctx); });
  const q = s => root.querySelector(s);
  if (q('[data-conta]')) q('[data-conta]').onchange = e => { E.conta = e.target.value; if (E.origem && E.paginas) { interpretar(E.paginas, ctx); return; } if (!E.venc && E.conta && E.conta !== 'BB') { E.venc = vencPadrao(E.conta, ctx.B); E.vencAuto = true; } if (E.fase === 'revisao') marcarDuplicatas(ctx.B); ctx.rerender(); };
  if (q('[data-venc]')) q('[data-venc]').onchange = e => { E.venc = e.target.value; E.vencAuto = false; };
  if (q('[data-foto-cancelar]')) q('[data-foto-cancelar]').onclick = () => { limpar(); ctx.rerender(); };
  if (q('[data-foto-pular]')) q('[data-foto-pular]').onclick = () => { if (E.fila.length) { proximo(ctx); return; } finalizar(definirPrevia, ctx.B, null); ctx.rerender(); };
  if (q('[data-inverter]')) q('[data-inverter]').onclick = () => { for (const l of E.linhas) { const v = numero(l.valor); if (v != null) l.valor = fmt(-v); } marcarDuplicatas(ctx.B); ctx.rerender(); };
  if (q('[data-colar]')) q('[data-colar]').onclick = () => { E.fase = 'colar'; ctx.rerender(); };
  if (q('[data-colar-direto]')) q('[data-colar-direto]').onclick = () => { E.fase = 'colar'; ctx.rerender(); };
  if (q('[data-ler-colado]')) q('[data-ler-colado]').onclick = () => { const t = q('[data-texto]').value; if (!t.trim()) return toast('Cole o texto primeiro.'); lerColado(t, ctx); };
  if (q('[data-ler]')) q('[data-ler]').onclick = async () => {
    if (!(ctx.B.meta && ctx.B.meta.ocrPermitido)) {
      if (!confirm(`Baixar o leitor de texto (Tesseract.js, ≈ ${OCR.tamanhoMB} MB) de cdn.jsdelivr.net?\n\nSó o programa é baixado, uma vez. Suas fotos não são enviadas: a leitura acontece neste aparelho.`)) return;
      await gravar([{ store: 'meta', put: { chave: 'ocrPermitido', valor: { em: new Date().toISOString(), versao: OCR.versao } } }]); ctx.B.meta.ocrPermitido = true;
    }
    lerAutomatico(ctx);
  };
  if (q('[data-nova-linha]')) q('[data-nova-linha]').onclick = () => { E.linhas.push({ id: E.linhas.length, incluir: true, data: '', descricao: '', valor: '', parcela: '', cartao4: '', duvidas: ['adicionada à mão'], texto: '' }); ctx.rerender(); };
  if (q('[data-continuar]')) q('[data-continuar]').onclick = () => continuar(ctx, definirPrevia);
  const tab = q('table.rev');
  if (tab) {
    tab.addEventListener('change', e => {
      const tr = e.target.closest('tr[data-l]'); if (!tr) return; const l = E.linhas[+tr.dataset.l]; const c = e.target.dataset.c;
      if (c === 'incluir') l.incluir = e.target.checked; else l[c] = e.target.value;
      if (c === 'valor') e.target.classList.toggle('inval', numero(l.valor) == null);
      if (c === 'data') e.target.classList.toggle('inval', !l.data);
      if (c === 'incluir') { tr.classList.toggle('muted', !l.incluir); const b = q('[data-continuar]'); if (b) b.textContent = `Continuar para a importação (${E.linhas.filter(x => x.incluir).length})`; }
    });
  }
}
