// Tela de senha: criar a senha (primeiro acesso), abrir, recuperar com o código e bloqueio automático.
// Enquanto o painel está bloqueado, as chaves não estão na memória, nenhum dado é lido e a tela não mostra nada.
import { esc } from './utils.js';
import { destravado, esquecerChaves, lerBaseAntiga, apagarBaseAntiga, apagarBaseProtegida, gravar, todos, limparTudo, copiaDeSeguranca, STORES } from './db.js';
import { protecaoExiste, criarProtecao, abrirComSenha, recuperarComCodigo, validarNovaSenha, aguardarMs, autoBloqueioMin, SENHA_MIN } from './protecao.js';

const $ = id => document.getElementById(id);
let cb = { aoDestravar: async () => {}, aoTravar: () => {} };
let autoMin = 1, ocultoEm = null, ultimoToque = Date.now(), pausaAte = 0, timerEspera = null;

const tela = html => { const t = $('trava'); t.innerHTML = `<div class="trava-caixa"><div class="trava-logo">🔒</div><div class="ey">Painel financeiro vivo</div>${html}</div>`; t.hidden = false; const i = t.querySelector('input'); if (i) setTimeout(() => i.focus(), 50); return t; };
const msg = (t, m, erro = true) => { const e = t.querySelector('[data-msg]'); if (e) { e.textContent = m; e.className = 'trava-msg' + (erro ? ' erro' : ''); } };
const ocupado = (t, sim, txt) => { t.querySelectorAll('button,input').forEach(b => b.disabled = sim); if (sim && txt) msg(t, txt, false); };
const fmtEspera = ms => ms >= 60000 ? `${Math.ceil(ms / 60000)} min` : `${Math.ceil(ms / 1000)} s`;

// ---------- início ----------
export async function iniciarTrava(callbacks) {
  cb = { ...cb, ...callbacks };
  document.body.classList.add('travado');
  ligarAutoBloqueio();
  if (await protecaoExiste()) return telaAbrir();
  const antiga = await lerBaseAntiga();
  telaCriar(antiga);
}

// ---------- primeiro acesso ----------
function telaCriar(antiga) {
  const nAnt = antiga && antiga.transacoes ? antiga.transacoes.length : 0;
  const t = tela(`<h1>Crie a senha de abertura</h1>
    <p>Ela protege os dados deste aparelho: sem ela, o painel não abre e o que está guardado aqui fica ilegível (criptografado).</p>
    ${nAnt ? `<p class="trava-info">Encontramos <b>${nAnt} lançamentos</b> guardados neste aparelho sem proteção. Eles serão protegidos e conferidos um a um; nada é apagado antes da conferência.</p>` : ''}
    <ul class="trava-lista"><li>É diferente da senha da família (sincronização). Use outra.</li><li>Mínimo de ${SENHA_MIN} caracteres. Pode ser uma frase curta.</li><li>A senha não é guardada em lugar nenhum. Em seguida você recebe um <b>código de recuperação</b> para o caso de esquecê-la.</li></ul>
    <label>Senha de abertura<input type="password" name="s1" autocomplete="new-password"></label>
    <label>Confirme a senha<input type="password" name="s2" autocomplete="new-password"></label>
    <button class="btn pri" type="button" data-ok>Criar senha</button><p data-msg class="trava-msg"></p>`);
  const ir = async () => {
    const s1 = t.querySelector('[name=s1]').value, s2 = t.querySelector('[name=s2]').value;
    const e = validarNovaSenha(s1, s2); if (e) return msg(t, e);
    ocupado(t, true, 'Criando as chaves… (alguns segundos)');
    try { const codigo = await criarProtecao(s1); telaCodigo(codigo, antiga); }
    catch (er) { ocupado(t, false); msg(t, 'Não foi possível criar a proteção: ' + er.message); }
  };
  t.querySelector('[data-ok]').onclick = ir; t.querySelector('[name=s2]').onkeydown = e => { if (e.key === 'Enter') ir(); };
}
function telaCodigo(codigo, antiga, depois) {
  const t = tela(`<h1>Seu código de recuperação</h1>
    <p>Se você esquecer a senha, só este código abre os dados deste aparelho. Ele aparece <b>só agora</b>.</p>
    <div class="trava-codigo" data-codigo>${esc(codigo)}</div>
    <p class="trava-info">Anote no papel ou guarde no app de senhas do iPhone. Não guarde junto com o celular desbloqueado nem mande por mensagem.</p>
    <label class="ck"><input type="checkbox" name="anotei"> Anotei o código em lugar seguro</label>
    <label>Para confirmar, digite os 4 últimos caracteres<input type="text" name="fim" maxlength="4" autocapitalize="characters" autocomplete="off"></label>
    <button class="btn pri" type="button" data-ok>Continuar</button><p data-msg class="trava-msg"></p>`);
  t.querySelector('[data-ok]').onclick = async () => {
    if (!t.querySelector('[name=anotei]').checked) return msg(t, 'Marque que anotou o código.');
    if (t.querySelector('[name=fim]').value.trim().toUpperCase() !== codigo.replace(/-/g, '').slice(-4)) return msg(t, 'Os 4 últimos caracteres não conferem. Olhe o código de novo.');
    if (depois) return depois();
    if (antiga) return telaMigrar(antiga);
    await destravar();
  };
}

// ---------- migração da base antiga (sem proteção) ----------
const assinatura = xs => xs.map(r => JSON.stringify(r)).sort().join('\n');
function prepararAntiga(antiga) {
  const out = {};
  for (const s of Object.keys(STORES)) out[s] = (antiga[s] || []).map(r => {
    if (s === 'meta' && r.chave === 'sync') { const v = r.valor || {}; return { chave: 'sync-pendente', valor: { url: v.url, chavePublica: v.chavePublica, aparelho: v.aparelho } }; } // a chave antiga não pode ser copiada: pede a senha da família de novo
    return r;
  });
  return out;
}
export async function migrarBaseAntiga(antiga) {
  const dados = prepararAntiga(antiga);
  await limparTudo(); await gravar([...(await todos('copias')).map(c => ({ store: 'copias', del: c.id })), ...(await todos('conflitos')).map(c => ({ store: 'conflitos', del: c.id }))]);
  const ops = []; for (const s of Object.keys(STORES)) for (const r of dados[s]) ops.push({ store: s, put: r });
  for (let i = 0; i < ops.length; i += 500) await gravar(ops.slice(i, i + 500), { carimbar: false });
  const conf = {};
  for (const s of Object.keys(STORES)) {
    const lidos = await todos(s);
    conf[s] = { antes: dados[s].length, depois: lidos.length, ok: assinatura(lidos) === assinatura(dados[s]) };
    if (!conf[s].ok) throw Object.assign(new Error(`A conferência da loja "${s}" não bateu (${dados[s].length} → ${lidos.length}). A base antiga não foi apagada.`), { conf });
  }
  return conf;
}
function telaMigrar(antiga) {
  const t = tela(`<h1>Protegendo seus dados</h1><p data-msg class="trava-msg">Cifrando e conferindo cada registro…</p>`);
  (async () => {
    try {
      const conf = await migrarBaseAntiga(antiga);
      await copiaDeSeguranca('ao ativar a senha de abertura');
      await apagarBaseAntiga();
      const tx = conf.transacoes;
      const t2 = tela(`<h1>Pronto</h1><p><b>${tx.depois} lançamentos</b>, ${conf.faturas.depois} faturas e ${conf.regras.depois} regras foram cifrados e conferidos um a um. A cópia antiga sem proteção foi removida deste aparelho.</p>
        ${antiga.meta && antiga.meta.some(m => m.chave === 'sync') ? '<p class="trava-info">A sincronização precisa da senha da família uma vez: abra a aba <b>Sincronizar</b> e toque em <b>Entrar</b>.</p>' : ''}
        <button class="btn pri" type="button" data-ok>Abrir o painel</button>`);
      t2.querySelector('[data-ok]').onclick = () => destravar();
    } catch (er) {
      console.error(er);
      const t3 = tela(`<h1>A proteção não foi concluída</h1><p>${esc(er.message)}</p><p class="trava-info">Seus dados continuam na base antiga, sem alteração. Tente de novo; se repetir, me envie um print desta tela.</p><button class="btn pri" type="button" data-ok>Tentar de novo</button>`);
      t3.querySelector('[data-ok]').onclick = () => telaMigrar(antiga);
    }
  })();
}

// ---------- abrir ----------
async function telaAbrir(motivo) {
  const t = tela(`<h1>Painel bloqueado</h1><p>${motivo ? esc(motivo) + ' ' : ''}Digite a senha de abertura.</p>
    <label>Senha<input type="password" name="s" autocomplete="current-password"></label>
    <button class="btn pri" type="button" data-ok>Abrir</button><p data-msg class="trava-msg"></p>
    <button class="trava-link" type="button" data-esqueci>Esqueci a senha</button>`);
  const atualizarEspera = async () => {
    clearTimeout(timerEspera); const ms = await aguardarMs();
    if (ms > 0) { ocupado(t, true); t.querySelector('[data-esqueci]').disabled = false; msg(t, `Muitas tentativas erradas. Aguarde ${fmtEspera(ms)} para tentar de novo. Nenhum dado foi apagado.`); timerEspera = setTimeout(atualizarEspera, Math.min(ms, 1000)); }
    else if (t.querySelector('[name=s]').disabled) { ocupado(t, false); msg(t, ''); }
  };
  const ir = async () => {
    const s = t.querySelector('[name=s]').value; if (!s) return msg(t, 'Digite a senha.');
    ocupado(t, true, 'Abrindo…');
    const r = await abrirComSenha(s);
    if (r.ok) return destravar();
    ocupado(t, false); t.querySelector('[name=s]').value = '';
    if (r.esperaMs > 0) return atualizarEspera();
    msg(t, `Senha incorreta.${r.falhas >= 3 ? ` Depois de 5 erros seguidos, é preciso esperar um pouco entre as tentativas (os dados não são apagados).` : ''}`);
    t.querySelector('[name=s]').focus();
  };
  t.querySelector('[data-ok]').onclick = ir; t.querySelector('[name=s]').onkeydown = e => { if (e.key === 'Enter') ir(); };
  t.querySelector('[data-esqueci]').onclick = () => telaRecuperar();
  atualizarEspera();
}

// ---------- esqueci a senha ----------
function telaRecuperar() {
  const t = tela(`<h1>Esqueci a senha</h1><p>Digite o código de recuperação (20 caracteres) e escolha uma senha nova. Os dados continuam os mesmos.</p>
    <label>Código de recuperação<input type="text" name="c" autocapitalize="characters" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"></label>
    <label>Nova senha<input type="password" name="s1" autocomplete="new-password"></label>
    <label>Confirme a nova senha<input type="password" name="s2" autocomplete="new-password"></label>
    <button class="btn pri" type="button" data-ok>Definir nova senha</button><p data-msg class="trava-msg"></p>
    <button class="trava-link" type="button" data-volta>Voltar</button> <button class="trava-link" type="button" data-sem>Não tenho o código</button>`);
  t.querySelector('[data-ok]').onclick = async () => {
    const e = validarNovaSenha(t.querySelector('[name=s1]').value, t.querySelector('[name=s2]').value); if (e) return msg(t, e);
    ocupado(t, true, 'Conferindo o código…');
    const r = await recuperarComCodigo(t.querySelector('[name=c]').value, t.querySelector('[name=s1]').value);
    ocupado(t, false);
    if (r.ok) return destravar('Senha nova definida.');
    msg(t, r.esperaMs > 0 && r.falhas >= 5 ? `Código incorreto. Aguarde ${fmtEspera(r.esperaMs)} para tentar de novo.` : 'Código incorreto. Confira letra por letra (traços e espaços não importam).');
  };
  t.querySelector('[data-volta]').onclick = () => telaAbrir();
  t.querySelector('[data-sem]').onclick = () => telaSemCodigo();
}
function telaSemCodigo() {
  const t = tela(`<h1>Sem a senha e sem o código</h1>
    <p>Os dados deste aparelho estão cifrados e <b>ninguém consegue abri-los</b> sem a senha ou o código, nem eu. Mas eles não estão perdidos se existirem em outro lugar:</p>
    <ul class="trava-lista"><li><b>Sincronização:</b> se este aparelho sincronizava, tudo está no cofre da nuvem. Depois de recomeçar aqui, entre em <b>Sincronizar › Entrar</b> com a senha da família.</li><li><b>Backup:</b> um arquivo de backup pode ser restaurado em <b>Backup › Restaurar</b>.</li><li><b>Outro celular:</b> se o outro aparelho está em dia, ele continua com os dados.</li></ul>
    <p>Recomeçar apaga os dados cifrados <b>deste aparelho</b> (o cofre da nuvem e os outros aparelhos não são tocados). Só faça se tiver uma dessas opções.</p>
    <label>Para confirmar, digite APAGAR<input type="text" name="c" autocapitalize="characters" autocomplete="off"></label>
    <button class="btn danger" type="button" data-ok>Apagar os dados deste aparelho e recomeçar</button><p data-msg class="trava-msg"></p>
    <button class="trava-link" type="button" data-volta>Voltar</button>`);
  t.querySelector('[data-ok]').onclick = async () => {
    if (t.querySelector('[name=c]').value.trim().toUpperCase() !== 'APAGAR') return msg(t, 'Digite APAGAR para confirmar.');
    if (!confirm('Apagar os dados cifrados deste aparelho? Isso não pode ser desfeito.')) return;
    await apagarBaseProtegida(); location.reload();
  };
  t.querySelector('[data-volta]').onclick = () => telaRecuperar();
}

// ---------- abrir / bloquear ----------
async function destravar(aviso) {
  autoMin = await autoBloqueioMin();
  ultimoToque = Date.now(); ocultoEm = null;
  $('trava').hidden = true; $('trava').innerHTML = '';
  document.body.classList.remove('travado', 'cortina');
  await cb.aoDestravar(aviso);
}
export function travar(motivo) {
  if (!destravado()) return;
  esquecerChaves();
  document.body.classList.add('travado');
  try { cb.aoTravar(); } catch (e) { console.error(e); }
  telaAbrir(motivo);
}
export const atualizarAutoBloqueio = min => { autoMin = min; };
export const pausarAutoBloqueio = (min = 10) => { pausaAte = Date.now() + min * 60000; };
export const retomarAutoBloqueio = () => { pausaAte = 0; ultimoToque = Date.now(); };

// Bloqueio automático. Não depende só de "fechar": navegadores móveis às vezes suspendem a página sem aviso.
// • ao ir para segundo plano: a tela é coberta na hora (não aparece nos apps recentes) e, ao voltar, bloqueia se
//   passou o tempo escolhido; • ao fechar/recarregar: as chaves só existem na memória, então sempre volta bloqueado;
// • sem uso por alguns minutos com o app aberto: bloqueia.
function ligarAutoBloqueio() {
  const pausado = () => Date.now() < pausaAte;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { ocultoEm = Date.now(); if (destravado()) document.body.classList.add('cortina'); return; }
    if (destravado() && ocultoEm != null && !pausado() && Date.now() - ocultoEm >= autoMin * 60000) travar('Bloqueado ao sair do app.');
    ocultoEm = null; document.body.classList.remove('cortina');
  });
  window.addEventListener('pagehide', () => { if (destravado() && !pausado()) travar('Bloqueado ao fechar.'); });
  window.addEventListener('pageshow', e => { if (e.persisted && !destravado()) document.body.classList.add('travado'); });
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'scroll']) window.addEventListener(ev, () => { ultimoToque = Date.now(); }, { passive: true, capture: true });
  setInterval(() => {
    if (!destravado() || pausado() || document.visibilityState !== 'visible') return;
    if (Date.now() - ultimoToque >= Math.max(5, autoMin) * 60000) travar('Bloqueado por falta de uso.');
  }, 15000);
  // Escolher foto/arquivo abre a galeria ou a câmera, que tiram o app da tela: não bloquear no meio disso.
  document.addEventListener('click', e => { if (e.target.closest('input[type=file], label:has(input[type=file])')) pausarAutoBloqueio(10); }, true);
  document.addEventListener('change', e => { if (e.target.matches('input[type=file]')) retomarAutoBloqueio(); }, true);
}
export { telaCodigo };
