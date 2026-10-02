// Gera data/seed.json: a migração inicial do Raio-X validado para a base nova.
import fs from 'fs'; import crypto from 'crypto';
import * as bb from '../js/parsers/bb.js'; import * as nu from '../js/parsers/nubank.js';
import { carimbar } from '../js/fingerprint.js'; import { cents, chaveEstab } from '../js/utils.js';
const U='/root/.claude/uploads/87813fc4-4717-5a0e-9ae0-0fa7b56f9806/';
const L=JSON.parse(fs.readFileSync('/tmp/claude-0/pdflines.json'));
const dash=JSON.parse(fs.readFileSync('/home/claude/work/dash_data.json'));
const IMP='migracao-inicial', AGORA='2026-10-01T12:00:00.000Z';
const nomeLimpo=f=>f.replace(/^.*\//,'').replace(/^[0-9a-f]{8}-/,'');
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

// 1) ler todas as fontes com os leitores do app
const fontes=[]; // {arquivo, hash, doc}
const bbMeses=new Set();
for (const f of fs.readdirSync(U).filter(f=>f.endsWith('.csv'))) fontes.push({arquivo:nomeLimpo(f),hash:hash(U+f),doc:bb.lerCSV(fs.readFileSync(U+f,'utf8'))});
for (const [p,lines] of Object.entries(L)) { const t=lines.join('\n'); const doc=bb.detectar(t)?bb.lerPDF(lines):nu.lerPDF(lines); fontes.push({arquivo:nomeLimpo(p),hash:hash(p),doc}); }
// o mesmo mês do BB veio em CSV e PDF: ambos geram as mesmas impressões digitais
const origens={}; const linhasBB=[], linhasNu=[];
for (const F of fontes){ const st=carimbar(F.doc.linhas,F.doc.conta);
  st.forEach(l=>{ if(!origens[l.fp]) origens[l.fp]={fp:l.fp,conta:F.doc.conta,data:l.data,valor:l.valor,arquivo:F.arquivo,importacaoId:IMP};
    if(F.doc.conta==='BB'&&!linhasBB.some(x=>x.fp===l.fp)) linhasBB.push({...l,arquivo:F.arquivo});
    if(F.doc.conta==='Nu') linhasNu.push({...l,arquivo:F.arquivo,faturaId:F.doc.fatura.id}); }); }

// 2) faturas Nubank
const fats=fontes.filter(F=>F.doc.conta==='Nu').map(F=>({...F.doc.fatura,arquivo:F.arquivo,importacaoId:IMP})).sort((a,b)=>a.vencimento.localeCompare(b.vencimento));
fats.forEach((f,i)=>{const nx=fats[i+1];
  if(nx&&nx.pagamentoRecebido!=null){ f.pago=Math.min(nx.pagamentoRecebido,f.totalAPagar); f.status=nx.pagamentoRecebido+0.005>=f.totalAPagar?'paga':'parcial'; f.statusFonte=`Fatura seguinte (${nx.id}) registra pagamento recebido de R$ ${nx.pagamentoRecebido.toFixed(2)}.`; }
  else { f.status='sem-confirmacao'; f.statusFonte='A fatura seguinte ainda não foi importada.'; } });

// 3) lançamentos validados + vínculo com a origem e a fatura
const usados=new Set(); const tx=[];
const pick=(cands)=>{const c=cands.find(x=>!usados.has(x.fp)); if(c) usados.add(c.fp); return c;};
dash.rows.forEach((r,i)=>{
  const [d,mes,conta,desc,v,t,k,sk,obs,forma,ft,parc,cart,mov]=r;
  let src=null, faturaId=null;
  if(conta==='Nu'){ src=pick(linhasNu.filter(l=>l.data===d&&cents(l.valor)===cents(v)&&l.descricao===desc)) || pick(linhasNu.filter(l=>l.data===d&&cents(l.valor)===cents(v))); if(src) faturaId=src.faturaId; }
  else { const bbc=linhasBB.filter(l=>l.data===d);
    src = pick(bbc.filter(l=>cents(l.valor)===cents(v))) || (/Joyce/.test(desc)? bbc.find(l=>/Joyce/i.test(l.descricao)&&Math.abs(l.valor)>=Math.abs(v)) : null) || (/Rochinha|Reembolso Praça/.test(desc)?null:null); }
  tx.push({ id:'t'+String(i).padStart(4,'0'), data:d, mes, conta, cartao:cart||'', forma, desc, valor:v, tipo:t, mov, cat:k, sub:sk, obs:obs||'', parcela:parc||'',
    faturaId, fonteFp:src?src.fp:null, arquivo:src?src.arquivo:null, importacaoId:IMP,
    status: k==='Não identificado'?'pendente':'confirmado', classificacao: k==='Não identificado'?'pendente':'confirmada', criadoEm:AGORA });
});
const semFonte=tx.filter(t=>!t.fonteFp);
console.log('lançamentos',tx.length,'sem origem',semFonte.length, semFonte.map(t=>t.data+' '+t.desc+' '+t.valor).join(' | '));
console.log('origens',Object.keys(origens).length,'faturas',fats.map(f=>f.id+':'+f.status).join(' '));

// 4) regras confirmadas pelo usuário (editáveis no app)
const R=(padrao,cat,sub,extra={})=>({padrao,tipo:'despesa',mov:'gasto',cat,sub,...extra});
const regras=[
 R('VICTOR RENATO','Beleza','Perfume'), R('NELI COLQUE','Beleza','Cabelo'), R('JOSE ROBERTO IANONE','Serviços','Contador'),
 R('CARLOS ALBERTO DE JESUS','Evento e trabalho','Aluguel de equipamento'), R('LOJA SANTO ANTONIO','Alimentação fora de casa','Lanches e doces'),
 R('PAYGO*MOOCA','Alimentação fora de casa','Feira'), R('99 FOOD','Alimentação em casa','Delivery'), R('IFOOD','Alimentação em casa','Delivery'),
 R('IFD*MANAI','Alimentação fora de casa','Restaurante'), R('GATO DE OURO','Alimentação fora de casa','Padaria'), R('BRUMICK','Alimentação fora de casa','Sorvetes'),
 R('DNE PACAEMBU','Alimentação fora de casa','Café'), R('RIOSP','Transporte','Pedágio'), R('MATTEO PASQUINI','Transporte','Manutenção do carro'),
 R('ANDREIA NASCIMENTO','Pets','Petshop'), R('PATRICIA JUSTINO','Vestuário','Tênis e roupas esportivas'), R('ADIDAS','Vestuário','Tênis e roupas esportivas'),
 R('STORE - PARCELA','Vestuário','Tênis e roupas esportivas'), R('MUNDIAL','Vestuário','Calçados'), R('DORINHOS','Vestuário','Roupas'), R('TATIANADOSSANTOSV','Vestuário','Roupas'),
 R('RISHENG CHEN','Vestuário','Roupas'), R('MKCOMERCIODE','Vestuário','Roupas'), R('SHEILA MARTINS','Vestuário','Acessórios'), R('MARIA DE FATIMA VASCONCEL','Vestuário','Costura e ajustes'),
 R('ARMARINHOS','Casa','Utilidades'), R('AMERICANAS','Casa','Utilidades'), R('ANA ROBERIA','Casa','Serviços domésticos'),
 R('PAULO HENRIQUE DE OLIVEIR','Esporte','Equipamento'), R('ZIYOU','Esporte','Aluguel de esteira'), R('UNIVERSAL TS','Igreja','Universal TS (cartão)'),
 R('IBMUNDONOVO','Igreja','Bazar'), R('GRUPO GENNIUS','Assinaturas','Apple'), R('APPLE','Assinaturas','Apple',{valor:-19.90}),
 R('MARIA GABRIELA AGUILAR','Reembolsos','Maria Gabriela (valor enviado a amiga)',{tipo:'reembolso',mov:'reembolso'}),
 R('ANDREA GABRIEL','Reembolsos','Andrea Gabriel (valor enviado a amiga)',{tipo:'reembolso',mov:'reembolso'}),
].map((r,i)=>({id:'r'+String(i+1).padStart(3,'0'),origem:'confirmada',ativa:true,valor:null,conta:null,criadoEm:AGORA,...r}));

// 5) categorias (nome, tipos de gasto, definição)
const cats={};
tx.filter(t=>t.tipo==='despesa').forEach(t=>{(cats[t.cat]=cats[t.cat]||new Set()).add(t.sub)});
regras.filter(r=>r.tipo==='despesa').forEach(r=>{(cats[r.cat]=cats[r.cat]||new Set()).add(r.sub)});
const categorias=Object.entries(cats).map(([nome,s])=>{const d=dash.defs[nome]||['','',''];return {nome,subs:[...s].sort((a,b)=>a.localeCompare(b,'pt')),definicao:d[0],entra:d[1],naoEntra:d[2]}});

// 6) contas, cartões, arquivos, importação
const contas=[{id:'BB',nome:'Banco do Brasil',tipo:'conta-corrente',instituicao:'Banco do Brasil',titular:'Luiz Henrique A. Pinheiro',agencia:'1547-4',numero:'21546-5'},
 {id:'Nu',nome:'Nubank',tipo:'cartao-credito',instituicao:'Nubank',titular:'Joyce Alves Pinheiro',finais:['9179','2287'],fechamentoDia:12,vencimentoDia:19,pagaPor:'Pix do Banco do Brasil para Joyce'},
 {id:'Porto',nome:'Cartão Porto',tipo:'cartao-credito',instituicao:'Porto Seguro',titular:'Joyce A Pinheiro',finais:['1117'],vencimentoDia:3,pagaPor:'Pix do Banco do Brasil para PORTOSEG',obs:'Única cobrança: plano Petlove Saúde. O gasto entra pelo Pix do Banco do Brasil.'}];
const arquivos=fontes.map(F=>({hash:F.hash,nome:F.arquivo,instituicao:F.doc.instituicao,conta:F.doc.conta,tipo:F.doc.tipo,formato:F.doc.formato,periodoInicio:F.doc.periodoInicio,periodoFim:F.doc.periodoFim,importacaoId:IMP,importadoEm:AGORA}));
const extras=['IMG_1017.png','IMG_1018.png','IMG_1019.png','IMG_1020.png','IMG_1021.png','IMG_1022.png'];
const importacoes=[{id:IMP,data:AGORA,descricao:'Migração do Raio-X Financeiro validado (jan a ago/2026)',status:'concluida',
  arquivos:[...arquivos.map(a=>a.nome),...extras.map(e=>e+' (prints do cartão Porto, conferidos à mão)')],
  encontrados:tx.length,novos:tx.length,existentes:0,classificados:tx.filter(t=>t.status!=='pendente').length,pendentes:tx.filter(t=>t.status==='pendente').length,erros:0}];
const seed={versao:1,geradoEm:AGORA,contas,faturas:fats,transacoes:tx,categorias,regras,importacoes,arquivos,origens:Object.values(origens)};
fs.writeFileSync('data/seed.json',JSON.stringify(seed));
const g=tx.filter(t=>t.tipo==='despesa'&&t.mov==='gasto'&&t.mes>='2026-01');
console.log('gastos 2026',(g.reduce((a,t)=>a+cents(-t.valor),0)/100),'kb',Math.round(fs.statSync('data/seed.json').size/1024));
