// Importação incremental: arquivo → leitura → identificação → impressão digital → classificação → revisão → gravação.
import { sha256, uid, sum, cents, brl, dbr } from './utils.js';
import { identificar } from './parsers/index.js';
import { linhasDoPDF } from './pdftext.js';
import { carimbar } from './fingerprint.js';
import { classificar, indiceHistorico } from './classify.js';
import { gravar } from './db.js';

export const MSG_INSEGURO = 'Não foi possível identificar este lançamento com segurança.';

function texto(buf) {
  const u = new TextDecoder('utf-8').decode(buf);
  return u.includes('�') ? new TextDecoder('windows-1252').decode(buf) : u;
}

// Lê um arquivo e devolve o documento padronizado (ou o motivo de não conseguir).
export async function lerArquivo(file) {
  const buf = await file.arrayBuffer();
  const r = { nome: file.name, tamanho: file.size, hash: await sha256(buf) };
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  try {
    let txt, linhas = null;
    if (ext === 'pdf' || file.type === 'application/pdf') { linhas = await linhasDoPDF(buf); txt = linhas.join('\n'); }
    else if (['csv', 'txt'].includes(ext) || /text|csv/.test(file.type)) txt = texto(buf);
    else if (/^image\//.test(file.type) || ['png', 'jpg', 'jpeg', 'heic', 'webp'].includes(ext)) { r.erro = 'Imagens (prints) não são lidas automaticamente. Se for uma compra, lance à mão em "Importar › Lançamento manual".'; return r; }
    else { r.erro = `Formato .${ext} ainda não tem leitor. Envie um exemplo para o Claude criar o leitor deste banco.`; return r; }
    const id = identificar(txt);
    if (!id) { r.erro = linhas && txt.replace(/--- fim da página ---/g, '').trim().length < 30 ? 'Este PDF não tem texto (parece ser imagem escaneada). Não dá para ler com segurança.' : 'Não reconheci de qual banco é este arquivo. Envie um exemplo para o Claude criar o leitor.'; return r; }
    r.doc = id.formato === 'csv' ? id.leitor.lerCSV(txt) : id.leitor.lerPDF(linhas);
    r.leitor = id.leitor.nome;
    r.conferencia = conferir(r.doc);
  } catch (e) { r.erro = 'Erro ao ler o arquivo: ' + e.message; }
  return r;
}

// Confere os totais do próprio documento: se não bate, algo não foi lido e o arquivo vai para revisão.
export function conferir(doc) {
  if (doc.tipo === 'extrato' && doc.saldoInicial != null && doc.saldoFinal != null) {
    const calc = Math.round((doc.saldoInicial + sum(doc.linhas)) * 100) / 100;
    const ok = cents(calc) === cents(doc.saldoFinal);
    return { ok, texto: ok ? `Saldo inicial ${brl(doc.saldoInicial)} + lançamentos = saldo final ${brl(doc.saldoFinal)}. Confere.` : `Saldo calculado ${brl(calc)} diferente do saldo final do extrato ${brl(doc.saldoFinal)}. Algum lançamento não foi lido.` };
  }
  if (doc.tipo === 'fatura' && doc.fatura.totalCompras != null) {
    const esp = Math.round((doc.fatura.totalCompras + (doc.fatura.outrosLancamentos || 0)) * 100) / 100, lido = -sum(doc.linhas);
    const ok = Math.abs(lido - esp) < 0.005 && !(doc.naoLidas || []).length;
    return { ok, texto: ok ? `Compras + outros lançamentos da fatura (${brl(esp)}) = soma dos lançamentos lidos. Confere.` : `A fatura informa ${brl(esp)} e foram lidos ${brl(lido)}.${(doc.naoLidas || []).length ? ` ${doc.naoLidas.length} linha(s) não lida(s).` : ''}` };
  }
  return { ok: null, texto: 'Sem total no documento para conferir.' };
}

// Monta a prévia: o que é novo, o que já existe, como foi classificado. Nada é gravado aqui.
export function prepararImportacao(lidos, B) {
  const hist = indiceHistorico(B.transacoes);
  const vistos = new Set();
  const novos = [], erros = [], arquivos = [];
  const ctx = [...B.transacoes];
  for (const r of lidos) {
    const a = { nome: r.nome, hash: r.hash, tamanho: r.tamanho, erro: r.erro || null, jaImportado: B.arquivos.find(x => x.hash === r.hash) || null, encontrados: 0, novos: 0, existentes: 0 };
    arquivos.push(a);
    if (a.jaImportado) a.aviso = `Este arquivo já foi importado em ${dbr(a.jaImportado.importadoEm.slice(0, 10))}.`;
    if (!r.doc) { erros.push({ arquivo: r.nome, motivo: r.erro }); continue; }
    const d = r.doc;
    Object.assign(a, { instituicao: d.instituicao, conta: d.conta, tipo: d.tipo, formato: d.formato, leitor: r.leitor, periodoInicio: d.periodoInicio, periodoFim: d.periodoFim, conferencia: r.conferencia, fatura: d.fatura || null });
    if (d.fatura) a.faturaExiste = !!B.faturas.find(f => f.id === d.fatura.id);
    for (const nl of d.naoLidas || []) erros.push({ arquivo: r.nome, linha: nl, motivo: MSG_INSEGURO });
    for (const l of carimbar(d.linhas, d.conta)) {
      a.encontrados++;
      if (B.origens.has(l.fp) || vistos.has(l.fp)) { a.existentes++; continue; }
      vistos.add(l.fp); a.novos++;
      const c = classificar({ ...l, conta: d.conta }, B.regras, hist, ctx);
      const t = {
        id: uid('t'), data: l.data, mes: (c.cat === 'Previdência (INSS)' && l.competencia) ? l.competencia : l.data.slice(0, 7),
        conta: c.contaGasto || d.conta, cartao: c.cartao || '', forma: c.forma || '', desc: c.desc || l.descricao, descOriginal: l.descricao,
        lancamento: l.lancamento || '', valor: l.valor, tipo: c.tipo, mov: c.mov, cat: c.cat, sub: c.sub, obs: c.obs || '', parcela: l.parcela || '',
        faturaId: d.fatura ? d.fatura.id : null, fonteFp: l.fp, arquivo: r.nome, instituicao: d.instituicao,
        status: c.status, classificacao: c.classificacao, motivo: c.motivo, regraId: c.regraId || null,
      };
      novos.push(t); ctx.push(t);
    }
  }
  const resumo = {
    encontrados: arquivos.reduce((s, a) => s + a.encontrados, 0), novos: novos.length,
    existentes: arquivos.reduce((s, a) => s + a.existentes, 0),
    classificados: novos.filter(t => t.status !== 'pendente').length, pendentes: novos.filter(t => t.status === 'pendente').length, erros: erros.length,
  };
  return { arquivos, novos, erros, resumo, lidos };
}

// Status das faturas: só vira "paga" quando a fatura seguinte registra o pagamento recebido.
export function statusFaturas(faturas, hoje = new Date().toISOString().slice(0, 10)) {
  const porCartao = {};
  faturas.forEach(f => (porCartao[f.cartao] = porCartao[f.cartao] || []).push(f));
  const out = [];
  for (const fs of Object.values(porCartao)) {
    fs.sort((a, b) => a.vencimento.localeCompare(b.vencimento));
    fs.forEach((f, i) => {
      const nx = fs[i + 1]; const g = { ...f };
      if (nx && nx.pagamentoRecebido != null) {
        g.pago = Math.min(nx.pagamentoRecebido, f.totalAPagar);
        g.status = nx.pagamentoRecebido + 0.005 >= f.totalAPagar ? 'paga' : 'parcial';
        g.statusFonte = `Fatura seguinte (${nx.id}) registra pagamento recebido de ${brl(nx.pagamentoRecebido)}.`;
      } else if (f.vencimento >= hoje) { g.status = 'aberta'; g.pago = null; g.statusFonte = `Vence em ${dbr(f.vencimento)}.`; }
      else { g.status = 'sem-confirmacao'; g.pago = null; g.statusFonte = 'O pagamento só é confirmado quando a fatura seguinte for importada.'; }
      out.push(g);
    });
  }
  return out;
}

// Grava a importação revisada, tudo de uma vez.
export async function confirmarImportacao(prev, B) {
  const id = uid('imp'), agora = new Date().toISOString();
  const ops = [];
  for (const t of prev.novos) {
    ops.push({ store: 'transacoes', put: { ...t, importacaoId: id, criadoEm: agora } });
    ops.push({ store: 'origens', put: { fp: t.fonteFp, conta: t.fonteFp.split('|')[0], data: t.data, valor: t.valor, arquivo: t.arquivo, importacaoId: id } });
  }
  const faturas = [...B.faturas];
  for (const a of prev.arquivos) {
    if (!a.instituicao) continue;
    if (!a.jaImportado) ops.push({ store: 'arquivos', put: { hash: a.hash, nome: a.nome, tamanho: a.tamanho, instituicao: a.instituicao, conta: a.conta, tipo: a.tipo, formato: a.formato, periodoInicio: a.periodoInicio, periodoFim: a.periodoFim, conferencia: a.conferencia, importacaoId: id, importadoEm: agora } });
    if (a.fatura && !faturas.find(f => f.id === a.fatura.id)) faturas.push({ ...a.fatura, arquivo: a.nome, importacaoId: id });
  }
  for (const f of statusFaturas(faturas)) ops.push({ store: 'faturas', put: f });
  const imp = { id, data: agora, descricao: prev.arquivos.map(a => a.nome).join(', '), status: 'concluida', arquivos: prev.arquivos.map(a => a.nome), ...prev.resumo, errosDetalhe: prev.erros, conferencias: prev.arquivos.map(a => ({ nome: a.nome, ...(a.conferencia || {}) })) };
  ops.push({ store: 'importacoes', put: imp });
  await gravar(ops);
  return imp;
}

// Desfaz uma importação: remove os lançamentos, as origens, os arquivos e as faturas que ela criou.
export async function desfazerImportacao(id, B) {
  const ops = [];
  B.transacoes.filter(t => t.importacaoId === id).forEach(t => ops.push({ store: 'transacoes', del: t.id }));
  B.origensLista.filter(o => o.importacaoId === id).forEach(o => ops.push({ store: 'origens', del: o.fp }));
  B.arquivos.filter(a => a.importacaoId === id).forEach(a => ops.push({ store: 'arquivos', del: a.hash }));
  const resto = B.faturas.filter(f => f.importacaoId !== id);
  B.faturas.filter(f => f.importacaoId === id).forEach(f => ops.push({ store: 'faturas', del: f.id }));
  statusFaturas(resto).forEach(f => ops.push({ store: 'faturas', put: f }));
  const imp = B.importacoes.find(i => i.id === id);
  ops.push({ store: 'importacoes', put: { ...imp, status: 'desfeita', desfeitaEm: new Date().toISOString() } });
  await gravar(ops);
}
