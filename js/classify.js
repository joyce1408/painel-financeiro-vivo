// Classificação: regras fixas do sistema → regras confirmadas por você → histórico → pendente.
// Nunca inventa: sem evidência, o lançamento vai para Pendências.
import { chaveEstab, norm, cents } from './utils.js';

const C = (tipo, mov, cat, sub, extra = {}) => ({ tipo, mov, cat, sub, ...extra });
export const TIPO_CAT = { receita: 'Dinheiro que entrou', interna: 'Transferências entre minhas contas', investimento: 'Poupança', reembolso: 'Reembolsos' };

// Regras estruturais (não editáveis): definem o que é gasto, entrada ou movimentação técnica.
export const REGRAS_SISTEMA = [
  { nome: 'Pix para Joyce paga a fatura Nubank (não é gasto)', teste: l => l.conta === 'BB' && /Pix/i.test(l.lancamento) && /JOYCE ALVES PINHEIRO/i.test(l.descricao) && l.valor < 0, set: C('interna', 'fatura', TIPO_CAT.interna, 'Pix Joyce: pagamento da fatura Nubank', { forma: 'Pix' }) },
  { nome: 'Pix para Luiz Henrique é transferência entre contas', teste: l => l.conta === 'BB' && /Pix/i.test(l.lancamento) && /LUIZ HENRIQUE ALVES PINHE/i.test(l.descricao), set: C('interna', 'transferencia', TIPO_CAT.interna, 'Transferência para outra conta sua', { forma: 'Pix' }) },
  { nome: 'Aplicação na poupança', teste: l => /Aplica[cç][aã]o Poupan/i.test(l.lancamento), set: C('investimento', 'aplicacao', 'Poupança', 'Aplicação', { forma: 'Transferência poupança', desc: 'Aplicação na poupança' }) },
  { nome: 'Resgate da poupança', teste: l => /Transferido da poupan/i.test(l.lancamento), set: C('investimento', 'resgate', 'Poupança', 'Resgate', { forma: 'Transferência poupança', desc: 'Resgate da poupança' }) },
  { nome: 'Salário (IURD)', teste: l => l.valor > 0 && /IGREJA UNIVERSAL/i.test(l.descricao) && /Recebimento/i.test(l.lancamento), set: C('receita', 'entrada', TIPO_CAT.receita, 'Salário', { forma: 'Crédito em conta', desc: 'Salário IURD' }) },
  { nome: 'Restituição de IR (Receita Federal)', teste: l => l.valor > 0 && /SECR\.? DA RE|RECEITA FEDERAL/i.test(l.descricao), set: C('receita', 'entrada', TIPO_CAT.receita, 'Restituição de IR', { forma: 'Pix recebido', desc: 'Pix da Receita Federal' }) },
  { nome: 'Nota Fiscal Paulista', teste: l => l.valor > 0 && /NF Paulista|SECRETARIA DA FAZEN/i.test(l.lancamento + ' ' + l.descricao), set: C('receita', 'entrada', TIPO_CAT.receita, 'Nota Fiscal Paulista', { forma: 'Crédito em conta', desc: 'Nota Fiscal Paulista' }) },
  { nome: 'Plano Petlove (cartão Porto) pago por Pix', teste: l => l.conta === 'BB' && /PORTOSEG|PORTO SEGURO/i.test(l.descricao) && l.valor < 0, set: C('despesa', 'gasto', 'Pets', 'Plano de saúde', { contaGasto: 'Porto', forma: 'Crédito', cartao: 'Porto •••• 1117', desc: 'Petlove Saúde (pago via cartão Porto 1117)', obs: 'Cobrança do cartão Porto 1117, paga por Pix da conta Banco do Brasil. O Pix não gera um segundo gasto.' }) },
  { nome: 'INSS pela competência', teste: l => /INSS/i.test(l.lancamento), set: C('despesa', 'gasto', 'Previdência (INSS)', 'GPS contribuinte individual', { forma: 'Débito em conta (guias e tarifas)' }) },
  { nome: 'GPS avulsa', teste: l => /GPS - CODIGO/i.test(l.descricao), set: C('despesa', 'gasto', 'Previdência (INSS)', 'GPS avulsa', { forma: 'Débito em conta (guias e tarifas)' }) },
  { nome: 'DARF', teste: l => /DARF/i.test(l.descricao), set: C('despesa', 'gasto', 'Impostos', 'DARF Receita Federal', { forma: 'Débito em conta (guias e tarifas)', desc: 'DARF Receita Federal' }) },
  { nome: 'Tarifa bancária', teste: l => /Tarifa/i.test(l.lancamento), set: C('despesa', 'gasto', 'Financeiro', 'Tarifa bancária', { forma: 'Débito em conta (guias e tarifas)', desc: 'Tarifa pacote de serviços BB' }) },
  { nome: 'Juros de cheque especial', teste: l => /Cobran[cç]a de Juros/i.test(l.lancamento), set: C('despesa', 'gasto', 'Financeiro', 'Juros de cheque especial', { forma: 'Débito em conta (guias e tarifas)', desc: 'Juros de cheque especial' }) },
  { nome: 'IOF de cheque especial', teste: l => /I\.?O\.?F/i.test(l.lancamento), set: C('despesa', 'gasto', 'Financeiro', 'IOF', { forma: 'Débito em conta (guias e tarifas)', desc: 'IOF de cheque especial' }) },
  { nome: 'Celular Claro (débito automático)', teste: l => /^CLARO/i.test(l.lancamento), set: C('despesa', 'gasto', 'Contas e serviços', 'Celular (Claro)', { forma: 'Débito automático', desc: 'Claro celular' }) },
  { nome: 'Dízimos e ofertas por Pix', teste: l => l.valor < 0 && /Pix/i.test(l.lancamento) && /IGREJA UNIVERSAL DO REINO|^IURD$/i.test(l.descricao), set: C('despesa', 'gasto', 'Igreja', 'Dízimos e ofertas (Pix)', { forma: 'Pix', desc: 'Pix Igreja Universal' }) },
  { nome: 'Pagamento de fatura dentro da fatura', teste: l => /^Pagamento em /i.test(l.descricao), set: C('interna', 'fatura', TIPO_CAT.interna, 'Pagamento de fatura', {}) },
];

// Forma de pagamento de acordo com a origem; nunca inventada.
export function formaDe(l) {
  if (l.conta === 'Nu' || l.conta === 'Porto') return 'Crédito';
  if (/Compra com Cart/i.test(l.lancamento) || /Estorno de D[eé]bito/i.test(l.lancamento)) return 'Débito';
  if (/Pix/i.test(l.lancamento)) return /Recebido/i.test(l.lancamento) ? 'Pix recebido' : 'Pix';
  if (/Dep.*dinheiro/i.test(l.lancamento)) return 'Depósito em dinheiro';
  if (/Recebimento/i.test(l.lancamento)) return 'Crédito em conta';
  return '';
}

const regraCasa = (r, l) => r.ativa !== false && norm(l.descricao).includes(norm(r.padrao)) && (r.valor == null || cents(r.valor) === cents(l.valor)) && (!r.conta || r.conta === l.conta);

// Histórico: o mesmo estabelecimento só é classificado automaticamente se TODAS as vezes anteriores
// confirmadas tiveram a mesma categoria. Se houve classificações diferentes, vai para Pendências.
// Também guarda um índice pela primeira palavra (ex.: "ATACADAO"), usado só se ela tiver 4+ letras,
// não for genérica e todas as ocorrências (2 ou mais) tiverem a mesma classificação.
const GENERICAS = new Set(['PAGAMENTO', 'COMPRA', 'ESTORNO', 'TRANSFERENCIA', 'RECEBIDO', 'ENVIADO', 'PAGTO', 'DEBITO', 'CREDITO', 'LOJA', 'MERCADO', 'POSTO', 'AUTO', 'CASA', 'SHOP', 'STORE', 'PARCELA']);
export const primeiraPalavra = k => { const w = (k || '').split(' ')[0] || ''; return w.length >= 4 && !GENERICAS.has(w) ? w : ''; };
export function indiceHistorico(transacoes) {
  const h = new Map(), p = new Map();
  const add = (m, k, sig) => { const e = m.get(k) || { sigs: new Map(), n: 0 }; e.sigs.set(sig, (e.sigs.get(sig) || 0) + 1); e.n++; m.set(k, e); };
  for (const t of transacoes) {
    if (t.status === 'pendente' || t.cat === 'Não identificado') continue;
    const k = chaveEstab(t.descOriginal || t.desc); if (!k) continue;
    const sig = [t.tipo, t.mov, t.cat, t.sub].join('|');
    add(h, k, sig); const w = primeiraPalavra(k); if (w) add(p, w, sig);
  }
  h.primeira = p;
  return h;
}

// l: linha lida do arquivo (+ conta). Devolve o lançamento classificado com o motivo.
export function classificar(l, regrasUsuario, hist, existentes = []) {
  const base = { forma: formaDe(l), cartao: l.cartao4 ? `${l.conta === 'Nu' ? 'Nubank' : l.conta} •••• ${l.cartao4}` : '', contaGasto: l.conta };
  for (const r of REGRAS_SISTEMA) if (r.teste(l)) {
    const out = { ...base, ...r.set, status: 'auto', classificacao: 'automatica', motivo: 'Regra do sistema: ' + r.nome };
    if (r.set.tipo === 'despesa' && /INSS/.test(r.nome) && l.competencia) {
      out.desc = 'INSS GPS competência ' + l.competencia.slice(5) + '/' + l.competencia.slice(0, 4);
      const rep = existentes.find(t => /INSS GPS/.test(t.desc) && t.mes === l.competencia);
      if (rep) { out.status = 'pendente'; out.classificacao = 'pendente'; out.motivo = `Já existe uma guia do INSS com competência ${l.competencia.slice(5)}/${l.competencia.slice(0, 4)} (paga em ${rep.data.split('-').reverse().join('/')}). Confira a competência.`; }
    }
    return out;
  }
  // estorno de compra: herda a classificação da compra original
  if (l.valor > 0 && (/Estorno/i.test(l.lancamento) || /^Estorno de/i.test(l.descricao))) {
    const orig = existentes.find(t => t.conta === l.conta && cents(t.valor) === -cents(l.valor) && t.tipo === 'despesa' && Math.abs(new Date(t.data) - new Date(l.data)) < 40 * 864e5)
      || existentes.find(t => t.conta === l.conta && t.tipo === 'despesa' && chaveEstab(t.desc) && chaveEstab(l.descricao.replace(/^Estorno de\s*/i, '')) === chaveEstab(t.desc));
    if (orig && orig.status !== 'pendente' && orig.cat !== 'Não identificado') return { ...base, tipo: 'despesa', mov: 'gasto', cat: orig.cat, sub: orig.sub, status: 'auto', classificacao: 'automatica', motivo: `Estorno de ${orig.desc} (${orig.data.split('-').reverse().join('/')})` };
    if (orig) return { ...base, tipo: 'despesa', mov: 'gasto', cat: 'Não identificado', sub: 'Estabelecimentos não identificados', status: 'pendente', classificacao: 'pendente', motivo: `Estorno de ${orig.desc} (${orig.data.split('-').reverse().join('/')}), que também está pendente. Classifique os dois com a mesma categoria.` };
  }
  const r = (regrasUsuario || []).find(r => regraCasa(r, l));
  if (r) return { ...base, tipo: r.tipo, mov: r.mov, cat: r.cat, sub: r.sub, status: 'auto', classificacao: 'automatica', regraId: r.id, motivo: `Sua regra: "${r.padrao}"${r.valor != null ? ' com valor ' + Math.abs(r.valor).toFixed(2).replace('.', ',') : ''}` };
  // uma regra sua que exige valor exato (ex.: Apple de R$ 19,90) bloqueia o histórico para outros valores
  const bloqueio = (regrasUsuario || []).find(r => r.ativa !== false && r.valor != null && norm(l.descricao).includes(norm(r.padrao)));
  const k = chaveEstab(l.descricao);
  const e = !bloqueio && k && hist.get(k);
  if (e && e.sigs.size === 1 && (l.valor < 0 || [...e.sigs.keys()][0].startsWith('despesa|') === false)) {
    const [tipo, mov, cat, sub] = [...e.sigs.keys()][0].split('|');
    if (!(tipo === 'despesa' && l.valor > 0)) return { ...base, tipo, mov, cat, sub, status: 'auto', classificacao: 'automatica', motivo: `Histórico: "${k}" foi classificado assim ${e.n} vez${e.n > 1 ? 'es' : ''}` };
  }
  // primeira palavra (ex.: "Atacadao 340 As" → ATACADAO), com unanimidade e pelo menos 2 ocorrências
  const w = !bloqueio && !e && primeiraPalavra(k);
  const ep = w && hist.primeira && hist.primeira.get(w);
  if (ep && ep.sigs.size === 1 && ep.n >= 2) {
    const [tipo, mov, cat, sub] = [...ep.sigs.keys()][0].split('|');
    if (!(tipo === 'despesa' && l.valor > 0)) return { ...base, tipo, mov, cat, sub, status: 'auto', classificacao: 'automatica', motivo: `Histórico: as ${ep.n} compras que começam com "${w}" foram classificadas assim` };
  }
  const motivo = bloqueio ? `Sua regra "${bloqueio.padrao}" vale só para o valor ${Math.abs(bloqueio.valor).toFixed(2).replace('.', ',')}; este é diferente.` : e && e.sigs.size > 1 ? `"${k}" já teve classificações diferentes; escolha a certa.` : 'Não foi possível identificar este lançamento com segurança.';
  if (l.valor > 0) return { ...base, tipo: 'receita', mov: 'entrada', cat: 'Não identificado', sub: 'Entrada não identificada', status: 'pendente', classificacao: 'pendente', motivo };
  return { ...base, tipo: 'despesa', mov: 'gasto', cat: 'Não identificado', sub: base.forma === 'Pix' ? 'Pix não identificado' : 'Estabelecimentos não identificados', status: 'pendente', classificacao: 'pendente', motivo };
}
