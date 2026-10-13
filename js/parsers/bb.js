// Leitor do extrato de conta corrente do Banco do Brasil (CSV exportado pelo app/site e PDF do extrato).
// Devolve linhas "brutas" padronizadas; a classificação acontece depois, em classify.js.
import { parseBRL, iso } from '../utils.js';

export const id = 'bb';
export const nome = 'Banco do Brasil · extrato de conta corrente';

export function detectar(texto, nomeArquivo) {
  if (/"Data","Lançamento","Detalhes"/.test(texto)) return 'csv';
  if (/Extrato de Conta Corrente/i.test(texto) && /Agência:\s*\d/.test(texto) && /\((\+|-)\)/.test(texto)) return 'pdf';
  return null;
}

function csvLinhas(texto) {
  const out = [];
  for (const raw of texto.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const cols = []; let cur = '', q = false;
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (q) { if (c === '"' && raw[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { cols.push(cur); cur = ''; } else cur += c;
    }
    cols.push(cur); out.push(cols);
  }
  return out;
}

// Converte "dd/mm/aaaa" em "aaaa-mm-dd"
const dIso = s => { const [d, m, y] = s.split('/'); return `${y}-${m}-${d}`; };

export function lerCSV(texto) {
  const rows = csvLinhas(texto); const head = rows.shift();
  if (!head || head[0] !== 'Data') throw new Error('Cabeçalho do CSV do Banco do Brasil não reconhecido.');
  let saldoInicial = null, saldoFinal = null, fimPeriodo = null; const brutos = [];
  for (const [data, lanc, det, doc, valor] of rows) {
    if (lanc === 'Saldo Anterior') { saldoInicial = parseBRL(valor); continue; }
    if (lanc === 'S A L D O') { saldoFinal = parseBRL(valor); fimPeriodo = dIso(data); continue; }
    if (lanc === 'Saldo do dia' || !data || data.startsWith('00/')) continue;
    brutos.push({ dataExtrato: dIso(data), lancamento: lanc.trim(), detalhe: (det || '').replace(/\s+/g, ' ').trim(), documento: (doc || '').trim(), valor: parseBRL(valor) });
  }
  return montar(brutos, { saldoInicial, saldoFinal, fimPeriodo, formato: 'CSV' });
}

const CAB = /^--- fim da página|Extrato de Conta Corrente|^Cliente:|^Período:|^Lançamentos$|^Dia\s+Lote|^Dia\s+Lote\s+Documento/;
const FIM = /Informações Adicionais|Taxa Limite Especial|Limite Ch\.Esp/;
const VAL = /^(\d{2}\/\d{2}\/\d{4})\s+(.*?)\s*([\d.]+,\d{2})\s*\(([+-])\)\s*$/;
const SALDOS = /^(Saldo Anterior|Saldo do dia|SALDO|S A L D O)$/;

export function lerPDF(linhas) {
  const txt = linhas.join('\n');
  const per = txt.match(/Período:\s*(\d{2})\s*a\s*(\d{2})\/(\d{2})\/(\d{4})/);
  const recs = []; let pend = []; let saldoInicial = null, saldoFinal = null; let fim = false;
  const fecharDet = (extra) => { const r = recs[recs.length - 1]; if (r && extra.length) r.det.push(...extra); };
  for (let raw of linhas) {
    const l = raw.replace(/\s+/g, ' ').trim();
    if (!l || CAB.test(l)) continue;
    if (FIM.test(l)) { fim = true; break; }
    const m = l.match(VAL);
    if (!m) { pend.push(l); continue; }
    const [, data, meio, v, sinal] = m;
    const inline = meio.replace(/^(\d+\s+)+/, '').replace(/^\d+$/, '').trim();
    const valor = parseBRL(v) * (sinal === '+' ? 1 : -1);
    if (SALDOS.test(inline)) {
      fecharDet(pend); pend = [];
      if (inline === 'Saldo Anterior') saldoInicial = valor;
      if (inline === 'SALDO' || inline === 'S A L D O') saldoFinal = valor;
      recs.push({ saldo: true, det: [] }); continue;
    }
    const tipo = pend.pop() || '';
    fecharDet(pend); pend = [];
    recs.push({ dataExtrato: dIso(data), lancamento: tipo, det: inline ? [inline] : [], valor });
  }
  if (!fim) fecharDet(pend); else fecharDet(pend);
  const brutos = recs.filter(r => !r.saldo).map(r => ({ dataExtrato: r.dataExtrato, lancamento: r.lancamento, detalhe: r.det.join(' ').trim(), documento: '', valor: r.valor }));
  const fimPeriodo = per ? `${per[4]}-${per[3]}-${per[2]}` : null;
  return montar(brutos, { saldoInicial, saldoFinal, fimPeriodo, formato: 'PDF' });
}

// Transforma as linhas do extrato no formato comum do importador.
function montar(brutos, info) {
  const linhas = brutos.map(b => {
    let data = b.dataExtrato, desc = b.detalhe || b.lancamento;
    const m = b.detalhe.match(/^(\d{2})\/(\d{2})\s+\d{2}:\d{2}\s+(.*)$/);
    if (m) {
      let y = +b.dataExtrato.slice(0, 4); const mm = +m[2], me = +b.dataExtrato.slice(5, 7);
      if (mm > me + 1) y -= 1;                 // compra de dezembro compensada em janeiro
      data = iso(y, mm, +m[1]); desc = m[3].trim();
    }
    let competencia = null;
    const g = b.detalhe.match(/GPS.*?(\d{2})\/(\d{4})\s*$/);
    if (/INSS/i.test(b.lancamento) && g) competencia = `${g[2]}-${g[1]}`;
    return { data, dataLancamento: b.dataExtrato, descricao: desc, lancamento: b.lancamento, detalhe: b.detalhe, valor: b.valor, cartao4: '', parcela: '', competencia };
  });
  const datas = brutos.map(b => b.dataExtrato).sort();
  return {
    instituicao: 'Banco do Brasil', conta: 'BB', tipo: 'extrato', formato: info.formato,
    periodoInicio: datas[0] || null, periodoFim: info.fimPeriodo || datas[datas.length - 1] || null,
    saldoInicial: info.saldoInicial, saldoFinal: info.saldoFinal, linhas,
  };
}
