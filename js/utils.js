// Utilidades comuns: dinheiro, datas, texto. Sem dependências.
export const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
export const MES_CURTO = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
export const MES_ABREV = {JAN:1,FEV:2,MAR:3,ABR:4,MAI:5,JUN:6,JUL:7,AGO:8,SET:9,OUT:10,NOV:11,DEZ:12};

export const cents = x => Math.round(Number(x) * 100);
export const sum = (xs, f = r => r.valor) => xs.reduce((a, r) => a + cents(f(r)), 0) / 100;
export const brl = v => (v < 0 ? '−' : '') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const brl0 = v => (v < 0 ? '−' : '') + 'R$ ' + Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
export const pct = v => isFinite(v) ? v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—';
export const parseBRL = s => { const m = String(s).replace(/\s/g, '').match(/([−-])?(?:R\$)?([\d.]+,\d{2})/); if (!m) return NaN; const v = Number(m[2].replace(/\./g, '').replace(',', '.')); return m[1] ? -v : v; };

export const dbr = d => d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '—';
export const mLabel = m => m ? MESES[+m.slice(5, 7) - 1] + '/' + m.slice(0, 4) : '';
export const mCurto = m => MES_CURTO[+m.slice(5, 7) - 1];
export const mesNome = m => MESES[+m.slice(5, 7) - 1].toLowerCase();
export const addMes = (ym, n) => { let [y, m] = ym.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return y + '-' + String(m).padStart(2, '0'); };
export const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Chave de estabelecimento: usada para o histórico de classificação ("o mesmo lugar recebe a mesma categoria").
const STOP = new Set(['DO', 'DA', 'DE', 'DOS', 'DAS', 'E', 'CO', 'LTDA', 'SA', 'S', 'A', 'ME', 'EIRELI', 'MP', 'IFD', 'PAYGO', 'EBW', 'BRS', 'JIM', 'COM', 'LOJA', 'LJ']);
export function chaveEstab(desc) {
  let s = String(desc || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  s = s.replace(/^\d{2}\/\d{2}\s+\d{2}:\d{2}\s+/, '').replace(/-?\s*PARCELA\s*\d+\s*\/\s*\d+/g, ' ').replace(/NUPAY/g, ' ');
  s = s.replace(/[^A-Z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const w = s.split(' ').filter(x => x.length > 1 && !STOP.has(x));
  return w.slice(0, 2).join(' ');
}

export async function sha256(buf) {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export const uid = (p = 'id') => p + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
