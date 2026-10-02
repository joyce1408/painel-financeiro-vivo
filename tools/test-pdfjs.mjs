// Testa o caminho real do app: pdf.js → linhas → leitores.
import fs from 'fs';
import { linhasDoPDF } from '../js/pdftext.js';
import * as bb from '../js/parsers/bb.js'; import * as nu from '../js/parsers/nubank.js';
import { sum } from '../js/utils.js';
const U='/root/.claude/uploads/87813fc4-4717-5a0e-9ae0-0fa7b56f9806/';
const ref=JSON.parse(fs.readFileSync('/tmp/claude-0/pdflines.json'));
let ok=true;
for (const f of fs.readdirSync(U).filter(f=>f.endsWith('.pdf')).sort()){
  const ls=await linhasDoPDF(fs.readFileSync(U+f)); const t=ls.join('\n');
  const refL=ref[Object.keys(ref).find(k=>k.endsWith(f))];
  const P=bb.detectar(t)?bb:nu.detectar(t)?nu:null; if(!P){console.log('NÃO DETECTADO',f);ok=false;continue;}
  const a=P.lerPDF(ls), b=P.lerPDF(refL);
  const same=a.linhas.length===b.linhas.length&&a.linhas.every((x,i)=>x.data===b.linhas[i].data&&x.valor===b.linhas[i].valor&&x.descricao===b.linhas[i].descricao&&x.cartao4===b.linhas[i].cartao4);
  let rec; if(P===bb) rec=Math.round((a.saldoInicial+sum(a.linhas))*100)/100===a.saldoFinal; else rec=Math.abs(-sum(a.linhas)-(a.fatura.totalCompras+a.fatura.outrosLancamentos))<0.005 && JSON.stringify(a.fatura)===JSON.stringify(b.fatura);
  console.log(f.slice(-22),a.linhas.length,'igual-ref',same,'reconcilia',rec); ok&&=same&&rec;
  if(!same) a.linhas.forEach((x,i)=>{const y=b.linhas[i]; if(!y||x.descricao!==y.descricao||x.valor!==y.valor||x.data!==y.data) console.log('  app:',x.data,x.descricao,x.valor,' | ref:',y&&y.data,y&&y.descricao,y&&y.valor)});
}
console.log(ok?'PDFJS OK':'PDFJS FALHOU');
