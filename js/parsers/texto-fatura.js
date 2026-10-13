// Lê o TEXTO de uma fatura ou extrato vindo de foto (OCR ou Texto ao Vivo do iPhone).
// Diferente dos leitores de PDF/CSV, aqui o texto pode ter erros de leitura: nada é inventado.
// Cada lançamento sai com a lista do que ficou duvidoso, para você conferir e corrigir antes de importar.
import { iso, MES_ABREV } from '../utils.js';

const MESES_TXT = { JAN: 1, FEV: 2, MAR: 3, ABR: 4, MAI: 5, JUN: 6, JUL: 7, AGO: 8, SET: 9, OUT: 10, NOV: 11, DEZ: 12, JANEIRO: 1, FEVEREIRO: 2, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6, JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12 };
const semAcento = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
// Linhas de resumo: não são lançamentos.
const RESUMO = /\b(total|subtotal|saldo|limite|pagamento m[ií]nimo|valor m[ií]nimo|fatura anterior|fatura atual|melhor dia|melhor data|vencimento|venc\.|pague|cr[eé]dito rotativo|parcelamento da fatura|encargos|juros do rotativo|taxa de juros|cet\b|custo efetivo|outros lan[cç]amentos|compras de todos|resumo|dispon[ií]vel)/i;
const PAGAMENTO = /\bpagamento (em|recebido|efetuado|da fatura)|\bpagto\b|\bpag fatura/i;
const CREDITO = /\b(estorno|cr[eé]dito de|reembolso|devolu[cç][aã]o|cashback)/i;

// Corrige letras lidas no lugar de números só DENTRO de valores (ex.: "R$ 1O,5O" → "R$ 10,50").
function arrumarValores(t) {
  return t.replace(/(R\s?\$|RS|R5)\s*([\dOoIlSB.,\s]{1,14},[\dOoIlSB]{2})(?![\d])/g, (m, r, v) => 'R$ ' + v.replace(/\s/g, '').replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/S/g, '5').replace(/B/g, '8'));
}
function normalizar(t) {
  return arrumarValores(String(t).replace(/[‒-―−]/g, '-').replace(/[|]/g, ' ').replace(/\s+/g, ' ').trim());
}
const VALOR = /(-\s*|\(\s*-\s*\)\s*)?(R\$\s*)?((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})(?!\d)(\s*\(\s*[+-]\s*\))?/g;
const brNum = s => Number(s.replace(/\./g, '').replace(',', '.'));

function acharValor(t) {
  const ms = [...t.matchAll(VALOR)]; if (!ms.length) return null;
  // prefere o que tem "R$"; senão, o último da linha
  const m = ms.filter(x => x[2]).pop() || ms[ms.length - 1];
  const sufixo = (m[4] || '').replace(/\s/g, '');
  return { bruto: m[0], valor: brNum(m[3]), negativo: !!(m[1] && m[1].includes('-')) || sufixo === '(-)', positivo: sufixo === '(+)', idx: m.index };
}
function acharData(t) {
  let m = t.match(/\b(\d{1,2})\s*[/.-]\s*(\d{1,2})(?:\s*[/.-]\s*(\d{4}|\d{2}))?\b/);
  if (m && +m[1] >= 1 && +m[1] <= 31 && +m[2] >= 1 && +m[2] <= 12) return { d: +m[1], m: +m[2], a: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null, bruto: m[0] };
  m = semAcento(t).toUpperCase().match(/\b(\d{1,2})\s*(?:DE\s+)?(JANEIRO|FEVEREIRO|MARCO|ABRIL|MAIO|JUNHO|JULHO|AGOSTO|SETEMBRO|OUTUBRO|NOVEMBRO|DEZEMBRO|JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\b(?:\s*(?:DE\s+)?(\d{4}))?/);
  if (m && +m[1] >= 1 && +m[1] <= 31) return { d: +m[1], m: MESES_TXT[m[2]], a: m[3] ? +m[3] : null, bruto: t.substr(m.index, m[0].length) };
  return null;
}
const PARCELA = /\b(?:parcela|parc\.?)\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\b/i;

export function detectarInstituicao(texto) {
  const t = semAcento(texto).toLowerCase();
  if (/nubank|nu pagamentos/.test(t)) return 'Nu';
  if (/porto ?seguro|portoseg|cart\w*\s+porto|porto bank/.test(t)) return 'Porto';
  if (/banco do brasil|extrato de conta corrente/.test(t)) return 'BB';
  return '';
}
export function acharVencimento(texto) {
  for (const linha of String(texto).split(/\r?\n/)) { // linha por linha: a data da linha de baixo não pode virar o ano
    const t = semAcento(normalizar(linha)).toUpperCase();
    const m = t.match(/VENC\w*\.?\s*(?:EM|:)?\s*(\d{1,2})\s*[/. -]\s*(\d{1,2}|[A-Z]{3})(?:\s*[/. -]?\s*(\d{4}|\d{2}))?(?!\d)/);
    if (!m) continue;
    const mes = /^\d+$/.test(m[2]) ? +m[2] : (MES_ABREV[m[2]] || null); if (!mes || mes > 12 || +m[1] > 31) continue;
    return { d: +m[1], m: mes, a: m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : null };
  }
  return null;
}
export function acharTotal(texto) {
  const t = String(texto).split(/\r?\n/).map(normalizar).join('\n');
  const m = t.match(/total\s*(?:a pagar|da fatura|desta fatura)[^\d]{0,25}((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})/i) || t.match(/valor\s*(?:total|da fatura)[^\d]{0,25}((?:\d{1,3}(?:\.\d{3})+|\d+),\d{2})/i);
  return m ? brNum(m[1]) : null;
}

// linhas: string ou [{texto, conf}] (conf 0–100 vem do OCR). ref: { ano, mes } da fatura, para o ano das compras.
// opc.tipo: 'fatura' (padrão) ou 'extrato'.
export function lerTextoFatura(entrada, ref = {}, opc = {}) {
  const brutas = typeof entrada === 'string' ? entrada.split(/\r?\n/).map(texto => ({ texto, conf: null })) : entrada;
  const textoTodo = brutas.map(l => l.texto).join('\n');
  const out = { instituicao: detectarInstituicao(textoTodo), vencimento: acharVencimento(textoTodo), total: acharTotal(textoTodo), linhas: [], pagamentos: [], ignoradas: [] };
  let dataCab = null, anterior = null;
  for (const b of brutas) {
    const t = normalizar(b.texto); if (!t) { anterior = null; continue; }
    const v = acharValor(t);
    const semParcela = t.replace(PARCELA, ' ');
    const dt = acharData(v ? semParcela.slice(0, v.idx) + ' ' + semParcela.slice(v.idx + v.bruto.length) : semParcela);
    if (!v) {
      if (dt && t.replace(dt.bruto, '').replace(/[^A-Za-zÀ-ú]/g, '').length < 4) dataCab = dt; // cabeçalho de data ("12 SET", "Hoje, 12/09")
      else anterior = t; // pode ser a descrição de um valor na linha seguinte
      continue;
    }
    if (PAGAMENTO.test(t)) { out.pagamentos.push({ texto: t, valor: v.valor }); anterior = null; continue; }
    if (RESUMO.test(t)) { out.ignoradas.push({ texto: t, motivo: 'linha de resumo/total (não é lançamento)' }); anterior = null; continue; }
    const duvidas = [];
    let desc = t.replace(v.bruto, ' ');
    if (dt) desc = desc.replace(dt.bruto, ' ');
    const p = t.match(PARCELA); if (p) desc = desc.replace(p[0], ' ');
    // final do cartão: "•••• 1234" (o OCR às vezes lê os pontos como "eeee", "ecee", "sere") ou "final 1234"
    const c4m = desc.match(/(?:^|\s)(?:[•*·.]{2,}|[eocsr]{3,5}|[Ff]inal)\s*(\d{4})\b/); if (c4m) desc = desc.replace(c4m[0], ' ');
    desc = desc.replace(/R\$/g, ' ').replace(/^[\s\-–•*·:;,.]+|[\s\-–•*·:;,.]+$/g, '').replace(/\s{2,}/g, ' ').trim();
    if (desc.replace(/[^A-Za-zÀ-ú]/g, '').length < 3 && anterior) { desc = anterior.replace(/R\$/g, '').trim(); duvidas.push('descrição veio da linha de cima'); }
    let data = null, d = dt;
    if (!d && dataCab) { d = dataCab; duvidas.push('data do cabeçalho do dia'); }
    if (d) {
      const mesRef = ref.mes || null, anoRef = ref.ano || null;
      let a = d.a; if (!a && anoRef) { a = mesRef && d.m > mesRef ? anoRef - 1 : anoRef; }
      if (!a) duvidas.push('ano não identificado');
      else { const x = new Date(a, d.m - 1, d.d); if (x.getMonth() !== d.m - 1) duvidas.push('data inválida'); else data = iso(a, d.m, d.d); }
    } else duvidas.push('sem data');
    if (desc.replace(/[^A-Za-zÀ-ú]/g, '').length < 3) duvidas.push('descrição ilegível');
    if (b.conf != null && b.conf < 75) duvidas.push(`leitura incerta (${Math.round(b.conf)}%)`);
    if (!(v.valor > 0)) duvidas.push('valor ilegível');
    // fatura de cartão: compra é saída; sinal de menos ou "estorno/crédito" é crédito.
    // extrato de conta: "(-)" ou "-" é saída; "(+)" é entrada.
    const credito = opc.tipo === 'extrato' ? v.positivo : (v.negativo || v.positivo || CREDITO.test(t));
    out.linhas.push({ data, descricao: desc, valor: v.valor > 0 ? (credito ? v.valor : -v.valor) : null, parcela: p ? `Parcela ${+p[1]}/${+p[2]}` : '', cartao4: c4m ? c4m[1] : '', credito, duvidas, texto: t, conf: b.conf });
    anterior = null;
  }
  return out;
}

// Junta várias fotos da mesma fatura: um lançamento igual (data, descrição e valor) em duas fotos aparece uma vez só
// e fica marcado, porque prints em sequência costumam se sobrepor.
const chave = l => `${l.data}|${semAcento(l.descricao).toUpperCase().replace(/[^A-Z0-9]/g, '')}|${l.valor}`;
export function juntarPaginas(paginas) {
  const out = { linhas: [], pagamentos: [], ignoradas: [], instituicao: '', vencimento: null, total: null, repetidas: 0 };
  const vistas = new Map();
  paginas.forEach((pg, i) => {
    out.instituicao ||= pg.instituicao; out.vencimento ||= pg.vencimento; if (pg.total != null && out.total == null) out.total = pg.total;
    out.pagamentos.push(...pg.pagamentos); out.ignoradas.push(...pg.ignoradas);
    const nestaPag = new Map();
    for (const l of pg.linhas) {
      const k = chave(l); const n = (nestaPag.get(k) || 0) + 1; nestaPag.set(k, n);
      const prev = vistas.get(k);
      if (prev && prev.pag !== i && n <= prev.n) { out.repetidas++; const orig = out.linhas[prev.idx[n - 1]]; if (orig && !orig.duvidas.includes('também aparece em outra foto')) orig.duvidas.push('também aparece em outra foto'); continue; }
      out.linhas.push({ ...l, foto: i + 1 });
      const e = vistas.get(k) || { pag: i, n: 0, idx: [] }; if (e.pag === i) { e.n = n; e.idx.push(out.linhas.length - 1); } vistas.set(k, e);
    }
  });
  return out;
}
