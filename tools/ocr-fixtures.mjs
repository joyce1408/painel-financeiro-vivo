// Gera faturas FICTÍCIAS (estabelecimentos e valores inventados) como imagens, para testar a leitura por foto.
// Nenhum dado real. Saída em /tmp/claude-0/ocr (fora do repositório).
import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'fs';
const OUT = '/tmp/claude-0/ocr/';
export const VERDADE = {
  nu: { tipo: 'fatura', conta: 'Nu', venc: '2026-10-19', total: 512.58, linhas: [
    ['2026-09-13', 'Padaria Exemplo Centro', -23.40], ['2026-09-13', 'Mercado Ficticio Ltda', -187.25], ['2026-09-15', 'Farmacia Modelo', -45.90, '', '1234'],
    ['2026-09-18', 'Loja de Testes', -120.00, 'Parcela 2/5'], ['2026-09-21', 'Posto Imaginario', -150.00], ['2026-09-25', 'Estorno de Loja Teste', 28.90],
    ['2026-10-02', 'Cafe Inventado', -14.93]] },
  app: { tipo: 'fatura', conta: 'Porto', venc: '2026-10-03', total: null, linhas: [
    ['2026-09-10', 'Pet Shop Ficticio', -89.90], ['2026-09-10', 'Restaurante Exemplo', -64.00], ['2026-09-12', 'Assinatura Teste', -19.90], ['2026-09-14', 'Livraria Modelo', -57.35]] },
};
const fmt = v => 'R$ ' + Math.abs(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const MES = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
const dm = d => `${d.slice(8)} ${MES[+d.slice(5,7)-1]}`;
const htmlNu = (de = 0, ate = 99, pag = true) => `<html><body style="font:16px Arial;width:760px;padding:30px;background:#fff;color:#222">
  <div style="color:#820ad1;font-weight:bold;font-size:22px">Nubank</div><div>Fatura de outubro</div><div>Data de vencimento: 19 OUT 2026</div>
  <div style="margin:10px 0">Total a pagar R$ 512,58</div><h3>TRANSAÇÕES DE 13 SET A 12 OUT</h3>
  <table style="width:100%;font-size:16px">${VERDADE.nu.linhas.slice(de, ate).map(([d, s, v, p, c]) => `<tr><td>${dm(d)}</td><td>${c ? '•••• ' + c + ' ' : ''}${s}${p ? ' - ' + p : ''}</td><td style="text-align:right">${v > 0 ? '−' : ''}${fmt(v)}</td></tr>`).join('')}
  ${pag ? '<tr><td>05 OUT</td><td>Pagamento em 05 OUT</td><td style="text-align:right">−R$ 300,00</td></tr>' : ''}</table></body></html>`;
const htmlApp = () => `<html><body style="font:18px -apple-system,Helvetica,Arial;width:390px;padding:16px;background:#111;color:#eee">
  <div style="font-weight:bold">Cartão Porto</div><div style="opacity:.7">Fatura aberta · vence 03/10</div>
  ${[...new Set(VERDADE.app.linhas.map(l => l[0]))].map(d => `<div style="margin-top:14px;opacity:.6">${d.slice(8)}/${d.slice(5,7)}</div>` + VERDADE.app.linhas.filter(l => l[0] === d).map(([, s, v]) => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #333"><span>${s}</span><span>${fmt(v)}</span></div>`).join('')).join('')}
  </body></html>`;
const b = await chromium.launch(); const p = await b.newPage({ deviceScaleFactor: 2 });
for (const [n, h] of [['nu', htmlNu()], ['app', htmlApp()], ['nu-p1', htmlNu(0, 5, false)], ['nu-p2', htmlNu(3, 99, true)]]) { await p.setContent(h); await p.screenshot({ path: OUT + n + '.png', fullPage: true }); }
await b.close();
// "foto" da tela/papel: girada, um pouco borrada, com ruído e em JPEG
await sharp(OUT + 'nu.png').rotate(2.5, { background: '#ddd' }).blur(0.8).modulate({ brightness: 0.9 }).jpeg({ quality: 70 }).toFile(OUT + 'nu-foto.jpg');
// imagem ilegível
await sharp(OUT + 'nu.png').resize(160).blur(3).jpeg({ quality: 30 }).toFile(OUT + 'ilegivel.jpg');
// duas "fotos" da mesma fatura: nu-p1 (linhas 1–5) e nu-p2 (linhas 4–7), com 2 linhas em comum
fs.writeFileSync(OUT + 'verdade.json', JSON.stringify(VERDADE));
console.log(fs.readdirSync(OUT).join(' '));
