// Teste da importação por foto no Chromium, com faturas FICTÍCIAS (tools/ocr-fixtures.mjs).
// O Tesseract.js do CDN não é acessível daqui: um substituto chama o MESMO motor (Tesseract 5, linha de comando)
// pela ponte do Playwright. Isso testa todo o fluxo do painel, mas não o download/execução do Tesseract.js no iPhone.
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import { primeiroAcesso } from './helpers.mjs';
const APP='http://localhost:8765/', D='/tmp/claude-0/ocr/', V=JSON.parse(fs.readFileSync(D+'verdade.json'));
const out=[]; const ok=(n,c,x='')=>out.push(`${c?'OK  ':'FALHA'} ${n}${x?' — '+x:''}`);
const b=await chromium.launch(); const erros=[], externos=[];
function cli(png){ fs.writeFileSync(D+'_tmp.png',png); const tsv=execFileSync('tesseract',[D+'_tmp.png','stdout','--psm','6','-c','preserve_interword_spaces=1','tsv'],{stdio:['ignore','pipe','ignore']}).toString().trim().split('\n').slice(1).map(l=>l.split('\t'));
  const L=new Map(); for(const c of tsv){ if(c[0]!=='5'||!c[11]||!c[11].trim())continue; const k=c.slice(2,5).join('.'); const e=L.get(k)||{w:[],conf:[]}; e.w.push(c[11]); e.conf.push(+c[10]); L.set(k,e);} 
  const linhas=[...L.values()].map(e=>({text:e.w.join(' '),confidence:e.conf.reduce((a,b)=>a+b,0)/e.conf.length})); return {text:linhas.map(l=>l.text).join('\n'),confidence:80,lines:linhas}; }
async function aparelho(stub=true){ const c=await b.newContext({acceptDownloads:true}); const p=await c.newPage();
  p.on('pageerror',e=>erros.push(e.message)); p.on('dialog',d=>d.accept());
  p.on('request',r=>{const u=new URL(r.url()); if(!['blob:','data:'].includes(u.protocol)&&!['localhost'].includes(u.hostname)) externos.push(r.method()+' '+r.url().slice(0,90)+(r.postData()?' COM DADOS':''))});
  if(stub){ await p.exposeFunction('__ocrCli',b64=>cli(Buffer.from(b64,'base64')));
    await p.addInitScript(()=>{ window.Tesseract={createWorker:async()=>({setParameters:async()=>{},terminate:async()=>{},recognize:async cv=>{const u=cv.toDataURL('image/png').split(',')[1];return {data:await window.__ocrCli(u)}}})}; }); }
  await p.goto(APP+'#importar'); await primeiroAcesso(p); await p.evaluate(()=>location.hash='importar'); await p.waitForSelector('[data-foto]',{state:'attached'}); return p; }
const resumo=p=>p.evaluate(async()=>{const C=await import('/js/calc.js');const tx=window.__painel.B.transacoes;return {n:tx.length,G:C.totalGasto(C.gastos(tx,{})),f:window.__painel.B.faturas.length}});
const galeria=(p,arqs)=>p.setInputFiles('[data-foto][multiple]',arqs);

const p=await aparelho(); const R0=await resumo(p);
ok('Tela de importação mostra "Tirar foto" (câmera) e "Escolher da galeria"',(await p.$('input[data-foto][capture=environment]'))&&(await p.$('input[data-foto][multiple][accept*="image/"]')));
// 1) JPG da galeria (foto torta, borrada)
await galeria(p,D+'nu-foto.jpg'); await p.waitForSelector('[data-ler]');
ok('JPG aberto e mostrado como miniatura',await p.$$eval('.fotos img',x=>x.length)===1);
await p.click('[data-ler]'); await p.waitForSelector('table.rev',{timeout:60000});
let lin=await p.$$eval('table.rev tr[data-l]',trs=>trs.map(tr=>({d:tr.querySelector('[data-c=data]').value,s:tr.querySelector('[data-c=descricao]').value,v:tr.querySelector('[data-c=valor]').value,p:tr.querySelector('[data-c=parcela]').value,c:tr.querySelector('[data-c=cartao4]').value})));
const certos=V.nu.linhas.filter(([d,s,v,pp,c])=>lin.some(l=>l.d===d&&l.s.startsWith(s.slice(0,8))&&l.v===v.toFixed(2).replace('.',',')&&(l.p||'')===(pp||'')&&(l.c||'')===(c||'')));
ok(`OCR de fatura de teste (JPG): ${certos.length}/${V.nu.linhas.length} lançamentos corretos`,certos.length===V.nu.linhas.length,JSON.stringify(lin.slice(0,2)));
ok('Vencimento e cartão identificados pela foto',await p.$eval('[data-venc]',x=>x.value)==='2026-10-19'&&await p.$eval('[data-conta]',x=>x.value)==='Nu');
ok('Total da fatura conferido na revisão',/✓ confere/.test(await p.textContent('.panel')));
ok('Pagamento da fatura não entra como gasto',/pagamento\(s\) de fatura encontrados/.test(await p.textContent('.panel'))&&!lin.some(l=>/Pagamento/.test(l.s)));
ok('Consentimento antes de baixar o leitor ficou registrado',await p.evaluate(()=>!!window.__painel.B.meta.ocrPermitido));
// corrigir um campo e desmarcar uma linha
await p.fill('table.rev tr[data-l="0"] [data-c=descricao]','Padaria Exemplo (corrigida)'); await p.dispatchEvent('table.rev tr[data-l="0"] [data-c=descricao]','change');
await p.uncheck('table.rev tr[data-l="6"] [data-c=incluir]');
await p.click('[data-continuar]'); await p.waitForSelector('[data-imp-ok]');
const res=await p.$$eval('.res b',x=>x.map(y=>+y.textContent));
ok('Resumo antes de gravar: novos / existentes / pendentes',res[1]===6,res.join('/'));
await p.click('[data-imp-ok]'); await p.waitForFunction(()=>window.__painel.B.faturas.some(f=>f.id==='Nu-2026-10'));
const gr=await p.evaluate(()=>window.__painel.B.transacoes.filter(t=>t.faturaId==='Nu-2026-10'));
ok('Gravados 6, vinculados à fatura do vencimento (não à data da compra)',gr.length===6&&gr.every(t=>t.faturaId==='Nu-2026-10'&&t.fonteTipo==='foto'),gr.map(t=>t.mes).join(','));
ok('Correção feita na revisão foi gravada',gr.some(t=>t.descOriginal==='Padaria Exemplo (corrigida)'));
ok('Estorno entra como crédito (positivo) e parcela preservada',gr.some(t=>t.valor===28.9)&&gr.some(t=>t.parcela==='Parcela 2/5'));
ok('Lançamentos da foto passam pelas regras/pendências de sempre',gr.every(t=>['auto','pendente'].includes(t.status)));
const R1=await resumo(p);
// 2) mesma foto de novo: nada duplica
await p.evaluate(()=>location.hash='importar'); await p.waitForSelector('[data-foto]',{state:'attached'}); await galeria(p,D+'nu-foto.jpg'); await p.waitForSelector('[data-ler]'); await p.click('[data-ler]'); await p.waitForSelector('table.rev',{timeout:60000});
const marc=await p.$$eval('table.rev [data-c=incluir]',x=>x.filter(c=>c.checked).length), dupTxt=await p.$$eval('table.rev tr[data-l]',x=>x.filter(t=>/já existe/.test(t.textContent)).length);
ok('Mesma foto de novo: lançamentos marcados como "já existe" e desmarcados',dupTxt===6&&marc===1,`marcados ${marc}, já existe ${dupTxt}`);
await p.click('[data-foto-cancelar]');
ok('Cancelar não grava nada',JSON.stringify(await resumo(p))===JSON.stringify(R1));
// desfazer a importação da foto
await p.evaluate(()=>location.hash='importar'); await p.waitForSelector('[data-desfazer]');
await p.click('[data-desfazer]'); await p.waitForTimeout(800);
ok('Desfazer a importação da foto volta aos números de antes',JSON.stringify(await resumo(p))===JSON.stringify(R0),JSON.stringify([R0,await resumo(p)]));
// 3) PNG (print de app, Porto, fundo escuro, datas em cabeçalho)
await p.waitForSelector('[data-foto]',{state:'attached'}); await galeria(p,D+'app.png'); await p.waitForSelector('[data-ler]'); await p.click('[data-ler]'); await p.waitForSelector('table.rev',{timeout:60000});
lin=await p.$$eval('table.rev tr[data-l]',trs=>trs.map(tr=>({d:tr.querySelector('[data-c=data]').value,v:tr.querySelector('[data-c=valor]').value,t:tr.textContent})));
ok('PNG (print escuro do app Porto): lançamentos com data do cabeçalho do dia, sinalizados',lin.length===V.app.linhas.length&&lin.every((l,i)=>l.d===V.app.linhas[i][0]&&/data do cabeçalho/.test(l.t)),JSON.stringify(lin.map(l=>l.d+' '+l.v)));
ok('Conta Porto detectada pela foto',await p.$eval('[data-conta]',x=>x.value)==='Porto');
await p.click('[data-foto-cancelar]');
// 4) ilegível
await galeria(p,D+'ilegivel.jpg'); await p.waitForSelector('[data-ler]',{timeout:20000}).catch(()=>{});
if(await p.$('[data-ler]')){ await p.click('[data-ler]'); await p.waitForFunction(()=>/Não deu para ler/.test(document.body.innerText),null,{timeout:60000}); }
ok('Imagem ilegível: orienta tirar outra foto, nada importado',/Tire outra foto/.test(await p.textContent('body'))&&JSON.stringify(await resumo(p))===JSON.stringify(R0));
await p.click('[data-foto-cancelar]');
// 5) várias fotos da mesma fatura
await galeria(p,[D+'nu-p1.png',D+'nu-p2.png']); await p.waitForSelector('[data-ler]'); await p.click('[data-ler]'); await p.waitForSelector('table.rev',{timeout:90000});
const nl=await p.$$eval('table.rev tr[data-l]',x=>x.length), rep=await p.textContent('.res');
ok('Duas fotos sobrepostas: 7 lançamentos, repetidos entre fotos contados uma vez',nl===V.nu.linhas.length&&/Repetidos entre fotos\s*2/.test(rep),`${nl} · ${rep.replace(/\s+/g,' ')}`);
await p.click('[data-foto-cancelar]');
// 6) Texto ao Vivo (colar), com data impossível e valor com letra
await p.click('[data-colar-direto]'); await p.waitForSelector('[data-texto]');
const exist=await p.evaluate(()=>{const t=window.__painel.B.transacoes.find(t=>t.conta==='Nu'&&t.valor<0);return {d:t.data,v:t.valor}});
const [a,m,d]=exist.d.split('-');
await p.fill('[data-texto]',`Nubank\nVencimento 19/10/2026\n${d}/${m}/${a} Compra que ja existe R$ ${(-exist.v).toFixed(2).replace('.',',')}\n31/02 Data Impossivel R$ 10,00\n05/10 Valor Com Letra R$ 1O,5O`);
await p.click('[data-ler-colado]'); await p.waitForSelector('table.rev');
const rows=await p.$$eval('table.rev tr[data-l]',trs=>trs.map(tr=>({inc:tr.querySelector('[data-c=incluir]').checked,d:tr.querySelector('[data-c=data]').value,v:tr.querySelector('[data-c=valor]').value,t:tr.textContent,inval:tr.querySelectorAll('.inval').length})));
ok('Colar texto: lançamento que já existe no painel vem desmarcado',!rows[0].inc&&/já existe/.test(rows[0].t));
ok('Colar texto: data impossível fica vazia e marcada (não inventa)',rows[1].d===''&&rows[1].inval>0&&/data inválida/.test(rows[1].t));
ok('Colar texto: "1O,5O" vira 10,50',rows[2].v==='-10,50');
await p.click('[data-continuar]'); await p.waitForTimeout(300);
ok('Com campo inválido marcado, não deixa continuar',/Corrija antes de continuar/.test(await p.textContent('body'))&&!(await p.$('[data-imp-ok]')));
await p.click('[data-foto-cancelar]');
// 7) PDF escaneado (só imagem) → OCR
const pdf=await PDFDocument.create(); const png=await pdf.embedPng(fs.readFileSync(D+'nu.png')); const pg=pdf.addPage([png.width/2,png.height/2]); pg.drawImage(png,{x:0,y:0,width:png.width/2,height:png.height/2}); fs.writeFileSync(D+'escaneado.pdf',await pdf.save());
await p.setInputFiles('#arqs',D+'escaneado.pdf'); await p.waitForSelector('[data-pdf-ocr]',{timeout:30000});
await p.click('[data-pdf-ocr]'); await p.waitForSelector('[data-ler]',{timeout:30000}); await p.click('[data-ler]'); await p.waitForSelector('table.rev',{timeout:60000});
ok('PDF escaneado: lido por OCR depois de convertido em imagem',await p.$$eval('table.rev tr[data-l]',x=>x.length)===V.nu.linhas.length);
await p.click('[data-foto-cancelar]');
// 8) HEIC em navegador que não abre HEIC (Chromium)
fs.writeFileSync(D+'foto.heic',Buffer.from('000000186674797068656963','hex'));
await galeria(p,D+'foto.heic'); await p.waitForTimeout(800);
ok('HEIC sem suporte do navegador: mensagem clara, nada quebra',/HEIC/.test(await p.textContent('#toast')));
// 9) foto que vira PDF já importado depois: o PDF reconhece o que veio da foto.
// Só roda com dados LOCAIS (nunca publicados): LOCAL_PDF=<caminho de uma fatura Nubank_AAAA-MM-DD.pdf já presente na base local>.
const pdfAgo=process.env.LOCAL_PDF||'', mv=pdfAgo.match(/Nubank_(\d{4})-(\d{2})-(\d{2})\.pdf$/);
if(!mv) out.push('PULADO 9) PDF depois da foto — precisa de LOCAL_PDF (fatura real, só no computador)'); else {
const FID=`Nu-${mv[1]}-${mv[2]}`, VENC=`${mv[3]}/${mv[2]}/${mv[1]}`;
const ag=await p.evaluate(fid=>window.__painel.B.transacoes.filter(t=>t.faturaId===fid).map(t=>({d:t.data,v:t.valor,s:t.descOriginal||t.desc,id:t.id,fp:t.fonteFp})),FID);
await p.evaluate(async ([ag,fid,nome])=>{const {gravar}=await import('/js/db.js');const st=await import('/js/store.js');const B=st.B;await gravar([...ag.map(t=>({store:'transacoes',del:t.id})),...B.origensLista.filter(o=>ag.some(t=>t.fp===o.fp)).map(o=>({store:'origens',del:o.fp})),{store:'faturas',del:fid},...B.arquivos.filter(a=>a.nome===nome).map(a=>({store:'arquivos',del:a.hash}))]);await st.carregar()},[ag,FID,pdfAgo.split("/").pop()]);
await p.evaluate(()=>location.hash='importar'); await p.waitForSelector('[data-colar-direto]'); await p.click('[data-colar-direto]');
await p.fill('[data-texto]','Nubank\nVencimento '+VENC+'\n'+ag.map(t=>`${t.d.slice(8)}/${t.d.slice(5,7)}/${t.d.slice(0,4)} ${t.s.replace(/R\$|\d+,\d\d/g,'')} ${t.v>0?'-':''}R$ ${Math.abs(t.v).toFixed(2).replace('.',',')}`).join('\n'));
await p.click('[data-ler-colado]'); await p.waitForSelector('table.rev'); await p.click('[data-continuar]'); await p.waitForSelector('[data-imp-ok]'); await p.click('[data-imp-ok]'); await p.waitForTimeout(800);
await p.evaluate(()=>location.hash='importar'); await p.waitForSelector('#arqs',{state:'attached'}); await p.setInputFiles('#arqs',pdfAgo); await p.waitForSelector('[data-imp-cancel]',{timeout:30000});
const r9=await p.$$eval('.res b',x=>x.map(y=>+y.textContent));
ok('PDF importado depois da foto: nada duplicado (reconhece o que veio da foto)',r9[1]===0&&r9[2]===ag.length,r9.join('/'));
await p.click('[data-imp-cancel]');
}
// 10) privacidade: nenhuma chamada externa com o substituto; e SRI recusa arquivo adulterado do CDN
ok('Nenhuma imagem ou dado enviado para fora (nenhuma requisição externa no fluxo com o leitor local)',externos.length===0,externos.slice(0,3).join(' | '));
const q=await aparelho(false); await q.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({status:200,contentType:'application/javascript',body:'window.Tesseract={createWorker:()=>{throw new Error("adulterado")}}'}));
await galeria(q,D+'nu.png'); await q.waitForSelector('[data-ler]'); await q.click('[data-ler]');
await q.waitForFunction(()=>/Não foi possível baixar o leitor/.test(document.body.innerText),null,{timeout:20000}).catch(()=>{});
ok('Arquivo do CDN adulterado é recusado (SRI) e o painel oferece o Texto ao Vivo',/Não foi possível baixar o leitor/.test(await q.textContent('body'))&&!!(await q.$('[data-colar]')));
ok('Únicos acessos externos: o arquivo fixo do leitor (GET, sem dados)',externos.every(e=>e.startsWith('GET https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/')&&!/COM DADOS/.test(e)),externos.join(' | '));
ok('Sem erros de JavaScript',!erros.length,erros.slice(0,3).join(' | '));
console.log(out.join('\n')); await b.close();
