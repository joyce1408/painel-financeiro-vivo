import fs from 'fs';
import * as bb from '../js/parsers/bb.js';
import * as nu from '../js/parsers/nubank.js';
import { sum } from '../js/utils.js';
const U='/root/.claude/uploads/87813fc4-4717-5a0e-9ae0-0fa7b56f9806/';
const L=JSON.parse(fs.readFileSync('/tmp/claude-0/pdflines.json'));
let ok=true;
for (const f of fs.readdirSync(U).filter(f=>f.endsWith('.csv')).sort()){
  const r=bb.lerCSV(fs.readFileSync(U+f,'utf8'));const c=Math.round((r.saldoInicial+sum(r.linhas))*100)/100;
  console.log('CSV',f.slice(-10),r.linhas.length,r.saldoInicial,'->',r.saldoFinal,c===r.saldoFinal?'OK':'DIFF '+c); ok&&=c===r.saldoFinal;
}
for (const [p,lines] of Object.entries(L)){
  const t=lines.join('\n');
  if (bb.detectar(t)){const r=bb.lerPDF(lines);const c=Math.round((r.saldoInicial+sum(r.linhas))*100)/100;console.log('PDF BB',p.slice(-11),r.linhas.length,r.saldoInicial,'->',r.saldoFinal,c===r.saldoFinal?'OK':'DIFF '+c,r.periodoInicio,r.periodoFim);ok&&=c===r.saldoFinal;}
  else if (nu.detectar(t)){const r=nu.lerPDF(lines);const f=r.fatura;const s=-sum(r.linhas);const exp=Math.round((f.totalCompras+f.outrosLancamentos)*100)/100;
    console.log('PDF NU',f.id,r.linhas.length,'pag',f.pagamentos.length,'compras+outros',exp,'soma',s,Math.abs(s-exp)<0.005?'OK':'DIFF',f.periodoInicio,f.fechamento,f.vencimento,f.totalAPagar,f.faturaAnterior,f.pagamentoRecebido);ok&&=Math.abs(s-exp)<0.005;}
  else {console.log('NÃO DETECTADO',p);ok=false}
}
// CSV x PDF de junho iguais?
const j=L[Object.keys(L).find(k=>k.includes('062026'))];const a=bb.lerPDF(j).linhas, b=bb.lerCSV(fs.readFileSync(U+fs.readdirSync(U).find(f=>f.includes('062026.csv')),'utf8')).linhas;
const same=a.length===b.length&&a.every((x,i)=>x.data===b[i].data&&x.valor===b[i].valor&&x.descricao===b[i].descricao);
console.log('jun PDF==CSV',same); if(!same) a.forEach((x,i)=>{if(x.descricao!==b[i]?.descricao||x.data!==b[i]?.data)console.log(x,b[i])});
console.log(ok&&same?'TUDO OK':'FALHOU');
