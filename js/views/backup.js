// Backup: exportar e restaurar tudo; levar os dados entre o computador e o iPhone.
import { dbr } from '../utils.js';
import { kpis, secao, toast } from '../ui.js';
import { backupJSON, restaurarBackup, apagarTudo } from '../store.js';
import { persistir } from '../db.js';

export const titulo = 'Backup';
let info = null;
async function medir() {
  const o = {};
  try { if (navigator.storage?.estimate) { const e = await navigator.storage.estimate(); o.uso = e.usage; o.cota = e.quota; } } catch {}
  try { o.persistente = navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch {}
  return o;
}
const mb = b => b == null ? '—' : (b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' MB';
export function render({ B }) {
  const ult = B.meta.ultimoBackup;
  return kpis([
    { l: 'Lançamentos', v: String(B.transacoes.length), s: `${B.faturas.length} faturas · ${B.regras.length} regras` },
    { l: 'Último backup', v: ult ? dbr(ult.slice(0, 10)) : 'nunca', s: ult ? 'feito neste aparelho' : 'recomendado após cada importação', c: ult ? 'g' : 'rose' },
    { l: 'Espaço usado', v: info ? mb(info.uso) : '…', s: info && info.cota ? `de ${mb(info.cota)} disponíveis` : '' },
    { l: 'Armazenamento protegido', v: info ? (info.persistente ? 'sim' : 'não') : '…', s: info && !info.persistente ? 'o navegador pode limpar se faltar espaço' : 'o navegador não apaga sozinho' },
  ], 'k4')
  + `<div class="panel"><h2>Exportar <small>um arquivo .json com tudo</small></h2><p class="note">Inclui lançamentos, faturas, categorias, regras, histórico de importações e as impressões digitais. Não inclui os PDFs/CSVs originais. Guarde em lugar seguro (ex.: iCloud Drive ou Google Drive pessoal): o arquivo tem seus dados financeiros.</p><div class="acts"><button class="btn pri" type="button" data-exp>Baixar backup</button></div></div>`
  + `<div class="panel"><h2>Restaurar <small>substitui tudo neste aparelho</small></h2><p class="note">Aceita um backup do painel ou o arquivo de dados validados (<code>painel-dados-validados.json</code>). Use para levar os dados do computador para o iPhone (ou o contrário): exporte num, restaure no outro. Cada aparelho tem a própria base; elas não se sincronizam sozinhas.</p><label class="btn" style="justify-self:start">Escolher arquivo de backup<input type="file" accept=".json,application/json" data-rest hidden></label></div>`
  + secao('zona', 'Recomeçar', 'ações que apagam dados', `<p class="note"><b>Apagar tudo</b> deixa a base deste aparelho vazia. Faça um backup antes. Para voltar ao ponto de partida (jan–ago/2026 validados), restaure o arquivo <code>painel-dados-validados.json</code> acima.</p><div class="acts"><button class="btn danger" type="button" data-zerar>Apagar tudo</button></div>`)
  + secao('priv', 'Privacidade', '', `<p class="note">Tudo fica no banco de dados do navegador (IndexedDB) deste aparelho. A leitura de PDF e CSV acontece aqui, com o pdf.js que vem junto do painel. O painel não faz nenhuma chamada para servidor com seus dados. Se você publicar o painel no GitHub Pages, só o código vai para lá; seus dados não. Para pedir ajuda ao Claude com um banco novo, você escolhe o arquivo e envia na conversa.</p>`);
}
export function ligar(root, ctx) {
  if (!info) medir().then(o => { info = o; ctx.rerender(); });
  root.addEventListener('click', async e => {
    if (e.target.closest('[data-exp]')) {
      const obj = await backupJSON(); const blob = new Blob([JSON.stringify(obj)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `painel-financeiro-backup-${obj.exportadoEm.slice(0, 10)}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      const { gravar } = await import('../db.js'); await gravar([{ store: 'meta', put: { chave: 'ultimoBackup', valor: obj.exportadoEm } }]); ctx.B.meta.ultimoBackup = obj.exportadoEm;
      const p = await persistir(); info = null; toast(p ? 'Backup baixado.' : 'Backup baixado. (O navegador não garantiu proteção contra limpeza automática: guarde o arquivo.)', 5000); ctx.rerender(); return;
    }
    if (e.target.closest('[data-zerar]')) { if (!confirm('Apagar TODOS os dados deste aparelho? Isso não pode ser desfeito.')) return; await apagarTudo(); toast('Base apagada.'); }
  });
  const r = root.querySelector('[data-rest]');
  if (r) r.onchange = async () => {
    const f = r.files[0]; if (!f) return;
    try { const obj = JSON.parse(await f.text()); if (!confirm(`Restaurar ${obj.exportadoEm ? 'o backup de ' + dbr(obj.exportadoEm.slice(0, 10)) : 'os dados validados'}? Os dados atuais deste aparelho serão substituídos.`)) return; await restaurarBackup(obj); toast('Backup restaurado.'); }
    catch (er) { toast(er.message, 6000); }
  };
}
