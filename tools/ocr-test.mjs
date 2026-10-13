// Testa a leitura de fotos com o MESMO motor de OCR (Tesseract 5, aqui pela linha de comando) sobre faturas
// fictícias geradas por tools/ocr-fixtures.mjs. Não testa o carregamento do Tesseract.js no navegador.
import { execFileSync } from 'child_process';
import fs from 'fs';
import { lerTextoFatura, juntarPaginas } from '../js/parsers/texto-fatura.js';
const D='/tmp/claude-0/ocr/'; const V=JSON.parse(fs.readFileSync(D+'verdade.json'));
const out=[]; const ok=(n,c,x='')=>out.push(`${c?'OK  ':'FALHA'} ${n}${x?' — '+x:''}`);
function ocr(img){ // linhas com confiança média, como data.lines do Tesseract.js
  const tsv=execFileSync('tesseract',[D+img,'stdout','--psm','6','-c','preserve_interword_spaces=1','tsv'],{stdio:['ignore','pipe','ignore']}).toString().trim().split('\n').slice(1).map(l=>l.split('\t'));
  const L=new Map(); for(const c of tsv){ if(c[0]!=='5'||!c[11]||!c[11].trim())continue; const k=c.slice(2,5).join('.'); const e=L.get(k)||{w:[],conf:[]}; e.w.push(c[11]); e.conf.push(+c[10]); L.set(k,e);} 
  return [...L.values()].map(e=>({texto:e.w.join(' '),conf:e.conf.reduce((a,b)=>a+b,0)/e.conf.length}));
}
const ref=v=>({ano:+v.venc.slice(0,4),mes:+v.venc.slice(5,7)});
const norm=s=>s.normalize('NFD').replace(/[̀-ͯ]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
function comparar(nome,r,v){
  const certos=[],errados=[];
  for(const [d,s,val,par,c4] of v.linhas){ const l=r.linhas.find(x=>x.data===d&&x.valor===val&&norm(x.descricao).includes(norm(s).slice(0,8)));
    if(l&&(par||'')===(l.parcela||'')&&(c4||'')===(l.cartao4||'')) certos.push(s); else errados.push(`${d} ${s} ${val} → ${l?JSON.stringify([l.parcela,l.cartao4]):'não achado'}`);}
  const extras=r.linhas.filter(l=>!v.linhas.some(([d,s,val])=>l.data===d&&l.valor===val));
  ok(`${nome}: ${certos.length}/${v.linhas.length} lançamentos corretos (data, descrição, valor, parcela, cartão)`,!errados.length,errados.join(' | '));
  ok(`${nome}: nenhum lançamento inventado`,!extras.length,extras.map(e=>e.texto).join(' | '));
  return r;
}
for (const [img,k] of [['nu.png','nu'],['nu-foto.jpg','nu'],['app.png','app']]){
  const r=lerTextoFatura(ocr(img),ref(V[k])); comparar(img,r,V[k]);
  if(k==='nu'){ ok(`${img}: instituição, vencimento e total lidos`,r.instituicao==='Nu'&&r.vencimento&&r.vencimento.d===19&&r.vencimento.m===10&&r.total===V.nu.total,JSON.stringify([r.instituicao,r.vencimento,r.total]));
    ok(`${img}: pagamento da fatura separado (não vira gasto)`,r.pagamentos.length===1&&!r.linhas.some(l=>/Pagamento/i.test(l.descricao)));
    const soma=Math.round(-r.linhas.reduce((a,l)=>a+l.valor,0)*100)/100, esperado=Math.round(-V.nu.linhas.reduce((a,l)=>a+l[2],0)*100)/100;
    ok(`${img}: soma dos lançamentos lidos confere`,soma===esperado,`${soma} vs ${esperado}`); }
  if(k==='app') ok(`${img}: datas vieram do cabeçalho do dia e ficam sinalizadas`,r.linhas.every(l=>l.duvidas.includes('data do cabeçalho do dia')));
}
const il=lerTextoFatura(ocr('ilegivel.jpg'),ref(V.nu)); ok('Imagem ilegível: nenhum lançamento inventado',il.linhas.length===0,JSON.stringify(il.linhas));
const j=juntarPaginas([lerTextoFatura(ocr('nu-p1.png'),ref(V.nu)),lerTextoFatura(ocr('nu-p2.png'),ref(V.nu))]);
comparar('Duas fotos sobrepostas',j,V.nu); ok('Duas fotos: linhas repetidas entre fotos contadas uma vez',j.repetidas>=1,`repetidas ${j.repetidas}`);
// texto colado do Texto ao Vivo (sem confiança), com erros típicos de OCR
const colado=`Nubank\nVencimento 19/10/2026\n13 SET Padaria Exemplo Centro R$ 23,4O\n13/09 Mercado Ficticio Ltda RS 187,25\n31/02 Loja Errada R$ 10,00\nTotal a pagar R$ 512,58`;
const c=lerTextoFatura(colado,ref(V.nu));
ok('Texto colado: corrige letra O em valor (23,4O → 23,40) e "RS"',c.linhas[0].valor===-23.4&&c.linhas[1].valor===-187.25);
ok('Texto colado: data impossível (31/02) sinalizada, sem inventar',c.linhas[2].data===null&&c.linhas[2].duvidas.includes('data inválida'));
console.log(out.join('\n'));
