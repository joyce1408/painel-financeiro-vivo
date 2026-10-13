// Regras fixas (pessoais) guardadas nos dados, não no código. Só dados FICTÍCIOS.
// 1) classificador em Node: ordem, condições (sinal, tipo de lançamento, exato) e campos extras;
// 2) no Chromium, site sem dados: Importar regras, reimportar sem duplicar, arquivo inválido, cifrado no IndexedDB.
import { chromium } from 'playwright';
import fs from 'fs';
import { classificar, indiceHistorico, regraCasa } from '../js/classify.js';
import { primeiroAcesso, desbloquear } from './helpers.mjs';
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'OK  ' : 'FALHA'} ${n}${x ? ' — ' + x : ''}`);

const T = 'Transferências entre minhas contas';
const regras = [
  { id: 'f-1', ordem: 1, fixa: true, nome: 'Pix para Fulano paga a fatura', padrao: 'FULANO EXEMPLO', conta: 'BB', lancamento: 'Pix', sinal: 'saida', tipo: 'interna', mov: 'fatura', cat: T, sub: 'Pagamento da fatura', forma: 'Pix' },
  { id: 'f-2', ordem: 2, fixa: true, nome: 'Salário', padrao: 'EMPRESA FICTICIA', sinal: 'entrada', lancamento: 'Recebimento', tipo: 'receita', mov: 'entrada', cat: 'Dinheiro que entrou', sub: 'Salário', desc: 'Salário Empresa Fictícia' },
  { id: 'f-3', ordem: 3, fixa: true, padrao: 'ABC', exato: true, sinal: 'saida', tipo: 'despesa', mov: 'gasto', cat: 'Doações', sub: 'Doação', cartao: 'Cartão •••• 0000', obs: 'observação fictícia' },
  { id: 'u-1', padrao: 'FULANO EXEMPLO', tipo: 'despesa', mov: 'gasto', cat: 'Outros', sub: 'Outros' },
];
const hist = indiceHistorico([]);
const L = (o) => ({ conta: 'BB', data: '2026-01-10', lancamento: 'Pix - Enviado', descricao: '', valor: -10, ...o });
let c = classificar(L({ descricao: '10/01 12:00 FULANO EXEMPLO' }), regras, hist);
ok('Regra fixa vence a regra comum e o sistema', c.mov === 'fatura' && c.forma === 'Pix' && c.regraId === 'f-1' && /regra fixa/.test(c.motivo), c.motivo);
c = classificar(L({ descricao: 'FULANO EXEMPLO', valor: 10, lancamento: 'Pix - Recebido' }), regras, hist);
ok('Sinal e tipo de lançamento são respeitados (entrada não casa com regra de saída)', c.regraId === 'u-1', c.motivo);
c = classificar(L({ descricao: 'FULANO EXEMPLO', conta: 'Nu', lancamento: '' }), regras, hist);
ok('Conta é respeitada', c.regraId === 'u-1');
c = classificar(L({ descricao: 'EMPRESA FICTICIA LTDA', valor: 1000, lancamento: 'Recebimento de Proventos' }), regras, hist);
ok('Regra fixa de entrada define descrição', c.tipo === 'receita' && c.desc === 'Salário Empresa Fictícia');
c = classificar(L({ descricao: 'ABC' }), regras, hist);
const c2 = classificar(L({ descricao: 'ABC LOJA' }), regras, hist);
ok('Exato: só a descrição idêntica casa', c.regraId === 'f-3' && c.cartao === 'Cartão •••• 0000' && c.obs === 'observação fictícia' && c2.regraId !== 'f-3');
c = classificar(L({ descricao: 'FULANO EXEMPLO' }), [{ ...regras[0], ativa: false }], hist);
ok('Regra fixa desligada não vale', c.regraId !== 'f-1');
c = classificar(L({ descricao: 'PESSOA SEM REGRA' }), [], hist);
ok('Sem regra: vai para Pendências (nada inventado)', c.status === 'pendente');
ok('regraCasa exportada', regraCasa(regras[0], L({ descricao: 'FULANO EXEMPLO' })) === true);

// ---------- navegador ----------
const ARQ = '/tmp/claude-0/regras-ficticias.json';
fs.writeFileSync(ARQ, JSON.stringify({ tipo: 'painel-regras-pessoais', versao: 1, regras: regras.slice(0, 3) }));
fs.writeFileSync('/tmp/claude-0/regras-invalidas.json', '{"regras":[{"id":"x","padrao":"ab"}]}');
const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage(); const erros = [];
p.on('pageerror', e => erros.push(e.message));
await p.route('**/data/seed.json', r => r.fulfill({ status: 404, body: '' })); // como o site publicado: sem dados
await p.goto('http://localhost:8765/'); await primeiroAcesso(p);
await p.evaluate(() => location.hash = 'categorias'); await p.waitForSelector('[data-regra-imp]', { state: 'attached' });
const n0 = await p.evaluate(() => window.__painel.B.regras.length);
await p.setInputFiles('[data-regra-imp]', ARQ);
await p.waitForFunction(n => window.__painel.B.regras.length === n + 3, n0);
ok('Importar regras: 3 regras fixas entram', /3 novas/.test(await p.textContent('#toast')));
await p.waitForSelector('text=FULANO EXEMPLO');
ok('Tela mostra as regras fixas com as condições', /fixa/.test(await p.textContent('main')) && /só saídas/.test(await p.textContent('main')));
await p.setInputFiles('[data-regra-imp]', ARQ); await p.waitForTimeout(600);
ok('Reimportar o mesmo arquivo atualiza, não duplica', (await p.evaluate(() => window.__painel.B.regras.length)) === n0 + 3 && /3 atualizadas/.test(await p.textContent('#toast')));
await p.setInputFiles('[data-regra-imp]', '/tmp/claude-0/regras-invalidas.json'); await p.waitForTimeout(400);
ok('Arquivo inválido é recusado e nada muda', /Não importado/.test(await p.textContent('#toast')) && (await p.evaluate(() => window.__painel.B.regras.length)) === n0 + 3);
const cru = await p.evaluate(async () => {
  const db = await new Promise(o => { const r = indexedDB.open('painel-financeiro-vivo-protegido'); r.onsuccess = () => o(r.result); });
  let txt = ''; for (const s of db.objectStoreNames) { const v = await new Promise(o => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => o(r.result); }); txt += JSON.stringify(v, (k, x) => x instanceof ArrayBuffer || ArrayBuffer.isView(x) ? new TextDecoder('latin1').decode(x) : x); }
  return /FULANO EXEMPLO|EMPRESA FICTICIA/.test(txt);
});
ok('Regras importadas ficam cifradas no IndexedDB', cru === false);
await p.reload(); await desbloquear(p);
ok('Regras continuam depois de bloquear e abrir', (await p.evaluate(() => window.__painel.B.regras.filter(r => r.fixa).length)) === 3);
ok('Sem erros de JavaScript', !erros.length, erros.slice(0, 3).join(' | '));
await b.close();
console.log(out.join('\n'));
