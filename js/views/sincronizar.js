// Sincronizar: liga dois ou mais aparelhos (ex.: o seu celular e o do seu marido) ao mesmo cofre criptografado.
import { esc, dbr } from '../utils.js';
import { kpis, toast } from '../ui.js';
import { estado, config, conectar, desconectar, sincronizar, nomeAparelho } from '../sync.js';

export const titulo = 'Sincronizar';
let cfgAtual = null, convite = null, ocupado = false;

const hora = iso => iso ? `${dbr(iso.slice(0, 10))} às ${new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '—';
export function lerConvite() {
  const q = location.hash.split('?')[1]; if (!q) return null;
  const p = new URLSearchParams(q); const u = p.get('u'), k = p.get('k');
  return u && k ? { url: u, chavePublica: k } : null;
}

export function render() {
  convite = lerConvite() || convite;
  if (estado.ligado && cfgAtual) {
    const st = estado.sincronizando ? 'sincronizando…' : estado.offline ? 'sem internet: sincroniza quando voltar' : estado.erro ? 'com erro' : 'em dia';
    return kpis([
      { l: 'Sincronização', v: estado.erro ? '<span class="neg">erro</span>' : estado.offline ? 'aguardando' : '<span class="pos">ligada</span>', s: st, c: estado.erro ? 'rose' : 'g' },
      { l: 'Última sincronização', v: estado.ultima ? new Date(estado.ultima).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—', s: estado.ultima ? dbr(estado.ultima.slice(0, 10)) : 'ainda não sincronizou' },
      { l: 'Este aparelho', v: esc(cfgAtual.aparelho), s: 'nome que aparece para os outros' },
      { l: 'Versão do cofre', v: String(estado.versao || cfgAtual.versao || 0), s: estado.porUltimo ? `última gravação: ${esc(estado.porUltimo)}` : '' },
    ], 'k4')
    + (estado.erro ? `<div class="banner" style="border-left-color:var(--neg)"><b>Não foi possível sincronizar.</b> ${esc(estado.erro)}</div>` : '')
    + `<div class="panel"><h2>Como funciona <small>automático</small></h2><p class="note">O painel sincroniza ao abrir, alguns segundos depois de cada alteração, quando você volta para o app e a cada 5 minutos com ele aberto. Sem internet, tudo continua funcionando aqui e sincroniza depois. Se duas pessoas mexerem no mesmo lançamento, vale a alteração feita por último.</p>
      <div class="acts"><button class="btn pri" type="button" data-sync-agora ${estado.sincronizando ? 'disabled' : ''}>Sincronizar agora</button></div></div>`
    + `<div class="panel"><h2>Adicionar outro aparelho</h2><p class="note">Envie o convite abaixo para a outra pessoa (por WhatsApp, por exemplo). Ele leva o endereço do projeto e a chave pública, <b>não leva a senha</b>. Diga a senha pessoalmente ou por outro canal. No outro celular: abrir o convite, digitar a senha e tocar em <b>Entrar</b>.</p>
      <div class="acts"><button class="btn" type="button" data-convite>Copiar convite</button><span class="why" data-convite-ok></span></div></div>`
    + `<div class="panel"><h2>Desligar neste aparelho</h2><p class="note">Os dados continuam neste aparelho e no cofre; só param de sincronizar daqui. Para voltar, entre de novo com a mesma senha.</p><div class="acts"><button class="btn danger" type="button" data-desligar>Desligar sincronização</button></div></div>`;
  }
  const c = convite || cfgAtual || {};
  return `<div class="panel"><h2>Sincronizar entre aparelhos <small>criptografado de ponta a ponta</small></h2>
    <p class="note">Para duas pessoas acompanharem o mesmo painel. Os dados são embaralhados <b>neste aparelho</b> com a senha da família antes de ir para a nuvem (Supabase). A nuvem guarda só um arquivo ilegível; sem a senha ninguém lê, nem o Supabase. A senha não fica salva em lugar nenhum: se ela for esquecida, a cópia da nuvem não pode ser aberta (os dados dos aparelhos continuam).</p>
    ${convite ? '<div class="banner">Convite recebido: endereço e chave já preenchidos. Digite a senha da família e toque em <b>Entrar</b>.</div>' : ''}
    <div class="form" data-sync-form>
      <label class="full">Endereço do projeto (Project URL)<input type="text" name="url" placeholder="https://xxxxxxxx.supabase.co" value="${esc(c.url || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label class="full">Chave pública (anon ou publishable key)<input type="text" name="chave" placeholder="sb_publishable_… ou eyJ…" value="${esc(c.chavePublica || '')}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <label>Senha da família<input type="password" name="senha" autocomplete="new-password" placeholder="mínimo 12 caracteres"></label>
      <label data-so-criar>Repita a senha<input type="password" name="senha2" autocomplete="new-password"></label>
      <label>Nome deste aparelho<input type="text" name="aparelho" placeholder="ex.: Celular do Henrique" value="${esc(nomeAparelho())}"></label>
      <p class="note full">Dica de senha forte e fácil de lembrar: 3 ou 4 palavras soltas, ex.: <i>cafe janela bicicleta azul</i>. Maiúsculas, acentos e espaços contam.</p>
      <div class="full acts">
        <button class="btn pri" type="button" data-sync-criar ${convite ? 'hidden' : ''}>Criar sincronização (primeiro aparelho)</button>
        <button class="btn ${convite ? 'pri' : ''}" type="button" data-sync-entrar>Entrar (já existe em outro aparelho)</button>
        <span class="why" data-erro>${ocupado ? 'Conectando… (leva alguns segundos)' : ''}</span>
      </div>
    </div></div>
    <div class="panel"><h2>Primeira vez? Prepare o Supabase</h2><ol class="note" style="margin:0;padding-left:18px;display:grid;gap:4px">
      <li>Crie uma conta grátis em supabase.com e um projeto novo (região São Paulo, se aparecer).</li>
      <li>No projeto, abra <b>SQL Editor</b>, cole o conteúdo do arquivo <code>supabase.sql</code> (está no repositório do painel) e clique em <b>Run</b>.</li>
      <li>Em <b>Project Settings › API</b> (ou <b>Connect</b>), copie o <b>Project URL</b> e a chave <b>anon/publishable</b> e cole acima.</li>
      <li>Escolha a senha da família e toque em <b>Criar sincronização</b>.</li></ol></div>`;
}

export function ligar(root, ctx) {
  config().then(c => { const mud = JSON.stringify(c) !== JSON.stringify(cfgAtual); cfgAtual = c; if (mud) ctx.rerender(); });
  const f = root.querySelector('[data-sync-form]');
  const err = m => { const e = root.querySelector('[data-erro]'); if (e) e.textContent = m; };
  const ir = async modo => {
    const q = n => f.querySelector(`[name="${n}"]`);
    if (modo === 'criar' && q('senha').value !== q('senha2').value) return err('As duas senhas não são iguais.');
    ocupado = true; err('Conectando… (leva alguns segundos)'); root.querySelectorAll('button').forEach(b => b.disabled = true);
    try {
      const r = await conectar({ url: q('url').value, chavePublica: q('chave').value, senha: q('senha').value, aparelho: q('aparelho').value, modo });
      ocupado = false; convite = null; cfgAtual = await config();
      if (location.hash.includes('?')) history.replaceState(null, '', '#sincronizar');
      toast(modo === 'entrar' || r.existia ? 'Conectado. Dados dos outros aparelhos recebidos.' : 'Sincronização criada. Agora envie o convite para o outro aparelho.', 5000);
      ctx.rerender();
    } catch (e) { ocupado = false; root.querySelectorAll('button').forEach(b => b.disabled = false); err(e.message); }
  };
  if (f) {
    const ent = f.querySelector('[data-sync-entrar]'), cri = f.querySelector('[data-sync-criar]');
    const so = f.querySelector('[data-so-criar]');
    if (convite) so.hidden = true;
    cri.onclick = () => { if (so.hidden) { so.hidden = false; return err('Repita a senha para criar.'); } ir('criar'); };
    ent.onclick = () => ir('entrar');
  }
  root.addEventListener('click', async e => {
    if (e.target.closest('[data-sync-agora]')) { await sincronizar(); toast(estado.erro ? 'Erro: ' + estado.erro : 'Sincronizado.'); ctx.rerender(); return; }
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
