// Leitura genérica (banco sem leitor próprio): CSV estilo app do Nubank, CSV de extrato, OFX e PDF com texto.
// Só arquivos FICTÍCIOS, criados aqui. Site sem dados (como o publicado).
import { chromium } from 'playwright';
import fs from 'fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { primeiroAcesso } from './helpers.mjs';
const D = '/tmp/claude-0/generico/'; fs.mkdirSync(D, { recursive: true });
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'OK  ' : 'FALHA'} ${n}${x ? ' — ' + x : ''}`);

// ---------- arquivos fictícios ----------
fs.writeFileSync(D + 'Nubank_2026-11-19.csv', 'date,title,amount\n2026-10-12,Padaria Exemplo,23.40\n2026-10-15,Loja Fictícia - Parcela 2/3,100.00\n2026-10-20,Pagamento recebido,-500.00\n2026-10-22,Livraria Teste,58.90\n');
fs.writeFileSync(D + 'extrato-banco-x.csv', 'Extrato de conta - Banco Fictício\nData;Histórico;Débito;Crédito;Saldo\n01/10/2026;Saldo anterior;;;1.000,00\n02/10/2026;Tarifa pacote;12,90;;987,10\n05/10/2026;Pix recebido Exemplo;;250,00;1.237,10\n');
fs.writeFileSync(D + 'cartao.ofx', 'OFXHEADER:100\nDATA:OFXSGML\n<OFX><CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS><BANKTRANLIST>\n<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261003120000[-3:BRT]<TRNAMT>-45.90<FITID>x1<MEMO>MERCADO FICTICIO\n</STMTTRN>\n<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261008<TRNAMT>300.00<FITID>x2<MEMO>Pagamento recebido\n</STMTTRN>\n</BANKTRANLIST></CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1></OFX>\n');
fs.writeFileSync(D + 'planilha.xlsx', 'não é uma planilha de verdade');
{ const pdf = await PDFDocument.create(); const f = await pdf.embedFont(StandardFonts.Helvetica); const pg = pdf.addPage([595, 842]);
  ['Banco Exemplo S.A. - Fatura do cartao', 'Vencimento: 10/11/2026', 'Total a pagar R$ 151,30', '', '05/10 FARMACIA TESTE R$ 31,30', '07/10 POSTO FICTICIO R$ 120,00']
    .forEach((t, i) => pg.drawText(t, { x: 40, y: 790 - i * 22, size: 12, font: f }));
  fs.writeFileSync(D + 'fatura.pdf', await pdf.save()); }

const b = await chromium.launch(); const ctx = await b.newContext(); const p = await ctx.newPage(); const erros = [], externos = [];
p.on('pageerror', e => erros.push(e.message)); p.on('dialog', d => d.accept());
p.on('request', r => { const u = new URL(r.url()); if (!['blob:', 'data:'].includes(u.protocol) && u.hostname !== 'localhost') externos.push(r.url()); });
await p.route('**/data/seed.json', r => r.fulfill({ status: 404, body: '' }));
await p.goto('http://localhost:8765/'); await primeiroAcesso(p);
const enviar = async (...fs_) => { await p.evaluate(() => location.hash = 'importar'); await p.waitForSelector('#arqs', { state: 'attached' }); await p.setInputFiles('#arqs', fs_.map(f => D + f)); };
const linhasRev = () => p.$$eval('table.rev tr[data-l]', trs => trs.map(tr => ({ inc: tr.querySelector('[data-c=incluir]').checked, data: tr.querySelector('[data-c=data]').value, desc: tr.querySelector('[data-c=descricao]').value, valor: tr.querySelector('[data-c=valor]').value, parc: tr.querySelector('[data-c=parcela]').value })));
const B = () => p.evaluate(() => { const B = window.__painel.B; return { n: B.transacoes.length, tx: B.transacoes.map(t => ({ d: t.data, v: t.valor, c: t.conta, f: t.faturaId, desc: t.descOriginal, st: t.status, ft: t.fonteTipo })), fat: B.faturas.map(f => f.id), arq: B.arquivos.map(a => a.nome) }; });

// 1) CSV do app do Nubank
await enviar('Nubank_2026-11-19.csv'); await p.waitForSelector('table.rev');
let L = await linhasRev(); const txt = await p.textContent('main');
ok('CSV do Nubank vai para a conferência (sem erro)', /não tem leitor próprio/.test(txt) && L.length === 3, JSON.stringify(L));
ok('Conta e vencimento sugeridos pelo nome do arquivo', await p.$eval('[data-conta]', s => s.value) === 'Nu' && await p.$eval('[data-venc]', s => s.value) === '2026-11-19');
ok('Compras viram negativas; pagamento da fatura fica de fora', L.map(l => l.valor).join('|') === '-23,40|-100,00|-58,90' && /1 pagamento\(s\) de fatura/.test(txt));
ok('Parcela lida e tirada da descrição', L[1].parc === 'Parcela 2/3' && L[1].desc === 'Loja Fictícia');
await p.click('[data-inverter]'); L = await linhasRev(); ok('Inverter sinais funciona', L[0].valor === '23,40'); await p.click('[data-inverter]');
await p.click('[data-continuar]'); await p.waitForSelector('[data-imp-ok]');
await p.click('[data-imp-ok]'); await p.waitForFunction(() => window.__painel.B.transacoes.length === 3);
let S = await B();
ok('Gravados 3 lançamentos na fatura Nu-2026-11', S.n === 3 && S.tx.every(t => t.f === 'Nu-2026-11' && t.c === 'Nu' && t.v < 0) && S.fat.includes('Nu-2026-11'), JSON.stringify(S.fat));
ok('Arquivo registrado (reconhecido se enviado de novo)', S.arq.includes('Nubank_2026-11-19.csv'));

// 2) o mesmo CSV de novo: nada duplicado
await enviar('Nubank_2026-11-19.csv'); await p.waitForSelector('table.rev');
L = await linhasRev();
ok('Reenvio: as 3 linhas aparecem como já existentes e desmarcadas', L.length === 3 && L.every(l => !l.inc));
await p.click('[data-foto-pular]'); await p.waitForTimeout(300);
ok('Pular: nada gravado', (await B()).n === 3);

// 3) PDF com texto de banco desconhecido + extrato CSV + OFX + planilha, de uma vez
await enviar('fatura.pdf', 'extrato-banco-x.csv', 'cartao.ofx', 'planilha.xlsx'); await p.waitForSelector('table.rev');
let t3 = await p.textContent('main');
ok('Vários arquivos: um de cada vez, com aviso dos próximos', /fatura\.pdf/.test(t3) && /mais 2 arquivo/.test(t3));
L = await linhasRev();
ok('PDF desconhecido: lançamentos e vencimento lidos do texto', L.length === 2 && L.map(l => l.valor).join('|') === '-31,30|-120,00' && L[0].data === '2026-10-05' && await p.$eval('[data-venc]', s => s.value) === '2026-11-10', JSON.stringify(L));
ok('Total do PDF confere com a soma', /✓ confere/.test(t3));
await p.click('[data-continuar]'); await p.waitForTimeout(300);
ok('Sem conta escolhida, pede a conta (não adivinha)', /Escolha a conta/.test(await p.textContent('main')));
await p.selectOption('[data-conta]', 'Porto'); await p.waitForSelector('table.rev'); await p.click('[data-continuar]');
await p.waitForFunction(() => /extrato-banco-x/.test(document.querySelector('main').innerText));
L = await linhasRev();
ok('Extrato CSV com colunas Débito/Crédito: sinais certos, saldo ignorado', L.length === 2 && L.map(l => l.valor).join('|') === '-12,90|250,00', JSON.stringify(L));
await p.selectOption('[data-conta]', 'BB'); await p.click('[data-continuar]');
await p.waitForFunction(() => /cartao\.ofx/.test(document.querySelector('main').innerText));
L = await linhasRev();
ok('OFX de cartão: compra lida, pagamento fora', L.length === 1 && L[0].valor === '-45,90' && L[0].desc === 'MERCADO FICTICIO');
await p.selectOption('[data-conta]', 'Nu'); await p.fill('[data-venc]', '2026-11-19'); await p.dispatchEvent('[data-venc]', 'change'); await p.click('[data-continuar]');
await p.waitForSelector('[data-imp-ok]');
const t4 = await p.textContent('main');
ok('Revisão final junta tudo e mostra o erro da planilha', /planilha\.xlsx/.test(t4) && /exporte\) como CSV/.test(t4) && /fatura\.pdf/.test(t4) && /cartao\.ofx/.test(t4));
await p.click('[data-imp-ok]'); await p.waitForFunction(() => window.__painel.B.transacoes.length === 8);
S = await B();
ok('Gravados: 2 Porto (fatura 2026-11), 2 BB (extrato), 1 Nu', S.tx.filter(t => t.c === 'Porto' && t.f === 'Porto-2026-11').length === 2 && S.tx.filter(t => t.c === 'BB' && !t.f).length === 2 && S.tx.filter(t => t.c === 'Nu').length === 4, JSON.stringify(S.tx.map(t => t.c + ' ' + t.f)));
ok('Lançamentos de leitura genérica ficam marcados como revisados (PDF exato depois não duplica)', S.tx.every(t => t.ft === 'foto'));
ok('Nada enviado para fora', externos.length === 0, externos.join(' | '));
ok('Sem erros de JavaScript', !erros.length, erros.slice(0, 3).join(' | '));
await b.close();
console.log(out.join('\n'));
