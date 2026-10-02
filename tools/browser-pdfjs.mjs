import { chromium } from 'playwright';
import fs from 'fs';
const ref=JSON.parse(fs.readFileSync('/tmp/claude-0/pdflines.json'));
const files=fs.readdirSync('/tmp/claude-0/up').filter(f=>f.endsWith('.pdf')).sort();
const b=await chromium.launch(); const p=await b.newPage();
p.on('console',m=>console.log('console:',m.text()));
await p.goto('http://localhost:8765/tools/blank.html');
const res=await p.evaluate(async files=>{
  const {linhasDoPDF}=await import('/js/pdftext.js'); const out={};
  for(const f of files){ const buf=await (await fetch('/test-up/'+encodeURIComponent(f))).arrayBuffer(); out[f]=await linhasDoPDF(buf); }
  return out; },files);
fs.writeFileSync('/tmp/claude-0/pdfjslines.json',JSON.stringify(res));
const bb=await import('../js/parsers/bb.js'), nu=await import('../js/parsers/nubank.js'), {sum}=await import('../js/utils.js');
let ok=true;
for(const f of files){ const ls=res[f], t=ls.join('\n'); const kk=Object.keys(ref).find(k=>k.endsWith(f)); if(!kk){console.log("sem ref (cópia duplicada)",f);continue;} const refL=ref[kk];
  const P=bb.detectar(t)?bb:nu.detectar(t)?nu:null; if(!P){console.log('NÃO DETECTADO',f,ls.slice(0,15));ok=false;continue;}
  let a,bR; try{a=P.lerPDF(ls);}catch(e){console.log('ERRO',f,e.message,ls.slice(0,40));ok=false;continue;} bR=P.lerPDF(refL);
  const same=a.linhas.length===bR.linhas.length&&a.linhas.every((x,i)=>x.data===bR.linhas[i].data&&x.valor===bR.linhas[i].valor&&x.descricao===bR.linhas[i].descricao&&x.cartao4===bR.linhas[i].cartao4);
  let rec; if(P===bb) rec=Math.round((a.saldoInicial+sum(a.linhas))*100)/100===a.saldoFinal; else rec=Math.abs(-sum(a.linhas)-(a.fatura.totalCompras+a.fatura.outrosLancamentos))<0.005 && JSON.stringify(a.fatura)===JSON.stringify(bR.fatura);
  console.log(f.slice(-24),a.linhas.length,'/',bR.linhas.length,'igual-ref',same,'reconcilia',rec); ok&&=same&&rec;
  if(!same) a.linhas.forEach((x,i)=>{const y=bR.linhas[i]; if(!y||x.descricao!==y.descricao||x.valor!==y.valor||x.data!==y.data) console.log('  app:',x.data,x.descricao,x.valor,' | ref:',y&&y.data,y&&y.descricao,y&&y.valor)});
  if(P===nu&&!rec) console.log(JSON.stringify(a.fatura),'\n',JSON.stringify(bR.fatura));
}
console.log(ok?'PDFJS OK':'PDFJS FALHOU'); await b.close();
