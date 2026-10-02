// Teste da sincronização: dois "celulares" (contextos do navegador) e o Supabase simulado.
import { chromium } from 'playwright';
const APP='http://localhost:8765/', SB='http://localhost:8766', KEY='sb_publishable_TESTE_1234567890abcdef', SENHA='cafe janela bicicleta azul';
const out=[]; const ok=(n,c,x='')=>out.push(`${c?'OK  ':'FALHA'} ${n}${x?' — '+x:''}`);
const est=async()=>(await fetch(SB+'/__estado')).json();
const b=await chromium.launch(); const erros=[];
async function aparelho(nome,{semSeed}={}){const c=await b.newContext({viewport:{width:390,height:844},isMobile:true}); const p=await c.newPage();
  p.on('pageerror',e=>erros.push(nome+': '+e.message)); p.on('dialog',d=>d.accept());
  if(semSeed) await p.route('**/data/seed.json',r=>r.fulfill({status:404,body:''}));
  return p;}
const pronto=p=>p.waitForFunction(()=>window.__painel&&window.__painel.pronto);
const syncOk=(p,min=0)=>p.waitForFunction(m=>{const s=window.__painel&&window.__painel.sync;return s&&s.ligado&&!s.sincronizando&&s.ultima&&s.versao>=m},min,{timeout:20000});
const tot=p=>p.evaluate(async()=>{const C=await import('/js/calc.js');const {sum}=await import('/js/utils.js');const tx=window.__painel.B.transacoes;return {n:tx.length,G:C.totalGasto(C.gastos(tx,{ano:'2026'})),E:sum(C.entradas(tx,{ano:'2026'})),pend:tx.filter(t=>t.status==='pendente').length,regras:window.__painel.B.regras.length}});
const sincr=p=>p.evaluate(()=>import('/js/sync.js').then(s=>s.sincronizar()));

// A: cria
const A=await aparelho('A'); await A.goto(APP+'#sincronizar'); await pronto(A); await A.waitForSelector('[data-sync-form]');
await A.fill('[name=url]',SB); await A.fill('[name=chave]',KEY); await A.fill('[name=senha]',SENHA); await A.fill('[name=senha2]',SENHA); await A.fill('[name=aparelho]','Celular Henrique');
await A.click('[data-sync-criar]'); await syncOk(A,1);
let e=await est(); ok('Aparelho A cria o cofre',e.cofres.length===1&&e.cofres[0].versao===1,JSON.stringify(e.cofres.map(c=>({v:c.versao,t:c.tamanho,por:c.por}))));
ok('Nuvem só tem dado cifrado',/^v1z?\./.test(e.cofres[0].inicio)&&!/Sonda|transacoes|Apple/.test(e.cofres[0].inicio),e.cofres[0].inicio);
ok('Id do cofre não é a senha',e.cofres[0].id.length===64&&!e.cofres[0].id.includes('cafe'));
await A.waitForSelector('[data-convite]'); const hdr=await A.$eval('#hdrSync',x=>x.textContent); ok('Cabeçalho mostra sincronizado',/sincronizado/.test(hdr),hdr);
await A.screenshot({path:'/tmp/claude-0/sync-A.png',fullPage:true});
const T0=await tot(A);
// C: senha errada
const C=await aparelho('C',{semSeed:true}); await C.goto(APP+`#sincronizar?u=${encodeURIComponent(SB)}&k=${encodeURIComponent(KEY)}`); await pronto(C); await C.waitForSelector('[data-sync-entrar]');
await C.fill('[name=senha]','senha errada qualquer'); await C.click('[data-sync-entrar]'); await C.waitForFunction(()=>/Não encontrei/.test(document.querySelector('[data-erro]')?.textContent||''),null,{timeout:20000});
e=await est(); ok('Senha errada: recusa e não cria cofre',e.cofres.length===1);
// B: entra pelo convite, base vazia
const B=await aparelho('B',{semSeed:true}); await B.goto(APP+`#sincronizar?u=${encodeURIComponent(SB)}&k=${encodeURIComponent(KEY)}`); await pronto(B);
await B.waitForSelector('[data-sync-entrar]'); const pre=await B.$eval('[name=url]',x=>x.value); ok('Convite preenche endereço e chave',pre===SB);
await B.fill('[name=senha]',SENHA); await B.fill('[name=aparelho]','Celular marido'); await B.click('[data-sync-entrar]'); await syncOk(B,1);
await B.waitForFunction(()=>window.__painel.B.transacoes.length>600);
let TB=await tot(B); ok('Aparelho B recebe tudo com os mesmos totais',JSON.stringify(TB)===JSON.stringify(T0),JSON.stringify(TB));
// edição em A chega em B
const idA=await A.evaluate(async()=>{const st=await import('/js/store.js');const t=st.B.transacoes.find(t=>t.status==='pendente'&&/Tatuape/i.test(t.desc));await st.classificarLancamento(t.id,{tipo:'despesa',mov:'gasto',cat:'Alimentação em casa',sub:'Supermercado'},{criarRegra:true,padrao:'Tatuape',aplicarPendentes:true});return t.id});
await A.waitForTimeout(3500); await syncOk(A,2); await sincr(B);
let vB=await B.evaluate(id=>{const B=window.__painel.B;return {t:B.transacoes.find(t=>t.id===id).cat,r:B.regras.some(r=>r.padrao==='Tatuape')}},idA);
ok('Classificação + regra feitas em A aparecem em B',vB.t==='Alimentação em casa'&&vB.r,JSON.stringify(vB));
// edições simultâneas em registros diferentes
const [x,y]=await A.evaluate(()=>{const p=window.__painel.B.transacoes.filter(t=>t.status==='pendente');return [p[0].id,p[1].id]});
await A.evaluate(async id=>{const st=await import('/js/store.js');await st.classificarLancamento(id,{tipo:'despesa',mov:'gasto',cat:'Casa',sub:'Utilidades'},{})},x);
await B.evaluate(async id=>{const st=await import('/js/store.js');await st.classificarLancamento(id,{tipo:'despesa',mov:'gasto',cat:'Beleza',sub:'Cabelo'},{})},y);
await Promise.all([sincr(A),sincr(B)]); await sincr(A); await sincr(B);
const fa=await A.evaluate(([x,y])=>{const B=window.__painel.B;return [B.transacoes.find(t=>t.id===x).cat,B.transacoes.find(t=>t.id===y).cat]},[x,y]);
const fb=await B.evaluate(([x,y])=>{const B=window.__painel.B;return [B.transacoes.find(t=>t.id===x).cat,B.transacoes.find(t=>t.id===y).cat]},[x,y]);
ok('Edições ao mesmo tempo nos dois aparelhos: nenhuma se perde',fa.join()==='Casa,Beleza'&&fb.join()==='Casa,Beleza',fa+' | '+fb);
// mesmo lançamento editado nos dois: vale o último
await A.evaluate(async id=>{const st=await import('/js/store.js');await st.classificarLancamento(id,{tipo:'despesa',mov:'gasto',cat:'Casa',sub:'Decoração e plantas'},{})},x);
await new Promise(r=>setTimeout(r,50));
await B.evaluate(async id=>{const st=await import('/js/store.js');await st.classificarLancamento(id,{tipo:'despesa',mov:'gasto',cat:'Casa',sub:'Manutenção e materiais'},{})},x);
await sincr(A); await sincr(B); await sincr(A);
const ua=await A.evaluate(id=>window.__painel.B.transacoes.find(t=>t.id===id).sub,x), ub=await B.evaluate(id=>window.__painel.B.transacoes.find(t=>t.id===id).sub,x);
ok('Mesmo lançamento nos dois: vale a alteração mais recente, igual nos dois',ua==='Manutenção e materiais'&&ub===ua,ua+' | '+ub);
// lançamento manual criado em B e excluído em A
const idm=await B.evaluate(async()=>{const st=await import('/js/store.js');const t=await st.novoLancamentoManual({data:'2026-09-05',valor:-42.5,conta:'Porto',desc:'Teste manual sync',tipo:'despesa',mov:'gasto',cat:'Pets',sub:'Petshop',forma:'Crédito'});return t.id});
await sincr(B); await sincr(A);
ok('Lançamento manual criado em B aparece em A',await A.evaluate(id=>!!window.__painel.B.transacoes.find(t=>t.id===id),idm));
await A.evaluate(async id=>{const st=await import('/js/store.js');await st.excluirLancamento(id)},idm); await sincr(A); await sincr(B);
ok('Exclusão feita em A some em B',await B.evaluate(id=>!window.__painel.B.transacoes.find(t=>t.id===id),idm));
// sem internet
await fetch(SB+'/__offline'); 
await A.evaluate(async id=>{const st=await import('/js/store.js');await st.classificarLancamento(id,{tipo:'despesa',mov:'gasto',cat:'Saúde',sub:'Medicamentos e farmácia'},{})},y);
await sincr(A); const off=await A.evaluate(()=>import('/js/sync.js').then(s=>({o:s.estado.offline,e:s.estado.erro})));
ok('Sem internet: continua funcionando e marca "sem internet"',off.o&&!off.e,JSON.stringify(off));
const vOff=await A.evaluate(id=>window.__painel.B.transacoes.find(t=>t.id===id).cat,y); ok('Alteração offline fica salva no aparelho',vOff==='Saúde');
await fetch(SB+'/__offline'); await sincr(A); await sincr(B);
ok('Quando a internet volta, a alteração chega no outro',await B.evaluate(id=>window.__painel.B.transacoes.find(t=>t.id===id).cat,y)==='Saúde');
// recarregar B mantém sincronização
await B.reload(); await pronto(B); await syncOk(B);
const TA=await tot(A); TB=await tot(B); ok('Depois de tudo, A e B idênticos',JSON.stringify(TA)===JSON.stringify(TB),JSON.stringify(TA)+' | '+JSON.stringify(TB));
const sigA=await A.evaluate(async()=>{const db=await import('/js/db.js');const o={};for(const s of db.SINCRONIZADOS)o[s]=(await db.todos(s)).length;return o}), sigB=await B.evaluate(async()=>{const db=await import('/js/db.js');const o={};for(const s of db.SINCRONIZADOS)o[s]=(await db.todos(s)).length;return o});
ok('Todas as tabelas iguais nos dois',JSON.stringify(sigA)===JSON.stringify(sigB),JSON.stringify(sigA));
// backup não leva a configuração/chave
const bk=await A.evaluate(async()=>{const st=await import('/js/store.js');return JSON.stringify(await st.backupJSON())}); ok('Backup não contém a chave da sincronização',!/"sync"/.test(bk)&&!bk.includes(KEY));
// importar fatura em B (reimportação) não duplica nada em A
await B.evaluate(()=>location.hash='importar'); await B.waitForSelector('#arqs',{state:'attached'}); await B.setInputFiles('#arqs',['/tmp/claude-0/up/'+(await import('fs')).readdirSync('/tmp/claude-0/up').find(f=>f.endsWith('Nubank_2026-08-19.pdf'))]); await B.waitForSelector('[data-imp-cancel]',{timeout:30000});
ok('Reimportar em B: 0 novos',(await B.$$eval('.res b',x=>+x[1].textContent))===0);
await B.screenshot({path:'/tmp/claude-0/sync-B.png',fullPage:true});
ok('Sem erros de JavaScript',!erros.length,erros.join(' | '));
console.log(out.join('\n')); console.log('chamadas ao supabase:',(await est()).chamadas); await b.close();
