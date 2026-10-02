// Faturas: cada fatura com os lançamentos vinculados, a conferência dos totais e o status de pagamento.
import { brl, dbr, mLabel, sum, esc, cents } from '../utils.js';
import { CONTAS } from '../calc.js';
import { kpis, tabelaTx, bloco, vazio, secao } from '../ui.js';

export const titulo = 'Faturas';
const ST = { paga: 'paga', parcial: 'paga em parte', aberta: 'em aberto', 'sem-confirmacao': 'pagamento não confirmado' };
export function render({ B, s }) {
  let fs = B.faturas.slice().sort((a, b) => b.vencimento.localeCompare(a.vencimento));
  if (s.ano) fs = fs.filter(f => f.vencimento.startsWith(s.ano));
  if (s.mes) fs = fs.filter(f => f.vencimento.startsWith(s.mes));
  if (s.conta) fs = fs.filter(f => f.cartao === s.conta);
  const totalAno = fs.reduce((a, f) => a + Math.round((f.totalAPagar || 0) * 100), 0) / 100;
  const html = fs.map(f => {
    const xs = B.transacoes.filter(t => t.faturaId === f.id);
    const lido = -sum(xs), esp = Math.round(((f.totalCompras || 0) + (f.outrosLancamentos || 0)) * 100) / 100;
    // lançamentos da fatura que ficaram fora da base (ex.: compras de antes do início dos registros)
    const fps = new Set(xs.map(t => t.fonteFp));
    const fora = B.origensLista.filter(o => o.arquivo === f.arquivo && o.conta === f.cartao && !fps.has(o.fp) && !B.transacoes.some(t => t.fonteFp === o.fp));
    const vFora = -sum(fora);
    const confere = cents(lido + vFora) === cents(esp);
    const txtFora = fora.length ? ` + ${fora.length} lançamento(s) de ${brl(vFora)} fora da base (de antes de ${mLabel(B.transacoes.map(t => t.mes).sort()[0] || '')}, quando começam os registros)` : '';
    const corpo = `<div class="dl" style="padding:10px 0">
      <div><span>Cartão</span>${esc(CONTAS[f.cartao] || f.cartao)}</div><div><span>Período</span>${dbr(f.periodoInicio)} a ${dbr(f.fechamento)}</div>
      <div><span>Vencimento</span>${dbr(f.vencimento)}</div><div><span>Total a pagar</span>${brl(f.totalAPagar)}</div>
      <div><span>Fatura anterior</span>${brl(f.faturaAnterior || 0)}</div><div><span>Pagamento recebido (da anterior)</span>${brl(f.pagamentoRecebido || 0)}</div>
      <div><span>Compras do período</span>${brl(f.totalCompras || 0)}</div><div><span>Outros lançamentos</span>${brl(f.outrosLancamentos || 0)}</div>
      <div><span>Status</span>${ST[f.status] || f.status}${f.pago != null ? ' · ' + brl(f.pago) : ''}</div><div><span>Como sabemos</span>${esc(f.statusFonte || '')}</div>
      <div><span>Arquivo</span>${esc(f.arquivo || '—')}</div>
      <div><span>Conferência</span>${confere ? `<span class="pos">✓ ${xs.length} lançamentos vinculados somam ${brl(lido)}${txtFora}</span>` : `<span class="neg">Lançamentos vinculados somam ${brl(lido)}${txtFora}; a fatura informa ${brl(esp)}</span>`}</div></div>
      ${(f.pagamentos || []).length ? `<p class="note">Pagamentos registrados nesta fatura (quitam a fatura anterior; não são gasto): ${f.pagamentos.map(p => `${dbr(p.data)} ${brl(-p.valor)}`).join(' · ')}</p>` : ''}
      ${tabelaTx(xs, { cols: ['data', 'desc', 'valor', 'cartao', 'parcela', 'cat', 'sub', 'status'] })}`;
    return bloco('fat:' + f.id, `${CONTAS[f.cartao] || f.cartao} · vence ${dbr(f.vencimento)}`, `<span class="st ${f.status}">${ST[f.status] || f.status}</span> · ${xs.length} lançamentos${fora.length ? ` (+${fora.length} fora da base)` : ''} · fecha ${dbr(f.fechamento)}${confere ? '' : ' · <span class="neg">não confere</span>'}`, brl(f.totalAPagar), corpo);
  }).join('');
  const abertas = fs.filter(f => f.status !== 'paga');
  return kpis([
    { l: 'Faturas no filtro', v: String(fs.length), s: s.ano ? `com vencimento em ${s.mes ? mLabel(s.mes) : s.ano}` : '' },
    { l: 'Total das faturas', v: brl(totalAno), s: 'soma de “total a pagar”', c: 'rose' },
    { l: 'Pagas', v: String(fs.filter(f => f.status === 'paga').length), s: 'confirmado pela fatura seguinte', c: 'g' },
    { l: 'Sem confirmação', v: String(abertas.length), s: abertas.length ? abertas.map(f => dbr(f.vencimento).slice(0, 5)).join(' · ') : 'nenhuma', c: 'n' },
  ], 'k4')
  + `<p class="note" style="margin-top:-8px">Cada compra fica ligada à fatura em que foi cobrada (ciclo da fatura), mas conta nos gastos pela data da compra. O pagamento da fatura não é gasto. Uma fatura só aparece como paga quando a fatura seguinte registra o pagamento recebido. O cartão Porto não tem fatura importada: só há prints, e a única cobrança (Petlove) entra pelo Pix do Banco do Brasil.</p>`
  + (html ? `<div class="cats">${html}</div>` : vazio('Nenhuma fatura com esses filtros.'))
  + secao('fatinfo', 'Como importar a próxima fatura', '', '<p class="note">Baixe o PDF da fatura no app ou no site do Nubank e importe em <b>Importar</b>. Lançamentos que já existem são reconhecidos e não duplicam.</p>');
}
