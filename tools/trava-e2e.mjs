// Testes da senha de abertura e da criptografia local (Chromium). Não usa valores fixos de dados reais:
// compara o que o próprio painel tinha antes e depois.
import { chromium } from 'playwright';
import { primeiroAcesso, desbloquear, SENHA_TESTE } from './helpers.mjs';
const APP='http://localhost:8765/';
const out=[]; const ok=(n,c,x='')=>out.push(`${c?'OK  ':'FALHA'} ${n}${x?' — '+x:''}`);
const b=await chromium.launch(); const erros=[];
const novo=async(op={})=>{const c=await b.newContext(op); const p=await c.newPage(); p.on('pageerror',e=>erros.push(e.message)); p.on('dialog',d=>d.accept()); return {c,p};};
const resumo=p=>p.evaluate(async()=>{const C=await import('/js/calc.js');const {sum}=await import('/js/utils.js');const B=window.__painel.B;const tx=B.transacoes;
  return {n:tx.length,G:C.totalGasto(C.gastos(tx,{})),E:sum(C.entradas(tx,{})),f:B.faturas.length,r:B.regras.length,pend:tx.filter(t=>t.status==='pendente').length}});
const travada=p=>p.evaluate(()=>{const b=document.body;const vis=[...document.querySelectorAll('header,nav,.wrap')].every(e=>getComputedStyle(e).display==='none');
  return {travado:b.classList.contains('travado'),escondido:vis,view:document.getElementById('view').innerHTML.length,txMem:window.__painel?window.__painel.B.transacoes.length:0,texto:b.innerText}});

// 1–3: primeiro acesso, confirmação, código
const {c:c1,p}=await novo(); await p.goto(APP);
await p.waitForSelector('#trava [name=s1]');
let t=await travada(p); ok('Primeiro acesso: só a tela de senha aparece',t.travado&&t.escondido&&!/R\$/.test(t.texto),t.texto.slice(0,60));
await p.fill('#trava [name=s1]','abc'); await p.fill('#trava [name=s2]','abc'); await p.click('#trava [data-ok]');
ok('Senha curta é recusada',/pelo menos/.test(await p.textContent('#trava [data-msg]')));
await p.fill('#trava [name=s1]',SENHA_TESTE); await p.fill('#trava [name=s2]',SENHA_TESTE+'x'); await p.click('#trava [data-ok]');
ok('Confirmação diferente é recusada',/não são iguais/.test(await p.textContent('#trava [data-msg]')));
await p.fill('#trava [name=s2]',SENHA_TESTE); await p.click('#trava [data-ok]'); await p.waitForSelector('#trava [data-codigo]');
const codigo=(await p.textContent('#trava [data-codigo]')).trim();
ok('Código de recuperação gerado (20 caracteres)',/^([A-HJ-NP-Z2-9]{4}-){4}[A-HJ-NP-Z2-9]{4}$/.test(codigo),codigo);
await p.check('#trava [name=anotei]'); await p.fill('#trava [name=fim]','ZZZZ'); await p.click('#trava [data-ok]');
ok('Confirmação errada do código é recusada',/não conferem/.test(await p.textContent('#trava [data-msg]')));
await p.fill('#trava [name=fim]',codigo.replace(/-/g,'').slice(-4)); await p.click('#trava [data-ok]');
await p.waitForFunction(()=>window.__painel&&window.__painel.pronto,null,{timeout:60000});
const R0=await resumo(p); ok('Abre com os dados (dados de teste locais)',R0.n>0,JSON.stringify(R0));

// armazenamento cru: nada legível
const cru=await p.evaluate(async()=>{const db=await new Promise(o=>{const r=indexedDB.open('painel-financeiro-vivo-protegido');r.onsuccess=()=>o(r.result)});
  const lojas=[...db.objectStoreNames];const res={};for(const s of lojas){res[s]=await new Promise(o=>{const r=db.transaction(s).objectStore(s).getAll();r.onsuccess=()=>o(r.result)})}
  const tx=window.__painel.B.transacoes; const amostra=[...new Set(tx.map(t=>t.descOriginal||t.desc).filter(d=>d&&d.length>5))].slice(0,80);
  const fps=tx.map(t=>t.fonteFp).filter(Boolean).slice(0,40);
  const dump=JSON.stringify(res,(k,v)=>v instanceof ArrayBuffer||ArrayBuffer.isView(v)?new TextDecoder('latin1').decode(v):v);
  const ac=amostra.filter(d=>dump.includes(d)), af=fps.filter(f=>dump.includes(f));
  return {lojas,ac,af,cofreCampos:Object.keys(res.cofre[0]||{}),temSenha:/senha-de-teste/.test(dump)}});
ok('IndexedDB: nenhuma descrição de lançamento legível',cru.ac.length===0,cru.ac.slice(0,3).join(' | '));
ok('IndexedDB: impressões digitais (data+valor) não aparecem nas chaves',cru.af.length===0);
ok('IndexedDB: senha não está guardada',!cru.temSenha,cru.cofreCampos.join(','));

// 4–6: recarregar bloqueia; senha errada; espera; nada apagado
await p.reload(); await p.waitForSelector('#trava [name=s]'); t=await travada(p);
ok('Recarregar: volta bloqueado, sem dados na tela nem na memória',t.travado&&t.escondido&&t.view<80&&t.txMem===0&&!/R\$/.test(t.texto));
for(let i=1;i<=5;i++){await p.fill('#trava [name=s]','errada'+i); await p.click('#trava [data-ok]'); await p.waitForFunction(()=>/incorreta|Aguarde/.test(document.querySelector('#trava [data-msg]').textContent));}
const m5=await p.textContent('#trava [data-msg]'); ok('Senha incorreta: mensagem clara; após 5 erros pede para aguardar',/Aguarde/.test(m5)&&/Nenhum dado foi apagado/.test(m5),m5);
ok('Durante a espera o campo fica bloqueado',await p.$eval('#trava [name=s]',x=>x.disabled));
await p.evaluate(async()=>{const db=await import('/js/db.js');const c=await db.lerProtecao();c.esperaAte=0;await db.gravarProtecao(c);}); // simula o fim da espera
await p.reload(); await desbloquear(p);
ok('Depois dos erros, senha correta abre e nada foi apagado',JSON.stringify(await resumo(p))===JSON.stringify(R0));

// 7: bloqueio manual
await p.click('#btnTravar'); await p.waitForSelector('#trava [name=s]'); t=await travada(p);
ok('Bloqueio manual limpa tela e memória',t.travado&&t.view===0&&t.txMem===0&&!/R\$/.test(t.texto));
const lerSemChave=await p.evaluate(async()=>{try{const db=await import('/js/db.js');await db.todos('transacoes');return 'leu'}catch(e){return e.message}});
ok('Bloqueado: o código do app não consegue ler a base',/bloqueado/i.test(lerSemChave),lerSemChave);
await desbloquear(p);

// 8: segundo plano (com intervalo configurável)
const vis=async v=>p.evaluate(v=>{Object.defineProperty(document,'visibilityState',{value:v,configurable:true});document.dispatchEvent(new Event('visibilitychange'))},v);
await p.evaluate(()=>location.hash='seguranca'); await p.waitForSelector('[data-auto]'); await p.selectOption('[data-auto]','1'); await p.waitForTimeout(300);
await vis('hidden'); ok('Ao sair do app a tela é coberta na hora',await p.evaluate(()=>document.body.classList.contains('cortina')));
await vis('visible'); ok('Volta em menos de 1 min (config. 1 min): continua aberto',await p.evaluate(()=>window.__painel.pronto&&!document.body.classList.contains('travado')));
await p.selectOption('[data-auto]','0'); await p.waitForTimeout(300);
await vis('hidden'); await vis('visible'); await p.waitForSelector('#trava [name=s]',{timeout:5000}).catch(()=>{});
ok('Config. "imediatamente": volta bloqueado',(await travada(p)).travado);
await desbloquear(p); await p.evaluate(()=>location.hash='seguranca'); await p.waitForSelector('[data-auto]'); await p.selectOption('[data-auto]','5'); await p.waitForTimeout(300);
await p.evaluate(()=>{Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true})});
ok('Configuração do intervalo fica salva',await p.evaluate(()=>import('/js/db.js').then(d=>d.lerProtecao()).then(c=>c.autoMin))===5);

// troca de senha
await p.fill('[data-form-senha] [name=atual]','errada'); await p.fill('[data-form-senha] [name=s1]','nova-senha-456'); await p.fill('[data-form-senha] [name=s2]','nova-senha-456'); await p.click('[data-trocar]');
await p.waitForFunction(()=>/incorreta/.test(document.querySelector('[data-form-senha] [data-erro]').textContent)); ok('Trocar senha exige a senha atual',true);
await p.fill('[data-form-senha] [name=atual]',SENHA_TESTE); await p.click('[data-trocar]'); await p.waitForTimeout(2500);
await p.reload(); await p.waitForSelector('#trava [name=s]'); await p.fill('#trava [name=s]',SENHA_TESTE); await p.click('#trava [data-ok]'); await p.waitForFunction(()=>/incorreta/.test(document.querySelector('#trava [data-msg]').textContent));
await desbloquear(p,'nova-senha-456'); ok('Senha alterada: a antiga não abre, a nova abre, dados iguais',JSON.stringify(await resumo(p))===JSON.stringify(R0));

// recuperação pelo código
await p.reload(); await p.waitForSelector('#trava [data-esqueci]'); await p.click('#trava [data-esqueci]');
await p.fill('#trava [name=c]','AAAA-BBBB-CCCC-DDDD-EEEE'); await p.fill('#trava [name=s1]','recuperada-789'); await p.fill('#trava [name=s2]','recuperada-789'); await p.click('#trava [data-ok]');
await p.waitForFunction(()=>/Código incorreto/.test(document.querySelector('#trava [data-msg]').textContent)); ok('Código errado é recusado',true);
await p.fill('#trava [name=c]',codigo.toLowerCase().replace(/-/g,' ')); await p.click('#trava [data-ok]');
await p.waitForFunction(()=>window.__painel&&window.__painel.pronto,null,{timeout:30000});
ok('Esqueci a senha: código abre e define senha nova, dados iguais',JSON.stringify(await resumo(p))===JSON.stringify(R0));
await p.reload(); await desbloquear(p,'recuperada-789'); ok('Nova senha (definida pelo código) funciona depois de recarregar',true);

// offline (painel instalado/aberto antes)
await p.waitForTimeout(1500); await c1.setOffline(true); await p.reload(); await desbloquear(p,'recuperada-789');
ok('Sem internet: abre do cache, pede senha e mostra os mesmos dados',JSON.stringify(await resumo(p))===JSON.stringify(R0)); await c1.setOffline(false);
await c1.close();

// migração de base antiga (sem proteção), com dados carregados do arquivo local de teste
const {c:c2,p:q}=await novo(); await q.route('**/data/seed.json',r=>r.fulfill({status:404,body:''}));
await q.goto(APP+'tools/blank.html');
const antes=await q.evaluate(async()=>{const seed=await (await fetch('/data/seed.json')).json().catch(()=>null)||await (await fetch('/data/seed.json?x=1')).json();return null}).catch(()=>null);
await q.unroute('**/data/seed.json');
const base=await q.evaluate(async()=>{const seed=await (await fetch('/data/seed.json')).json();
  const ST={meta:'chave',contas:'id',faturas:'id',transacoes:'id',categorias:'nome',regras:'id',importacoes:'id',arquivos:'hash',origens:'fp',lixeira:'id',copias:'id',conflitos:'id'};
  const db=await new Promise(o=>{const r=indexedDB.open('painel-financeiro-vivo',3);r.onupgradeneeded=()=>{for(const[s,k]of Object.entries(ST))r.result.createObjectStore(s,{keyPath:k})};r.onsuccess=()=>o(r.result)});
  const chave=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  await new Promise(o=>{const tx=db.transaction(Object.keys(ST),'readwrite');for(const s of ['contas','faturas','transacoes','categorias','regras','importacoes','arquivos','origens'])for(const r of seed[s])tx.objectStore(s).put(r);
    tx.objectStore('meta').put({chave:'migracao',valor:{em:'x'}});tx.objectStore('meta').put({chave:'sync',valor:{url:'https://exemplo.supabase.co',chavePublica:'sb_publishable_x',aparelho:'Teste',chave}});tx.oncomplete=o});
  db.close(); return {n:seed.transacoes.length,f:seed.faturas.length}});
await q.goto(APP); await q.waitForSelector('#trava [name=s1]');
ok('Base antiga detectada no primeiro acesso',new RegExp(base.n+' lançamentos').test(await q.textContent('#trava')));
await primeiroAcesso(q);
const R1=await resumo(q); const dbs=await q.evaluate(()=>indexedDB.databases().then(x=>x.map(d=>d.name)));
ok('Migração: mesmos lançamentos e faturas, conferidos',R1.n===base.n&&R1.f===base.f,JSON.stringify(R1));
ok('Migração: base antiga sem proteção removida só depois da conferência',!dbs.includes('painel-financeiro-vivo')&&dbs.includes('painel-financeiro-vivo-protegido'),dbs.join(','));
const pend=await q.evaluate(()=>import('/js/sync.js').then(s=>s.configPendente()));
ok('Migração: sincronização antiga pede a senha da família de novo (endereço mantido)',pend&&pend.url==='https://exemplo.supabase.co'&&!('chave' in pend));
ok('Migração: cópia de segurança cifrada guardada',(await q.evaluate(()=>import('/js/db.js').then(d=>d.todos('copias')).then(x=>x.length)))>=1);
await c2.close();
ok('Sem erros de JavaScript',!erros.length,erros.slice(0,3).join(' | '));
console.log(out.join('\n')); await b.close();
