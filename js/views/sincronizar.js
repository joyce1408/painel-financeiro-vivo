// Sincronizar: liga dois ou mais aparelhos (ex.: o seu celular e o do seu marido) ao mesmo cofre criptografado.
import { esc, dbr } from '../utils.js';
import { kpis, toast, secao, vazio } from '../ui.js';
import { estado, config, conectar, desconectar, sincronizar, nomeAparelho, checarChavePublica } from '../sync.js';
import { todos, gravar } from '../db.js';
import { carregar } from '../store.js';

export const titulo = 'Sincronizar';
let cfgAtual = null, convite = null, ocupado = false, conflitos = [], copias = [];

const hora = iso => iso ? `${dbr(iso.slice(0, 10))} às ${new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '—';
export function lerConvite() {
  const q = location.hash.split('?')[1]; if (!q) return null;
  const p = new URLSearchParams(q); const u = p.get('u'), k = p.get('k');
  return u && k && !checarChavePublica(k) ? { url: u, chavePublica: k } : null;
}
const TIPO = { edicao: 'mudou nos dois aparelhos', exclusao: 'apagado num aparelho e alterado no outro antes de saber da exclusão' };

function painelConflitos() {
  const abertos = conflitos.filter(c => !c.resolvido), fechados = conflitos.filter(c => c.resolvido);
  const linha = c => `<tr><td class="num">${hora(c.em)}</td><td>${esc(c.rotulo)}<div class="note">${TIPO[c.tipo] || c.tipo}</div></td><td>${esc(c.venceu)}</td><td>${c.descartado ? `<button class="btn sm ghost" type="button" data-restaurar-conflito="${c.id}">Usar a versão descartada</button>` : ''} ${c.resolvido ? '<span class="tag">resolvido</span>' : `<button class="btn sm ghost" type="button" data-ok-conflito="${c.id}">Está certo</button>`}</td></tr>`;
  return secao('conf', 'Conflitos registrados', abertos.length ? `${abertos.length} para conferir` : 'nenhum em aberto',
    `<p class="note">Conflito é quando o mesmo registro mudou nos dois aparelhos antes de sincronizar. O painel escolhe a alteração mais recente (ou a exclusão) e guarda a outra versão aqui, para você decidir.</p>`
    + (conflitos.length ? `<div class="tbl"><table><tr><th>Quando</th><th>Registro</th><th>Ficou valendo</th><th></th></tr>${[...abertos, ...fechados].slice(0, 60).map(linha).join('')}</table></div>` : vazio('Nenhum conflito até agora.')), abertos.length > 0);
}
function painelCopias() {
  return secao('copias', 'Cópias automáticas de segurança', `${copias.length} guardada(s) neste aparelho`,
    `<p class="note">O painel guarda uma cópia completa antes da primeira sincronização e antes de qualquer sincronização que remova registros daqui. Ficam só neste aparelho (as 8 mais recentes) e não vão para a nuvem.</p>`
    + (copias.length ? `<div class="tbl"><table><tr><th>Quando</th><th>Motivo</th><th class="r">Lançamentos</th><th></th></tr>${copias.map(c => `<tr><td class="num">${hora(c.em)}</td><td>${esc(c.motivo)}</td><td class="r num">${c.n}</td><td><button class="btn sm ghost" type="button" data-baixar-copia="${c.id}">Baixar</button></td></tr>`).join('')}</table></div><p class="note">Para voltar a uma cópia: baixe e use Backup › Restaurar.</p>` : vazio('Nenhuma cópia ainda.')));
}

export function render() {
  convite = lerConvite() || convite;
  if (estado.ligado && cfgAtual) {
    const st = estado.sincronizando ? 'sincronizando…' : estado.bloqueio ? 'pausada: precisa da sua confirmação' : estado.offline ? 'sem internet: sincroniza quando voltar' : estado.erro ? 'com erro' : 'em dia';
    return kpis([
      { l: 'Estado', v: estado.erro || estado.bloqueio ? '<span class="neg">pausada</span>' : estado.offline ? 'aguardando' : estado.sincronizando ? 'sincronizando' : '<span class="pos">ligada</span>', s: st, c: estado.erro ? 'rose' : 'g' },
      { l: 'Última sincronização', v: estado.ultima ? new Date(estado.ultima).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—', s: estado.ultima ? dbr(estado.ultima.slice(0, 10)) : 'ainda não sincronizou' },
      { l: 'Alterações pendentes', v: String(estado.pendentes || 0), s: estado.pendentes ? 'feitas aqui, ainda não enviadas' : 'tudo enviado' },
      { l: 'Conflitos em aberto', v: String(conflitos.filter(c => !c.resolvido).length), s: `versão do cofre ${estado.versao || cfgAtual.versao || 0} · ${esc(cfgAtual.aparelho)}` },
    ], 'k4')
    + (estado.bloqueio ? `<div class="banner" style="border-left-color:var(--neg)"><b>A sincronização quer apagar ${estado.bloqueio.n} registro(s) deste aparelho${estado.bloqueio.tx ? ` (${estado.bloqueio.tx} lançamentos)` : ''}.</b> Isso acontece quando eles foram excluídos no outro aparelho. Nada foi apagado ainda.${estado.bloqueio.exemplos.length ? `<div class="note">Ex.: ${estado.bloqueio.exemplos.map(esc).join(' · ')}</div>` : ''}<div class="acts" style="margin-top:8px"><button class="btn danger sm" type="button" data-permitir>Está certo, aplicar (uma cópia é guardada antes)</button></div></div>`
      : estado.erro ? `<div class="banner" style="border-left-color:var(--neg)"><b>Não foi possível sincronizar.</b> ${esc(estado.erro)}</div>` : '')
    + `<div class="panel"><h2>Como funciona <small>automático</small></h2><p class="note">Sincroniza ao abrir, alguns segundos depois de cada alteração, quando você volta para o app e a cada 5 minutos com ele aberto. Sem internet, tudo continua funcionando aqui e sincroniza depois. Se o mesmo registro mudar nos dois aparelhos, vale a alteração mais recente e a outra fica registrada em Conflitos.</p>
      <div class="acts"><button class="btn pri" type="button" data-sync-agora ${estado.sincronizando ? 'disabled' : ''}>Sincronizar agora</button></div></div>`
    + painelConflitos() + painelCopias()
    + `<div class="panel"><h2>Adicionar outro aparelho</h2><p class="note">O convite leva o endereço do projeto e a chave pública, <b>não leva a senha</b>. Diga a senha pessoalmente ou por outro canal. No outro celular: abrir o convite, digitar a senha duas vezes e tocar em <b>Entrar</b>.</p>
      <div class="acts"><button class="btn" type="button" data-convite>Copiar convite</button><span class="why" data-convite-ok></span></div></div>`
    + secao('seg', 'Como seus dados são protegidos', '', `<ul class="note" style="margin:0;padding-left:18px;display:grid;gap:3px">
      <li>Os dados são cifrados <b>neste aparelho</b> (AES-256-GCM, padrão do navegador) antes de sair. Cada envio usa um código aleatório novo (IV).</li>
      <li>A senha não é guardada nem enviada. Dela saem, aqui, a chave (que fica só neste aparelho e não pode ser copiada pelo app) e o número do cofre (o único dado que o servidor conhece).</li>
      <li>A nuvem guarda só: número do cofre, versão, data e o bloco cifrado. Nenhum valor, descrição ou nome em texto puro.</li>
      <li>Se a nuvem devolver um cofre adulterado ou mais antigo do que o último visto aqui, a sincronização para.</li>
      <li>Exclusões ficam registradas para sempre: um aparelho atrasado não faz um lançamento apagado voltar.</li></ul>`)
    + `<div class="panel"><h2>Desligar neste aparelho</h2><p class="note">Os dados continuam neste aparelho e no cofre; só param de sincronizar daqui. Para voltar, entre de novo com a mesma senha.</p><div class="acts"><button class="btn danger" type="button" data-desligar>Desligar sincronização</button></div></div>`;
  }
  const c = convite || cfgAtual || {};
  return (estado.erro ? `<div class="banner" style="border-left-color:var(--neg)">${esc(estado.erro)}</div>` : '')
    + `<div class="panel"><h2>Sincronizar entre aparelhos <small>criptografado de ponta a ponta</small></h2>
    <p class="note">Para duas pessoas acompanharem o mesmo painel. Os dados são embaralhados <b>neste aparelho</b> com a senha da família antes de ir para a nuvem (Supabase). A nuvem guarda só um bloco ilegível; sem a senha ninguém lê, nem o Supabase. A senha não fica salva em lugar nenhum: se ela for esquecida, a cópia da nuvem não pode ser aberta (os dados dos aparelhos continuam). Antes da primeira sincronização, o painel guarda uma cópia de segurança completa deste aparelho.</p>
    ${convite ? '<div class="banner">Convite recebido: endereço e chave já preenchidos. Digite a senha da família duas vezes e toque em <b>Entrar</b>.</div>' : ''}
    <div class="form" data-sync-form>
      <label class="full">Endereço do projeto (Project URL)<input type="text" name="url" placeholder="https://xxxxxxxx.supabase.co" value="${esc(c.url || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="full">Chave pública (publishable ou anon)<input type="text" name="chave" placeholder="sb_publishable_…" value="${esc(c.chavePublica || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"><span class="why" data-aviso-chave></span></label>
      <label>Senha da família<input type="password" name="senha" autocomplete="new-password" placeholder="mínimo 12 caracteres"></label>
      <label>Confirme a senha<input type="password" name="senha2" autocomplete="new-password"></label>
      <label>Nome deste aparelho<input type="text" name="aparelho" placeholder="ex.: Celular do Henrique" value="${esc(nomeAparelho())}"><span class="why">fica só dentro do cofre cifrado</span></label>
      <p class="note full">Senha forte e fácil de lembrar: 3 ou 4 palavras soltas, ex.: <i>cafe janela bicicleta azul</i>. Maiúsculas, acentos e espaços contam. <b>Nunca</b> cole aqui a chave secreta (service_role / sb_secret): o app recusa.</p>
      <div class="full acts">
        <button class="btn ${convite ? '' : 'pri'}" type="button" data-sync-criar ${convite ? 'hidden' : ''}>Criar sincronização (primeiro aparelho)</button>
        <button class="btn ${convite ? 'pri' : ''}" type="button" data-sync-entrar>Entrar (já existe em outro aparelho)</button>
        <span class="why" data-erro>${ocupado ? 'Conectando… (leva alguns segundos)' : ''}</span>
      </div>
    </div></div>
    <div class="panel"><h2>Primeira vez? Prepare o Supabase</h2><ol class="note" style="margin:0;padding-left:18px;display:grid;gap:4px">
      <li>Crie uma conta grátis em supabase.com e um projeto novo, só para o painel.</li>
      <li>No projeto, abra <b>SQL Editor</b>, cole o conteúdo do arquivo <code>supabase.sql</code> (está no repositório do painel) e clique em <b>Run</b>.</li>
      <li>Em <b>Project Settings › API Keys</b> (ou no botão <b>Connect</b>), copie o <b>Project URL</b> e a chave <b>publishable</b> (ou <b>anon</b>). Não use a secret/service_role.</li>
      <li>Escolha a senha da família e toque em <b>Criar sincronização</b>.</li></ol></div>`
    + (copias.length ? painelCopias() : '');
}

async function carregarListas(ctx) {
  const [cfg, cf, cp] = await Promise.all([config(), todos('conflitos'), todos('copias')]);
  const novo = JSON.stringify([cfg && cfg.versao, cfg && cfg.aparelho, cf.length, cf.filter(c => c.resolvido).length, cp.length]);
  const velho = JSON.stringify([cfgAtual && cfgAtual.versao, cfgAtual && cfgAtual.aparelho, conflitos.length, conflitos.filter(c => c.resolvido).length, copias.length]);
  cfgAtual = cfg; conflitos = cf.sort((a, b) => b.em.localeCompare(a.em)); copias = cp.sort((a, b) => b.em.localeCompare(a.em)).map(({ dados, ...c }) => c);
  if (novo !== velho && !document.querySelector('[data-sync-form] input:focus')) ctx.rerender();
}

export function ligar(root, ctx) {
  carregarListas(ctx);
  const f = root.querySelector('[data-sync-form]');
  const err = m => { const e = root.querySelector('[data-erro]'); if (e) e.textContent = m; };
  const ir = async modo => {
    const q = n => f.querySelector(`[name="${n}"]`);
    ocupado = true; err('Conectando… (leva alguns segundos)'); root.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const r = await conectar({ url: q('url').value, chavePublica: q('chave').value, senha: q('senha').value, senha2: q('senha2').value, aparelho: q('aparelho').value, modo });
      ocupado = false; convite = null; cfgAtual = await config();
      if (location.hash.includes('?')) history.replaceState(null, '', '#sincronizar');
      toast((r.existia ? 'Conectado. Dados dos outros aparelhos recebidos.' : 'Sincronização criada. Agora envie o convite para o outro aparelho.') + ' Uma cópia de segurança foi guardada antes.', 6000);
      await carregarListas(ctx); ctx.rerender();
    } catch (e) { ocupado = false; root.querySelectorAll('button').forEach(b => b.disabled = false); err(e.message); }
  };
  if (f) {
    f.querySelector('[data-sync-criar]').onclick = () => ir('criar');
    f.querySelector('[data-sync-entrar]').onclick = () => ir('entrar');
    const k = f.querySelector('[name="chave"]'), av = f.querySelector('[data-aviso-chave]');
    k.addEventListener('input', () => { av.textContent = k.value.trim() ? (checarChavePublica(k.value) || '') : ''; av.style.color = 'var(--neg)'; });
  }
  root.addEventListener('click', async e => {
    if (e.target.closest('[data-sync-agora]')) { await sincronizar(); toast(estado.erro ? 'Erro: ' + estado.erro : 'Sincronizado.'); await carregarListas(ctx); ctx.rerender(); return; }
    if (e.target.closest('[data-permitir]')) { if (!confirm(`Aplicar a remoção de ${estado.bloqueio.n} registro(s) neste aparelho? Uma cópia de segurança é guardada antes.`)) return; await sincronizar({ permitirExclusoes: true }); toast(estado.erro ? 'Erro: ' + estado.erro : 'Sincronizado.'); await carregarListas(ctx); ctx.rerender(); return; }
    const okc = e.target.closest('[data-ok-conflito]'); if (okc) { const c = conflitos.find(x => x.id === okc.dataset.okConflito); await gravar([{ store: 'conflitos', put: { ...c, resolvido: true, resolvidoEm: new Date().toISOString() } }]); await carregarListas(ctx); ctx.rerender(); return; }
    const rc = e.target.closest('[data-restaurar-conflito]');
    if (rc) {
      const c = conflitos.find(x => x.id === rc.dataset.restaurarConflito);
      if (!confirm(`Voltar para a versão descartada de: ${c.rotulo}? Ela passa a valer nos dois aparelhos.`)) return;
      const { _mod, ...reg } = c.descartado;
      await gravar([{ store: c.store, put: reg }, { store: 'lixeira', del: c.store + '|' + c.chave }, { store: 'conflitos', put: { ...c, resolvido: true, resolvidoEm: new Date().toISOString(), restaurado: true } }]);
      await carregar(); toast('Versão restaurada. Ela vai para o outro aparelho na próxima sincronização.'); await carregarListas(ctx); ctx.rerender(); return;
    }
    const bc = e.target.closest('[data-baixar-copia]');
    if (bc) {
      const c = (await todos('copias')).find(x => x.id === bc.dataset.baixarCopia);
      const obj = { app: 'painel-financeiro-vivo', versao: 1, exportadoEm: c.em, origem: 'copia-automatica', dados: c.dados };
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj)], { type: 'application/json' })); a.download = `painel-copia-${c.em.slice(0, 16).replace(/[:T]/g, '-')}.json`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      return;
    }
    if (e.target.closest('[data-convite]')) {
      const link = `${location.origin}${location.pathname}#sincronizar?u=${encodeURIComponent(cfgAtual.url)}&k=${encodeURIComponent(cfgAtual.chavePublica)}`;
      const txt = `Painel Financeiro Vivo: abra este link no Safari, digite a senha da família e toque em Entrar.\n${link}`;
      try { await navigator.clipboard.writeText(txt); root.querySelector('[data-convite-ok]').textContent = 'Convite copiado. Cole no WhatsApp.'; }
      catch { root.querySelector('[data-convite-ok]').innerHTML = `Copie: <code style="word-break:break-all">${esc(link)}</code>`; }
      return;
    }
    if (e.target.closest('[data-desligar]')) { if (!confirm('Desligar a sincronização neste aparelho?')) return; await desconectar(); cfgAtual = null; toast('Sincronização desligada neste aparelho.'); ctx.rerender(); }
  });
}
export { hora };
