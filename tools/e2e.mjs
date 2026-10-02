// Teste de ponta a ponta no Chromium: migração, totais, reimportação, importação nova, pendências, backup, celular.
import { chromium } from 'playwright';
import fs from 'fs';
const URL_='http://localhost:8765/';
const UP='/tmp/claude-0/up/';
const arquivos=fs.readdirSync(UP).filter(f=>/\.(csv|pdf)$/.test(f)).map(f=>UP+f);
const out=[]; const ok=(n,c,x='')=>{out.push(`${c?'OK  ':'FALHA'} ${n}${x?' — '+x:''}`)};
const b=await chromium.launch();
const ctx=await b.newContext({acceptDownloads:true}); const p=await ctx.newPage();
const erros=[]; p.on('pageerror',e=>erros.push(e.message)); p.on('console',m=>{if(m.type()==='error')erros.push(m.text())});
await p.goto(URL_); await p.waitForFunction(()=>window.__painel&&window.__painel.pronto,null,{timeout:30000});
const tot=()=>p.evaluate(async()=>{const C=await import('/js/calc.js');const {sum}=await import('/js/utils.js');const tx=window.__painel.B.transacoes;const s={ano:'2026'};
  const G=C.gastos(tx,s);const by=c=>C.totalGasto(G.filter(t=>t.conta===c));const mv=k=>sum(tx.filter(t=>t.mes.startsWith('2026')&&t.mov===k));
  const NI=G.filter(t=>t.cat==='Não identificado');
  return {E:sum(C.entradas(tx,s)),G:C.totalGasto(G),BB:by('BB'),Nu:by('Nu'),Porto:by('Porto'),nBB:G.filter(t=>t.conta==='BB').length,nNu:G.filter(t=>t.conta==='Nu').length,nPorto:G.filter(t=>t.conta==='Porto').length,
   NI:C.totalGasto(NI),nNI:NI.length,ap:-mv('aplicacao'),rs:mv('resgate'),tr:-mv('transferencia'),fa:-mv('fatura'),
   meses:C.resumoMensal(tx,s,C.mesesDoAno(tx,'2026')).map(r=>[r.m,r.e,r.g,r.r]), n:tx.length}});
let T=await tot();
ok('Migração: 651 lançamentos',T.n===651,T.n);
ok('Entradas 59.244,66',T.E===59244.66,T.E); ok('Gastos 49.565,19',T.G===49565.19,T.G); ok('Resultado 9.679,47',Math.round((T.E-T.G)*100)/100===9679.47);
ok('BB 398 / 34.854,39',T.nBB===398&&T.BB===34854.39,T.nBB+' '+T.BB); ok('Nubank 141 / 12.347,46',T.nNu===141&&T.Nu===12347.46,T.nNu+' '+T.Nu); ok('Porto 9 / 2.363,34',T.nPorto===9&&T.Porto===2363.34,T.nPorto+' '+T.Porto);
ok('Não identificado 17 / 744,93',T.nNI===17&&T.NI===744.93,T.nNI+' '+T.NI);
ok('Poupança 14.460 / 10.753',T.ap===14460&&T.rs===10753,T.ap+' '+T.rs); ok('Transferências 4.006,42',T.tr===4006.42,T.tr); ok('Faturas 15.416,54',T.fa===15416.54,T.fa);
const esper=[['2026-01',6609.17,5718.79],['2026-02',6861.74,6929.67],['2026-03',6958.72,4776.19],['2026-04',6990.32,6969.59],['2026-05',6990.32,8187.76],['2026-06',11050.46,4940.53],['2026-07',6839.57,5744.23],['2026-08',6944.36,6298.43]];
ok('Resumo mensal igual ao validado',esper.every(([m,e,g])=>{const r=T.meses.find(x=>x[0]===m);return r&&r[1]===e&&r[2]===g}),JSON.stringify(T.meses.filter(r=>!esper.some(([m,e,g])=>m===r[0]&&e===r[1]&&g===r[2]))));
const kp=await p.$$eval('.kpi .v',xs=>xs.map(x=>x.textContent));
ok('KPIs na tela',kp[0]==='R$ 59.244,66'&&kp[1]==='R$ 49.565,19'&&kp[2]==='R$ 9.679,47'&&kp[3]==='R$ 3.707,00'&&kp[4]==='17',kp.join(' | '));
await p.screenshot({path:'/tmp/claude-0/s-visao.png',fullPage:true});
// todas as telas abrem sem erro
for (const r of ['entradas','saidas','credito','debito','faturas','categorias','parcelamentos','tarifas','pendencias','importar','backup','visao']){
  await p.evaluate(r=>location.hash=r,r); await p.waitForTimeout(250);
  const e=await p.$eval('#view',v=>v.textContent.includes('Erro ao montar')); ok('Tela '+r,!e);
  if(['faturas','parcelamentos','pendencias','categorias','importar'].includes(r)) await p.screenshot({path:`/tmp/claude-0/s-${r}.png`,fullPage:true});
}
// faturas conferem
await p.evaluate(()=>location.hash='faturas'); await p.waitForTimeout(200);
const nconf=await p.$$eval('.cat .mt',xs=>xs.filter(x=>x.textContent.includes('não confere')).length); ok('Todas as faturas conferem com os lançamentos vinculados',nconf===0,nconf);
// filtros: mês e conta e busca
await p.evaluate(()=>location.hash='visao'); await p.selectOption('#fMes','2026-05'); await p.waitForTimeout(150);
ok('Filtro mês: maio gastos 8.187,76',(await p.$$eval('.kpi .v',x=>x[1].textContent))==='R$ 8.187,76');
await p.selectOption('#fConta','Nu'); await p.waitForTimeout(150);
const nuMai=await p.evaluate(async()=>{const C=await import('/js/calc.js');return C.totalGasto(C.gastos(window.__painel.B.transacoes,{ano:'2026',mes:'2026-05',conta:'Nu'}))});
ok('Filtro conta Nubank em maio',(await p.$$eval('.kpi .v',x=>x[1].textContent)).replace(/\D/g,'')===String(Math.round(nuMai*100)));
await p.click('#limpar'); await p.fill('#fBusca','apple'); await p.waitForTimeout(400);
const ap=await p.$$eval('.kpi .v',x=>x[1].textContent); ok('Busca "apple" filtra gastos',ap!=='R$ 49.565,19',ap); await p.fill('#fBusca',''); await p.waitForTimeout(400);
// reimportar tudo: zero novos
await p.evaluate(()=>location.hash='importar'); await p.waitForSelector('#arqs',{state:'attached'});
await p.setInputFiles('#arqs',arquivos); await p.waitForSelector('[data-imp-cancel]',{timeout:60000});
const res=await p.$$eval('.res b',x=>x.map(y=>+y.textContent)); ok('Reimportar os 23 arquivos: 0 novos',res[1]===0,'encontrados/novos/existentes/classif/pend/erros = '+res.join('/'));
const confs=await p.$$eval('td span.neg',x=>x.length); ok('Conferência de saldo/total bate em todos os arquivos',confs===0,confs);
await p.screenshot({path:'/tmp/claude-0/s-reimport.png',fullPage:true});
await p.click('[data-imp-cancel]');
// importação nova de verdade: remove a fatura de agosto e importa o PDF de novo
const antes=await p.evaluate(async()=>{const {gravar}=await import('/js/db.js');const st=await import('/js/store.js');const B=st.B;
  const xs=B.transacoes.filter(t=>t.faturaId==='Nu-2026-08');const val=xs.map(t=>({d:t.data,v:t.valor,cat:t.cat,sub:t.sub,mov:t.mov,desc:t.descOriginal||t.desc}));
  const ops=[...xs.map(t=>({store:'transacoes',del:t.id})),...B.origensLista.filter(o=>xs.some(t=>t.fonteFp===o.fp)).map(o=>({store:'origens',del:o.fp})),{store:'faturas',del:'Nu-2026-08'},...B.arquivos.filter(a=>a.nome==='Nubank_2026-08-19.pdf').map(a=>({store:'arquivos',del:a.hash}))];
  await gravar(ops); await st.carregar(); return val;});
await p.setInputFiles('#arqs',[arquivos.find(f=>f.endsWith('Nubank_2026-08-19.pdf'))]); await p.waitForSelector('[data-imp-ok]');
const r2=await p.$$eval('.res b',x=>x.map(y=>+y.textContent)); ok('Fatura de agosto como nova: 18 novos',r2[1]===18,r2.join('/'));
await p.click('[data-imp-ok]'); await p.waitForFunction(()=>window.__painel.B.faturas.some(f=>f.id==='Nu-2026-08'));
const depois=await p.evaluate(()=>window.__painel.B.transacoes.filter(t=>t.faturaId==='Nu-2026-08').map(t=>({d:t.data,v:t.valor,cat:t.cat,sub:t.sub,mov:t.mov,st:t.status,mot:t.motivo,desc:t.descOriginal})));
let iguais=0, difs=[]; for(const x of antes){const y=depois.find(z=>z.d===x.d&&z.v===x.v&&!z.used); if(y){y.used=1; if(y.cat===x.cat&&y.sub===x.sub) iguais++; else difs.push(`${x.desc} ${x.v}: validado ${x.cat}›${x.sub} | auto ${y.cat}›${y.sub} (${y.st}: ${y.mot})`);}}
ok(`Classificação automática da fatura de agosto: ${iguais}/${antes.length} iguais ao validado`,difs.every(d=>d.includes('pendente')),'\n      '+difs.join('\n      '));
T=await tot(); ok('Totais após reimportar agosto',T.G===49565.19||difs.length>0,T.G);
// pendência: classificar com regra
await p.evaluate(()=>location.hash='pendencias'); await p.waitForTimeout(200);
const id=await p.evaluate(()=>window.__painel.B.transacoes.find(t=>t.status==='pendente'&&/Tatuape/i.test(t.desc)).id);
await p.click(`[data-abrir-form="${id}"]`); await p.waitForSelector(`[data-form="${id}"]`);
const f=`[data-form="${id}"]`;
await p.selectOption(`${f} [name=cat]`,'Alimentação em casa'); await p.fill(`${f} [name=sub]`,'Supermercado'); await p.check(`${f} [name=regra]`); await p.fill(`${f} [name=padrao]`,'Tatuape');
const qtd=await p.$eval(`${f} [data-qtd]`,x=>x.textContent);
await p.click(`${f} [data-salvar]`); await p.waitForTimeout(500);
const pos=await p.evaluate(id=>{const B=window.__painel.B;return {t:B.transacoes.find(t=>t.id===id),r:B.regras.find(r=>r.padrao==='Tatuape'),pend:B.transacoes.filter(t=>t.status==='pendente').length}},id);
ok('Pendência classificada + regra criada e aplicada aos iguais',pos.t.cat==='Alimentação em casa'&&pos.t.status==='confirmado'&&!!pos.r,`regra casou ${qtd}; pendentes agora ${pos.pend}`);
// persistência: recarregar a página
await p.reload(); await p.waitForFunction(()=>window.__painel&&window.__painel.pronto);
ok('Dados persistem após recarregar',await p.evaluate(id=>window.__painel.B.transacoes.find(t=>t.id===id).cat==='Alimentação em casa',id));
// backup e restauração em outro "aparelho"
await p.evaluate(()=>location.hash='backup'); await p.waitForSelector('[data-exp]');
const [dl]=await Promise.all([p.waitForEvent('download'),p.click('[data-exp]')]); const bk='/tmp/claude-0/backup-teste.json'; await dl.saveAs(bk);
const T1=await tot();
const ctx2=await b.newContext(); const p2=await ctx2.newPage(); p2.on('pageerror',e=>erros.push('p2 '+e.message));
await p2.route('**/data/seed.json',r=>r.fulfill({status:404,body:''})); // simula o site publicado (sem dados)
await p2.goto(URL_); await p2.waitForFunction(()=>window.__painel&&window.__painel.pronto);
ok('Site sem seed abre vazio em Importar',await p2.evaluate(()=>window.__painel.B.transacoes.length===0&&location.hash!=='#visao'));
await p2.screenshot({path:'/tmp/claude-0/s-vazio.png',fullPage:true});
p2.on('dialog',d=>d.accept());
await p2.evaluate(()=>location.hash='backup'); await p2.waitForSelector('[data-rest]',{state:'attached'}); await p2.setInputFiles('[data-rest]',bk);
await p2.waitForFunction(()=>window.__painel.B.transacoes.length>600);
const T2=await p2.evaluate(async()=>{const C=await import('/js/calc.js');const {sum}=await import('/js/utils.js');const tx=window.__painel.B.transacoes;return {G:C.totalGasto(C.gastos(tx,{ano:'2026'})),E:sum(C.entradas(tx,{ano:'2026'})),n:tx.length,r:window.__painel.B.regras.length}});
ok('Backup restaurado em outro aparelho com os mesmos totais',T2.G===T1.G&&T2.E===T1.E&&T2.n===T1.n,JSON.stringify(T2));
// seed como arquivo (primeiro uso no site publicado)
const ctx3=await b.newContext(); const p3=await ctx3.newPage(); await p3.route('**/data/seed.json',r=>r.fulfill({status:404,body:''}));
await p3.goto(URL_); await p3.waitForFunction(()=>window.__painel&&window.__painel.pronto); await p3.waitForSelector('[data-rest-ini]',{state:'attached'});
await p3.setInputFiles('[data-rest-ini]','data/seed.json'); await p3.waitForFunction(()=>window.__painel.B.transacoes.length===651);
ok('Primeiro uso: carregar arquivo de dados validados',true);
// celular
const m=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}); const pm=await m.newPage(); pm.on('pageerror',e=>erros.push('mob '+e.message));
await pm.goto(URL_); await pm.waitForFunction(()=>window.__painel&&window.__painel.pronto);
for (const r of ['visao','pendencias','faturas','importar']){ await pm.evaluate(r=>location.hash=r,r); await pm.waitForTimeout(300);
  const ov=await pm.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth); ok('Celular sem rolagem lateral: '+r,ov<=0,ov);
  await pm.screenshot({path:`/tmp/claude-0/m-${r}.png`,fullPage:r!=='visao'}); }
ok('Sem erros de JavaScript',erros.length===0,erros.slice(0,5).join(' | '));
console.log(out.join('\n')); await b.close();
