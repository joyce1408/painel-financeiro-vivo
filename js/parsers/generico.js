// Leitura GENÉRICA para arquivos de qualquer banco que não têm leitor próprio: CSV/TXT de planilha e OFX.
// Não adivinha valores: só aproveita linhas que têm data, valor e descrição legíveis. O resultado sempre passa
// pela tela de revisão (a mesma da foto) antes de qualquer gravação.
import { iso } from '../utils.js';
import { detectarInstituicao } from './texto-fatura.js';

const semAcento = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const cab = s => semAcento(s).toLowerCase().replace(/[^a-z0-9/]+/g, ' ').trim();
const RESUMO = /^\s*(saldo|total|subtotal|s\s*a\s*l\s*d\s*o)\b/i;
const PARCELA = /\b(?:parcela|parc\.?)?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i;

// ---------- valores e datas ----------
// Aceita "1.234,56", "1234,56", "1234.56", "-12,30", "(12,30)", "12,30-", "R$ 12,30", "12,30 D" / "12,30 C".
export function lerValor(s) {
  let t = String(s ?? '').trim(); if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  const dc = t.match(/\s*([DC])$/i); if (dc) { if (dc[1].toUpperCase() === 'D') neg = !neg; t = t.slice(0, dc.index); }
  t = t.replace(/R\$|BRL|\s/gi, '');
  if (/^[-−]/.test(t)) { neg = !neg; t = t.slice(1); } else if (/[-−]$/.test(t)) { neg = !neg; t = t.slice(0, -1); } else if (/^\+/.test(t)) t = t.slice(1);
  let n;
  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(t) || /^\d+,\d{1,2}$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'));
  else if (/^\d{1,3}(,\d{3})*\.\d{1,2}$/.test(t) || /^\d+\.\d{1,2}$/.test(t)) n = Number(t.replace(/,/g, ''));
  else if (/^\d+$/.test(t)) n = Number(t);
  else return null;
  if (!isFinite(n)) return null;
  return Math.round((neg ? -n : n) * 100) / 100;
}
export function lerData(s, anoRef) {
  const t = String(s ?? '').trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/);
  if (m) return valida(+m[1], +m[2], +m[3]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?:\s.*)?$/);
  if (m) return valida(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m && anoRef) return valida(anoRef, +m[2], +m[1]);
  return null;
}
function valida(a, mes, d) {
  if (a < 2000 || a > 2100 || mes < 1 || mes > 12 || d < 1 || d > 31) return null;
  const x = new Date(a, mes - 1, d); return x.getMonth() === mes - 1 ? iso(a, mes, d) : null;
}

// ---------- CSV ----------
function separar(linha, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (q) { if (c === '"' && linha[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur); return out.map(x => x.trim());
}
function escolherSeparador(linhas) {
  let melhor = ',', nota = -1;
  for (const s of [';', ',', '\t', '|']) {
    const n = linhas.slice(0, 30).map(l => separar(l, s).length);
    const comuns = n.filter(x => x >= 3); if (!comuns.length) continue;
    const moda = comuns.sort((a, b) => comuns.filter(v => v === a).length - comuns.filter(v => v === b).length).pop();
    const v = comuns.filter(x => x === moda).length * Math.min(moda, 8);
    if (v > nota) { nota = v; melhor = s; }
  }
  return melhor;
}
const NOMES = {
  data: /^(data|date|dt|data (da )?(compra|transacao|lancamento|movimento|mov)|dia)$|^data\b/,
  desc: /(descri|historico|title|titulo|estabelecimento|lancamento|memo|detalhe|nome|favorecido|loja|transacao|description)/,
  valor: /^(valor|amount|value|quantia|montante|valor (r ?\$|brl|em reais|da compra|da transacao|lancamento|original))$|^valor\b|amount/,
  debito: /^(debito|debitos|saida|saidas|valor debito|debit)$/,
  credito: /^(credito|creditos|entrada|entradas|valor credito|credit)$/,
  dc: /^(d ?\/ ?c|c ?\/ ?d|tipo( de)?( lancamento| movimento| transacao| operacao)?|natureza|sinal|entrada ?\/ ?saida|e ?\/ ?s)$/,
  saldo: /saldo|balance/,
  parcela: /parcela|installment/,
};
// Devolve { linhas, ignoradas, colunas, convencao: 'compra-positiva'|'saida-negativa', avisos } ou null.
export function lerCSVGenerico(texto, opc = {}) {
  const brutas = String(texto).replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (brutas.length < 1) return null;
  const sep = escolherSeparador(brutas);
  const rows = brutas.map(l => separar(l, sep));
  const largura = Math.max(...rows.map(r => r.length));
  if (largura < 2) return null;
  // cabeçalho: a primeira das 15 primeiras linhas que nomeia uma coluna de data e uma de valor
  let hi = -1;
  for (let i = 0; i < Math.min(15, rows.length); i++) { const h = rows[i].map(cab); if (h.some(x => NOMES.data.test(x)) && h.some(x => NOMES.valor.test(x) || NOMES.debito.test(x) || NOMES.credito.test(x))) { hi = i; break; } }
  const head = hi >= 0 ? rows[hi].map(cab) : [];
  const dados = rows.slice(hi + 1);
  // perfil de cada coluna pelos dados
  const perfil = Array.from({ length: largura }, (_, c) => {
    const vs = dados.map(r => r[c] ?? '').filter(Boolean);
    return { c, nome: head[c] || '', n: vs.length, datas: vs.filter(v => lerData(v)).length, valores: vs.filter(v => !lerData(v) && lerValor(v) != null && /([.,]\d{1,2}|R\$)/.test(v)).length, texto: vs.reduce((a, v) => a + (/[a-zA-ZÀ-ú]{3}/.test(v) ? v.length : 0), 0) / Math.max(1, vs.length) };
  });
  const porNome = re => perfil.find(p => p.nome && re.test(p.nome));
  const avisos = [];
  const colData = porNome(NOMES.data) || perfil.filter(p => p.datas >= p.n * 0.6 && p.n).sort((a, b) => b.datas - a.datas)[0];
  if (!colData) return null;
  const colDeb = porNome(NOMES.debito), colCred = porNome(NOMES.credito);
  let colValor = perfil.find(p => p.nome && NOMES.valor.test(p.nome) && !NOMES.saldo.test(p.nome) && p !== colData);
  if (!colValor && !(colDeb && colCred)) {
    const cands = perfil.filter(p => p !== colData && !NOMES.saldo.test(p.nome) && p.valores >= p.n * 0.6 && p.n);
    if (cands.length > 1) avisos.push('O arquivo tem mais de uma coluna de valores; foi usada a primeira. Confira os valores.');
    colValor = cands[0];
  }
  if (!colValor && !(colDeb && colCred)) return null;
  const usadas = new Set([colData, colValor, colDeb, colCred].filter(Boolean).map(p => p.c));
  const colDesc = porNome(NOMES.desc) && !usadas.has(porNome(NOMES.desc).c) ? porNome(NOMES.desc) : perfil.filter(p => !usadas.has(p.c) && !NOMES.saldo.test(p.nome)).sort((a, b) => b.texto - a.texto)[0];
  if (!colDesc) return null;
  const colDC = porNome(NOMES.dc), colParc = porNome(NOMES.parcela);
  const linhas = [], ignoradas = [];
  for (const r of dados) {
    const txt = r.join(' · ');
    const data = lerData(r[colData.c], opc.anoRef);
    let valor = null;
    if (colValor) valor = lerValor(r[colValor.c]);
    else { const d = lerValor(r[colDeb.c]), c = lerValor(r[colCred.c]); if (d != null || c != null) valor = Math.round(((c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0)) * 100) / 100; }
    if (colDC && valor != null) { const s = cab(r[colDC.c]); if (/^(d|debito|saida|-)$|^(debito|saida)/.test(s)) valor = -Math.abs(valor); else if (/^(c|credito|entrada|\+)$|^(credito|entrada)/.test(s)) valor = Math.abs(valor); }
    const desc = String(r[colDesc.c] ?? '').trim();
    if (!data && !valor) continue; // linha de título, rodapé ou vazia
    if (RESUMO.test(desc)) { ignoradas.push({ texto: txt, motivo: 'linha de saldo/total (não é lançamento)' }); continue; }
    if (!data || valor == null || valor === 0 || desc.replace(/[^A-Za-zÀ-ú]/g, '').length < 2) { ignoradas.push({ texto: txt, motivo: 'sem data, valor ou descrição legível' }); continue; }
    const p = (colParc ? String(r[colParc.c] || '') : '').match(PARCELA) || desc.match(/\bparcela\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i) || desc.match(/\s-\s(\d{1,2})\/(\d{1,2})$/);
    linhas.push({ data, descricao: desc.replace(/\s*-\s*parcela\s*\d{1,2}\s*(?:\/|de)\s*\d{1,2}\s*$/i, '').trim(), valor, parcela: p ? `Parcela ${+p[1]}/${+p[2]}` : '', texto: txt, duvidas: [] });
  }
  if (!linhas.length) return null;
  // Convenção de sinal: em faturas de cartão exportadas (ex.: Nubank "date,title,amount") a compra vem POSITIVA
  // e o pagamento/estorno negativo. Em extratos de conta a saída vem negativa.
  const pos = linhas.filter(l => l.valor > 0).length;
  const formatoNubank = head.includes('title') && head.includes('amount');
  const nomeCartao = /fatura|cartao|card|nubank|credit/i.test(semAcento(opc.nomeArquivo || ''));
  const convencao = !colDeb && !colDC && (formatoNubank || (pos >= linhas.length * 0.6 && (nomeCartao || opc.cartao))) ? 'compra-positiva' : 'saida-negativa';
  return { linhas, ignoradas, avisos, convencao, colunas: { data: colData.nome || `coluna ${colData.c + 1}`, descricao: colDesc.nome || `coluna ${colDesc.c + 1}`, valor: colValor ? colValor.nome || `coluna ${colValor.c + 1}` : 'débito/crédito' } };
}

// ---------- OFX (padrão de exportação de bancos e cartões) ----------
export function lerOFX(texto) {
  const t = String(texto);
  if (!/<OFX>|OFXHEADER/i.test(t)) return null;
  const campo = (bloco, n) => { const m = bloco.match(new RegExp(`<${n}>([^<\\r\\n]*)`, 'i')); return m ? m[1].trim() : ''; };
  const cartao = /<CREDITCARDMSGSRSV1>|<CCSTMTRS>/i.test(t);
  const linhas = [], ignoradas = [];
  for (const b of t.split(/<STMTTRN>/i).slice(1)) {
    const bloco = b.split(/<\/STMTTRN>/i)[0];
    const d = campo(bloco, 'DTPOSTED').match(/^(\d{4})(\d{2})(\d{2})/);
    const valor = lerValor(campo(bloco, 'TRNAMT').replace(',', '.'));
    const desc = [campo(bloco, 'NAME'), campo(bloco, 'MEMO')].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(' - ');
    const data = d ? valida(+d[1], +d[2], +d[3]) : null;
    if (!data || valor == null || !desc) { ignoradas.push({ texto: bloco.replace(/\s+/g, ' ').slice(0, 120), motivo: 'sem data, valor ou descrição' }); continue; }
    const p = desc.match(/\bparcela\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i);
    linhas.push({ data, descricao: desc, valor, parcela: p ? `Parcela ${+p[1]}/${+p[2]}` : '', texto: `${campo(bloco, 'DTPOSTED').slice(0, 8)} ${campo(bloco, 'TRNAMT')} ${desc}`, duvidas: [], fitid: campo(bloco, 'FITID') });
  }
  if (!linhas.length) return null;
  return { linhas, ignoradas, avisos: [], convencao: 'saida-negativa', cartao, banco: campo(t, 'ORG') };
}

// Conta provável pelo nome do arquivo e pelo texto (só sugestão: você escolhe na revisão).
export function sugerirConta(nome, texto) {
  const i = detectarInstituicao(`${nome}\n${String(texto).slice(0, 4000)}`);
  return i || '';
}
// Vencimento no nome do arquivo (ex.: "Nubank_2026-11-19.csv"). Só sugestão.
export function vencimentoNoNome(nome) {
  const m = String(nome).match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  return m ? valida(+m[1], +m[2], +m[3]) : null;
}
