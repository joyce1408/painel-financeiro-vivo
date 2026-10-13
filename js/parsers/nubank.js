// Leitor da fatura do cartão de crédito Nubank (PDF).
import { parseBRL, MES_ABREV, iso } from '../utils.js';

export const id = 'nubank';
export const nome = 'Nubank · fatura do cartão de crédito';

export function detectar(texto) {
  if (/Nu Pagamentos S\.A\./.test(texto) && /RESUMO DA FATURA ATUAL/.test(texto)) return 'pdf';
  return null;
}

const D = (dd, mon, y) => iso(y, MES_ABREV[mon], +dd);
const LINHA = /^(\d{2})\s+([A-Z]{3})\s+(?:•+\s*(\d{4})\s+)?(.+?)\s+([−-])?\s*R\$\s*([\d.]+,\d{2})$/;

export function lerPDF(linhas) {
  // junta "12 MAR" que às vezes vem numa linha separada da descrição e do valor
  const ls = [];
  for (const raw of linhas) { const l = raw.replace(/\s+/g, ' ').trim(); const prev = ls[ls.length - 1];
    if (prev && /^\d{2} [A-Z]{3}$/.test(prev) && l && !/^\d{2} [A-Z]{3}\b/.test(l)) ls[ls.length - 1] = prev + ' ' + l; else ls.push(l); }
  const txt = ls.join('\n');
  const flat = txt.replace(/\s+/g, ' ');
  const resumo = flat.slice(Math.max(0, flat.indexOf('RESUMO DA FATURA ATUAL')));
  const venc = flat.match(/Data de vencimento:\s*(\d{2}) ([A-Z]{3}) (\d{4})/);
  if (!venc) throw new Error('Não encontrei a data de vencimento da fatura Nubank.');
  const vy = +venc[3], vm = MES_ABREV[venc[2]];
  const emis = flat.match(/EMISSÃO E ENVIO (\d{2}) ([A-Z]{3}) (\d{4})/);
  const per = flat.match(/Período vigente:\s*(\d{2}) ([A-Z]{3}) a (\d{2}) ([A-Z]{3})/);
  const num = re => { const m = resumo.match(re); return m ? parseBRL(m[1] + 'R$' + m[2]) : null; };
  const totalAPagar = num(/Total a pagar\s+()R\$\s*([\d.]+,\d{2})/);
  const faturaAnterior = num(/Fatura anterior\s+()R\$\s*([\d.]+,\d{2})/);
  const pagamentoRecebido = num(/Pagamento recebido\s+([−-]?)\s*R\$\s*([\d.]+,\d{2})/);
  const totalCompras = num(/Total de compras de todos os cartões,.*?()R\$\s*([\d.]+,\d{2})/);
  const outros = num(/Outros lançamentos\s+([−-]?)\s*R\$\s*([\d.]+,\d{2})/);
  const proxFech = flat.match(/Fechamento da próxima fatura\s+(\d{2}) ([A-Z]{3}) (\d{4})/);
  const titular = (flat.match(/Olá, ([^.]+)\./) || [])[1] || '';

  const anoDe = mon => (MES_ABREV[mon] > vm ? vy - 1 : vy);
  const ini = txt.search(/^TRANSAÇÕES/m);
  const linhasTx = ini >= 0 ? txt.slice(ini).split('\n') : [];
  const out = []; const pagamentos = []; const naoLidas = [];
  for (const raw of linhasTx) {
    const l = raw.replace(/\s+/g, ' ').trim().replace(/−/g, '−');
    const m = l.match(LINHA); if (!m) { if (/^\d{2} [A-Z]{3}\b/.test(l) && /R\$/.test(l)) naoLidas.push(l); continue; }
    const [, dd, mon, c4, desc, neg, v] = m;
    if (!MES_ABREV[mon]) continue;
    const valor = parseBRL(v) * (neg ? 1 : -1);          // compra = negativo (saída); estorno/crédito = positivo
    const data = D(dd, mon, anoDe(mon));
    if (/^Pagamento em /i.test(desc)) { pagamentos.push({ data, valor: -valor }); continue; }
    const p = desc.match(/Parcela\s+(\d+)\/(\d+)/i);
    out.push({ data, descricao: desc.replace(/\s+/g, ' ').trim(), valor, cartao4: c4 || '', parcela: p ? `Parcela ${p[1]}/${p[2]}` : '', estorno: /^Estorno/i.test(desc) });
  }
  const fechamento = emis ? D(emis[1], emis[2], +emis[3]) : null;
  const periodoInicio = per ? D(per[1], per[2], anoDe(per[2])) : null;
  return {
    instituicao: 'Nubank', conta: 'Nu', tipo: 'fatura', formato: 'PDF', titular,
    fatura: {
      id: `Nu-${vy}-${String(vm).padStart(2, '0')}`, cartao: 'Nu', competencia: `${vy}-${String(vm).padStart(2, '0')}`,
      periodoInicio, fechamento, vencimento: D(venc[1], venc[2], vy), proximoFechamento: proxFech ? D(proxFech[1], proxFech[2], +proxFech[3]) : null,
      totalAPagar, faturaAnterior, pagamentoRecebido: pagamentoRecebido === null ? null : Math.abs(pagamentoRecebido), totalCompras, outrosLancamentos: outros, pagamentos,
    },
    periodoInicio, periodoFim: fechamento, linhas: out, naoLidas,
  };
}
