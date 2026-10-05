// Auditoria + teste da sincronização: dois "celulares" (contextos do navegador) e o Supabase simulado
// (tools/mock-supabase.mjs, mesmas regras do supabase.sql). Rode com o mock e o servidor do app no ar.
import { chromium } from 'playwright';
import fs from 'fs';
const APP='http://localhost:8765/', SB='http://localhost:8766', KEY='sb_publishable_TESTE_1234567890abcdef', SENHA='cafe janela bicicleta azul';
const out=[]; const ok=(n,c,x='')=>out.push(`${c?'OK  ':'FALHA'} ${n}${x?' — '+x:''}`);
const est=async()=>(await fetch(SB+'/__estado')).json(); const mock=u=>fetch(SB+u);
const b=await chromium.launch(); const erros=[]; const corpos=[];
async function aparelho(nome,{semSeed}={}){const c=await b.newContext({viewport:{width:390,height:844},isMobile:true}); const p=await c.newPage();
  p.on('pageerror',e=>erros.push(nome+': '+e.message)); p.on('console',m=>{if(/Content Security Policy|Refused to/i.test(m.text()))erros.push(nome+' CSP: '+m.text())}); p.on('dialog',d=>d.accept());
  p.on('request',r=>{if(r.url().startsWith(SB)&&r.method()==='POST')corpos.push({de:nome,url:r.url(),corpo:r.postData()||'',h:r.headers()})});
  if(semSeed) await p.route('**/data/seed.json',r=>r.fulfill({status:404,body:''}));
  return p;}
const pronto=p=>p.waitForFunction(()=>window.__painel&&window.__painel.pronto);
const syncOk=(p,min=0)=>p.waitForFunction(m=>{const s=window.__painel&&window.__painel.sync;return s&&s.ligado&&!s.sincronizando&&s.ultima&&!s.erro&&s.versao>=m},min,{timeout:30000});
const est2=p=>p.evaluate(()=>{const s=window.__painel.sync;return {erro:s.erro,bloqueio:s.bloqueio,pend:s.pendentes,v:s.versao,off:s.offline}});
const tot=p=>p.evaluate(async()=>{const C=await import('/js/calc.js');const {sum}=await import('/js/utils.js');const tx=window.__painel.B.transacoes;return {n:tx.length,G:C.totalGasto(C.gastos(tx,{ano:'2026'})),E:sum(C.entradas(tx,{ano:'2026'})),pend:tx.filter(t=>t.status==='pendente').length,regras:window.__painel.B.regras.length}});
const sincr=(p,o)=>p.evaluate(o=>import('/js/sync.js').then(s=>s.sincronizar(o)),o||{});
const classif=(p,id,cat,sub)=>p.evaluate(async([id,cat,sub])=>{const st=await import('/js/store.js');await st.classificarLancamento(id,{tipo:'despesa',mov:'gasto',cat,sub},{})},[id,cat,sub]);
const txDe=(p,id)=>p.evaluate(id=>window.__painel.B.transacoes.find(t=>t.id===id)||null,id);
const nLocal=(p,store)=>p.evaluate(s=>import('/js/db.js').then(d=>d.todos(s)).then(x=>x.length),store);
const preencher=async(p,{senha2=SENHA,nome}={})=>{await p.fill('[name=senha]',SENHA); await p.fill('[name=senha2]',senha2); if(nome) await p.fill('[name=aparelho]',nome);};

// ---------- A cria ----------
const A=await aparelho('A'); await A.goto(APP+'#sincronizar'); await pronto(A); await A.waitForSelector('[data-sync-form]');
await A.fill('[name=url]',SB);
// chaves secretas recusadas
const jwtSR='eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url')+'.x';
for (const [rot,k] of [['sb_secret_',`sb_secret_${'x'.repeat(30)}`],['JWT service_role',jwtSR]]){ await A.fill('[name=chave]',k); await preencher(A); await A.click('[data-sync-criar]');
  await A.waitForFunction(()=>/SECRETA|service_role/.test(document.querySelector('[data-erro]').textContent),null,{timeout:15000}); ok(`Recusa chave secreta (${rot})`,(await est()).cofres.length===0); }
await A.fill('[name=chave]',KEY);
await preencher(A,{senha2:'outra coisa qualquer'}); await A.click('[data-sync-criar]');
await A.waitForFunction(()=>/não confere/.test(document.querySelector('[data-erro]').textContent),null,{timeout:15000}); ok('Pede confirmação da senha (diferente = recusa)',(await est()).cofres.length===0);
await preencher(A,{nome:'Celular Henrique'}); await A.click('[data-sync-criar]'); await syncOk(A,1);
let e=await est(); ok('A cria o cofre',e.cofres.length===1&&e.cofres[0].versao===1);
ok('Cópia de segurança antes da 1ª sincronização (A)',(await nLocal(A,'copias'))>=1);
ok('Tabela só tem id, versão, data e bloco cifrado',JSON.stringify(e.cofres[0].colunas.sort())===JSON.stringify(['dados','em','versao']),e.cofres[0].colunas.join(','));
const cfgA=await A.evaluate(()=>import('/js/sync.js').then(s=>s.config()).then(c=>({tipo:Object.prototype.toString.call(c.chave),extraivel:c.chave.extractable,usos:c.chave.usages,campos:Object.keys(c)})));
ok('Chave guardada como CryptoKey NÃO exportável, sem senha salva',cfgA.tipo==='[object CryptoKey]'&&cfgA.extraivel===false&&!cfgA.campos.some(k=>/senha|password/i.test(k)),JSON.stringify(cfgA));
const exp=await A.evaluate(async()=>{try{const s=await import('/js/sync.js');const c=await s.config();await crypto.subtle.exportKey('raw',c.chave);return 'exportou'}catch(e){return 'bloqueado'}}); ok('Navegador impede exportar a chave',exp==='bloqueado');

// ---------- C: senha errada ----------
const C=await aparelho('C',{semSeed:true}); await C.goto(APP+`#sincronizar?u=${encodeURIComponent(SB)}&k=${encodeURIComponent(KEY)}`); await pronto(C); await C.waitForSelector('[data-sync-entrar]');
await C.fill('[name=senha]','senha errada qualquer'); await C.fill('[name=senha2]','senha errada qualquer'); await C.click('[data-sync-entrar]');
await C.waitForFunction(()=>/Não encontrei/.test(document.querySelector('[data-erro]')?.textContent||''),null,{timeout:20000});
ok('Senha errada: recusa, não cria cofre',(await est()).cofres.length===1);

// ---------- B entra ----------
const B=await aparelho('B',{semSeed:true}); await B.goto(APP+`#sincronizar?u=${encodeURIComponent(SB)}&k=${encodeURIComponent(KEY)}`); await pronto(B); await B.waitForSelector('[data-sync-entrar]');
await preencher(B,{nome:'Celular marido'}); await B.click('[data-sync-entrar]'); await syncOk(B,1); await B.waitForFunction(()=>window.__painel.B.transacoes.length>600);
const T0=await tot(A); ok('B recebe tudo, totais iguais',JSON.stringify(await tot(B))===JSON.stringify(T0),JSON.stringify(T0));
ok('Cópia de segurança antes da 1ª sincronização (B)',(await nLocal(B,'copias'))>=1);

// ---------- edição, pendentes, concorrência, conflito ----------
const pend=await A.evaluate(()=>window.__painel.B.transacoes.filter(t=>t.status==='pendente').map(t=>t.id));
await fetch(SB+'/__offline'); await classif(A,pend[0],'Casa','Utilidades'); await sincr(A);
let sA=await est2(A); ok('Sem internet: marca offline, sem erro, mostra pendentes',sA.off&&!sA.erro&&sA.pend>0,JSON.stringify(sA));
const hdr=await A.$eval('#hdrSync',x=>x.textContent); ok('Cabeçalho mostra alterações pendentes',/pendente/.test(hdr),hdr);
await fetch(SB+'/__offline'); await sincr(A); sA=await est2(A); ok('Volta a internet: envia e zera pendentes',sA.pend===0&&!sA.erro,JSON.stringify(sA));
await sincr(B); ok('B recebe a alteração',(await txDe(B,pend[0])).cat==='Casa');
// edições simultâneas em registros diferentes
await classif(A,pend[1],'Beleza','Cabelo'); await classif(B,pend[2],'Pets','Petshop');
await Promise.all([sincr(A),sincr(B)]); await sincr(A); await sincr(B);
ok('Edições simultâneas em registros diferentes: nenhuma se perde',(await txDe(A,pend[2])).cat==='Pets'&&(await txDe(B,pend[1])).cat==='Beleza');
// mesmo registro nos dois → vence o mais recente e o conflito fica registrado
await classif(A,pend[3],'Casa','Decoração e plantas'); await new Promise(r=>setTimeout(r,30)); await classif(B,pend[3],'Casa','Manutenção e materiais');
await sincr(A); await sincr(B); await sincr(A);
const ua=(await txDe(A,pend[3])).sub, ub=(await txDe(B,pend[3])).sub;
ok('Mesmo registro nos dois: vale o mais recente, igual nos dois',ua==='Manutenção e materiais'&&ub===ua,ua+' | '+ub);
const confB=await B.evaluate(()=>import('/js/db.js').then(d=>d.todos('conflitos'))), confA=await A.evaluate(()=>import('/js/db.js').then(d=>d.todos('conflitos')));
const cf=[...confA,...confB].find(c=>c.chave===pend[3]);
ok('Conflito registrado com a versão descartada',!!cf&&cf.descartado&&cf.descartado.sub==='Decoração e plantas',cf?`${cf.tipo}: venceu ${cf.venceu}`:'nenhum');
// restaurar a versão descartada
const dev=confA.find(c=>c.chave===pend[3])?A:B; await dev.evaluate(()=>location.hash='sincronizar'); await dev.waitForSelector('[data-restaurar-conflito]',{timeout:10000}); await dev.click('[data-restaurar-conflito]'); await dev.waitForTimeout(300);
await sincr(dev); const outro=dev===A?B:A; await sincr(outro);
ok('Usar a versão descartada vale nos dois',(await txDe(A,pend[3])).sub==='Decoração e plantas'&&(await txDe(B,pend[3])).sub==='Decoração e plantas');

// ---------- exclusões não voltam ----------
const vit=pend[4], vit2=pend[5];
// B fica "atrasado": não sincroniza. A apaga dois lançamentos. B edita um deles antes de sincronizar.
await A.evaluate(async ids=>{const {gravar}=await import('/js/db.js');const st=await import('/js/store.js');await gravar(ids.map(id=>({store:'transacoes',del:id})));await st.carregar()},[vit,vit2]); await sincr(A);
await classif(B,vit2,'Saúde','Ótica');
await sincr(B); await sincr(A);
ok('Exclusão chega no aparelho atrasado (cópia antiga não ressuscita)',!(await txDe(B,vit))&&!(await txDe(A,vit)));
ok('Apagado num e editado no outro: exclusão vence e conflito fica registrado',!(await txDe(B,vit2))&&!(await txDe(A,vit2))&&(await B.evaluate(id=>import('/js/db.js').then(d=>d.todos('conflitos')).then(x=>x.some(c=>c.chave===id&&c.tipo==='exclusao')),vit2)));
await sincr(A); await sincr(B); ok('Continua apagado depois de novas sincronizações',!(await txDe(A,vit))&&!(await txDe(B,vit)));

// recriar de propósito (ex.: desfazer importação e importar de novo) funciona nos dois
const rec=pend[7]; const regRec=await txDe(A,rec);
await A.evaluate(async id=>{const {gravar}=await import('/js/db.js');await gravar([{store:'transacoes',del:id}])},rec); await sincr(A); await sincr(B);
ok('Exclusão normal propaga',!(await txDe(B,rec)));
await A.evaluate(async r=>{const {gravar}=await import('/js/db.js');const st=await import('/js/store.js');const {_mod,...x}=r;await gravar([{store:'transacoes',put:x}]);await st.carregar()},regRec); await sincr(A); await sincr(B);
ok('Recriar de propósito (reimportação) volta nos dois',!!(await txDe(B,rec))&&!!(await txDe(A,rec)));

// ---------- muitas exclusões: pausa e pede confirmação ----------
const muitos=await A.evaluate(()=>window.__painel.B.transacoes.filter(t=>t.conta==='BB'&&t.mes==='2026-03').map(t=>t.id));
await A.evaluate(async ids=>{const {gravar}=await import('/js/db.js');const st=await import('/js/store.js');await gravar(ids.map(id=>({store:'transacoes',del:id})));await st.carregar()},muitos); await sincr(A);
const copiasAntes=await nLocal(B,'copias'); const nB0=(await tot(B)).n;
await sincr(B); let sB=await est2(B);
ok(`Sincronização que apagaria ${muitos.length} lançamentos em B fica pausada`,!!sB.bloqueio&&(await tot(B)).n===nB0,JSON.stringify(sB.bloqueio&&{n:sB.bloqueio.n}));
await sincr(B,{permitirExclusoes:true}); sB=await est2(B);
ok('Depois da confirmação aplica, com cópia de segurança antes',!sB.bloqueio&&(await tot(B)).n===nB0-muitos.length&&(await nLocal(B,'copias'))>copiasAntes);

// ---------- restauração de backup não perde dados ----------
const bk=await B.evaluate(async()=>{const st=await import('/js/store.js');return await st.backupJSON()});
const c0=await nLocal(B,'copias'); await B.evaluate(async o=>{const st=await import('/js/store.js');await st.restaurarBackup(o)},bk);
ok('Restaurar backup guarda cópia do que existia antes',(await nLocal(B,'copias'))===Math.min(8,c0+1));
ok('Backup não leva chave, configuração nem cópias',!JSON.stringify(bk).includes('"sync"')&&!JSON.stringify(bk).includes(KEY)&&!('copias' in bk.dados));
await sincr(B); await sincr(A);
ok('A e B idênticos no fim',JSON.stringify(await tot(A))===JSON.stringify(await tot(B)),JSON.stringify(await tot(A)));

// ---------- o que saiu pela rede ----------
const todosCorpos=corpos.map(c=>c.corpo).join('\n');
ok('Nenhum envio contém a senha',!todosCorpos.includes(SENHA)&&!todosCorpos.includes('cafe'));
ok('Nenhum envio contém dado financeiro ou nome de aparelho em texto',!/Sonda|Applecombill|Tatuape|transacoes|49565|Celular Henrique|Celular marido|Pinheiro/.test(todosCorpos));
ok('Só 3 campos vão ao servidor: id, bloco cifrado, versão esperada',corpos.filter(c=>c.url.endsWith('gravar_cofre')).every(c=>Object.keys(JSON.parse(c.corpo)).sort().join()==='p_dados,p_id,p_versao_esperada'));
ok('Nenhuma chave secreta nos cabeçalhos',corpos.every(c=>c.h.apikey===KEY||c.h.apikey?.startsWith('sb_secret_')===false)&&!corpos.some(c=>(c.h.authorization||'').includes('service_role')));
const ivs=corpos.filter(c=>c.url.endsWith('gravar_cofre')).map(c=>JSON.parse(c.corpo).p_dados.split('.')[1]);
ok(`IV diferente em cada gravação (${ivs.length} gravações)`,new Set(ivs).size===ivs.length&&ivs.every(iv=>Buffer.from(iv,'base64').length===12));

// ---------- adulteração e rollback ----------
await mock('/__guardar'); await classif(A,pend[6],'Casa','Utilidades'); await sincr(A); await sincr(B);
const vAntes=(await est()).cofres[0].versao; await mock('/__rollback');
const nA=(await tot(A)).n; await sincr(A); sA=await est2(A);
ok('Nuvem devolve versão antiga (rollback): sincronização para',/mais antiga/.test(sA.erro||''),`${vAntes}→${(await est()).cofres[0].versao}: ${sA.erro}`);
ok('…e nada muda localmente',(await txDe(A,pend[6])).cat==='Casa'&&(await tot(A)).n===nA);
await mock('/__adulterar'); await sincr(B); sB=await est2(B);
ok('Bloco adulterado na nuvem: AES-GCM detecta e para',/alterado fora do app|não confere/.test(sB.erro||''),sB.erro);
await A.screenshot({path:'/tmp/claude-0/sync-A.png',fullPage:true});
ok('Sem erros de JavaScript nem de CSP',!erros.length,erros.slice(0,4).join(' | '));
console.log(out.join('\n')); console.log('requisições ao supabase:',corpos.length); await b.close();
