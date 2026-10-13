// Segurança: senha de abertura, bloqueio automático, código de recuperação e o que cada proteção cobre.
import { esc, dbr } from '../utils.js';
import { kpis, secao, toast } from '../ui.js';
import { lerProtecao } from '../db.js';
import { trocarSenha, novoCodigo, definirAutoBloqueio, validarNovaSenha, SENHA_MIN } from '../protecao.js';
import { travar, atualizarAutoBloqueio } from '../trava.js';

export const titulo = 'Segurança';
let cfg = null;
const OPC = [[0, 'Imediatamente'], [1, '1 minuto'], [5, '5 minutos'], [15, '15 minutos']];

export function render() {
  const c = cfg || {};
  const auto = OPC.find(o => o[0] === (c.autoMin ?? 1)) || OPC[1];
  return kpis([
    { l: 'Proteção deste aparelho', v: '<span class="pos">ativa</span>', s: 'dados cifrados (AES-256-GCM)', c: 'g' },
    { l: 'Bloqueio ao sair do app', v: auto[1], s: `sem uso: ${Math.max(5, c.autoMin ?? 1)} min · ao fechar ou recarregar: sempre` },
    { l: 'Senha de abertura', v: c.senhaTrocadaEm ? 'trocada' : 'criada', s: dbr((c.senhaTrocadaEm || c.criadoEm || '').slice(0, 10)) },
    { l: 'Código de recuperação', v: c.codigoTrocadoEm ? 'renovado' : 'gerado', s: dbr((c.codigoTrocadoEm || c.criadoEm || '').slice(0, 10)) },
  ], 'k4')
  + `<div class="panel"><h2>Bloquear</h2><p class="note">Ao bloquear, as chaves saem da memória e a tela fica vazia até a senha ser digitada. Fechar ou recarregar o painel sempre bloqueia.</p>
    <div class="form"><label>Bloquear quando o app sair da tela por<select data-auto>${OPC.map(o => `<option value="${o[0]}" ${o[0] === auto[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select></label>
    <div class="acts"><button class="btn pri" type="button" data-travar>🔒 Bloquear agora</button></div></div>
    <p class="note">Quando o app sai da tela, o conteúdo é coberto na hora (para não aparecer na lista de apps abertos). Enquanto você escolhe uma foto ou arquivo, o bloqueio automático espera até 10 minutos.</p></div>`
  + `<div class="panel"><h2>Alterar a senha de abertura</h2><div class="form" data-form-senha>
    <label>Senha atual<input type="password" name="atual" autocomplete="current-password"></label>
    <label>Nova senha<input type="password" name="s1" autocomplete="new-password" placeholder="mínimo ${SENHA_MIN} caracteres"></label>
    <label>Confirme a nova senha<input type="password" name="s2" autocomplete="new-password"></label>
    <div class="full acts"><button class="btn pri" type="button" data-trocar>Alterar senha</button><span class="why" data-erro></span></div></div>
    <p class="note">Os dados não são recifrados: só o envelope das chaves muda. O código de recuperação continua valendo.</p></div>`
  + `<div class="panel"><h2>Novo código de recuperação</h2><p class="note">Gere outro código se você perdeu o anterior ou acha que alguém viu. O código antigo deixa de funcionar.</p>
    <div class="form" data-form-codigo><label>Senha atual<input type="password" name="atual" autocomplete="current-password"></label>
    <div class="acts"><button class="btn" type="button" data-codigo>Gerar novo código</button><span class="why" data-erro></span></div></div><div data-novo-codigo></div></div>`
  + secao('camadas', 'O que cada proteção cobre', '', `<div class="tbl"><table><tr><th>Camada</th><th>O que protege</th><th>O que não protege</th></tr>
    <tr><td><b>Bloqueio da tela</b></td><td>Quem pegar o celular e abrir o painel não vê nada sem a senha. A tela é coberta quando o app sai da frente.</td><td>Não impede alguém de apagar o app ou os dados do Safari.</td></tr>
    <tr><td><b>Criptografia local</b></td><td>Tudo o que fica guardado no aparelho (lançamentos, faturas, regras, histórico, cópias de segurança e a chave da sincronização) está cifrado com AES-256-GCM. Sem a senha ou o código, é ilegível, mesmo com acesso técnico ao armazenamento do navegador.</td><td>Com o painel aberto (desbloqueado), os dados estão decifrados na memória. Alguém com controle técnico do aparelho desbloqueado e do navegador naquele momento pode lê-los.</td></tr>
    <tr><td><b>Sincronização (Supabase)</b></td><td>O que vai para a nuvem é cifrado com a senha da família, que é outra senha. O Supabase só vê um bloco ilegível.</td><td>Não depende da senha de abertura; quem souber a senha da família consegue entrar a partir de outro aparelho.</td></tr></table></div>
    <p class="note">A senha de abertura e o código nunca são guardados nem enviados. Errar a senha nunca apaga dados: depois de 5 erros seguidos é preciso esperar (30 s, 1 min, 2 min… até 15 min).</p>`, true);
}

export function ligar(root, ctx) {
  lerProtecao().then(c => { const mud = JSON.stringify(c && [c.autoMin, c.senhaTrocadaEm, c.codigoTrocadoEm]) !== JSON.stringify(cfg && [cfg.autoMin, cfg.senhaTrocadaEm, cfg.codigoTrocadoEm]); cfg = c; if (mud) ctx.rerender(); });
  root.querySelector('[data-travar]').onclick = () => travar('Bloqueado por você.');
  root.querySelector('[data-auto]').onchange = async e => { const v = Number(e.target.value); await definirAutoBloqueio(v); atualizarAutoBloqueio(v); cfg = await lerProtecao(); toast('Bloqueio automático atualizado.'); ctx.rerender(); };
  const fs = root.querySelector('[data-form-senha]');
  fs.querySelector('[data-trocar]').onclick = async () => {
    const q = n => fs.querySelector(`[name="${n}"]`), err = m => fs.querySelector('[data-erro]').textContent = m;
    const e = validarNovaSenha(q('s1').value, q('s2').value); if (e) return err(e);
    if (q('s1').value === q('atual').value) return err('A nova senha é igual à atual.');
    err('Conferindo…');
    if (!(await trocarSenha(q('atual').value, q('s1').value))) return err('Senha atual incorreta.');
    ['atual', 's1', 's2'].forEach(n => q(n).value = ''); cfg = await lerProtecao(); toast('Senha de abertura alterada.'); ctx.rerender();
  };
  const fc = root.querySelector('[data-form-codigo]');
  fc.querySelector('[data-codigo]').onclick = async () => {
    const q = fc.querySelector('[name="atual"]'), err = m => fc.querySelector('[data-erro]').textContent = m;
    err('Conferindo…'); const codigo = await novoCodigo(q.value);
    if (!codigo) return err('Senha atual incorreta.');
    q.value = ''; err('');
    root.querySelector('[data-novo-codigo]').innerHTML = `<div class="trava-codigo" style="margin-top:10px">${esc(codigo)}</div><p class="note">Anote agora: ele não aparece de novo. O código anterior não funciona mais.</p>`;
  };
}
