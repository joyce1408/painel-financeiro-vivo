// Arquivos de backup: sempre baixados protegidos por senha (AES-256-GCM); na restauração, pede a senha do arquivo.
import { dialogo, fecharDialogo } from '../ui.js';
import { protegerBackup, ehBackupProtegido, abrirBackup, SENHA_MIN } from '../protecao.js';

export function pedirSenha({ titulo, texto, confirmar }) {
  return new Promise(ok => {
    const d = dialogo(titulo, `<p class="note" style="margin:0">${texto}</p><div class="form">
      <label class="full">Senha do arquivo<input type="password" name="s1" autocomplete="off"></label>
      ${confirmar ? '<label class="full">Confirme a senha<input type="password" name="s2" autocomplete="off"></label>' : ''}
      <div class="full acts"><button class="btn pri" type="button" data-ok>Continuar</button><button class="btn ghost" type="button" data-cancelar>Cancelar</button><span class="why" data-erro></span></div></div>`);
    let feito = false; const fim = v => { if (feito) return; feito = true; fecharDialogo(); ok(v); };
    const s1 = d.querySelector('[name=s1]'); setTimeout(() => s1.focus(), 50);
    const ir = () => {
      const v = s1.value, err = m => d.querySelector('[data-erro]').textContent = m;
      if (confirmar && v.length < SENHA_MIN) return err(`Use pelo menos ${SENHA_MIN} caracteres.`);
      if (confirmar && v !== d.querySelector('[name=s2]').value) return err('As duas senhas não são iguais.');
      if (!v) return err('Digite a senha.');
      fim(v);
    };
    d.querySelector('[data-ok]').onclick = ir; d.querySelector('[data-cancelar]').onclick = () => fim(null);
    d.addEventListener('keydown', e => { if (e.key === 'Enter') ir(); });
    document.getElementById('dlg').addEventListener('close', () => fim(null), { once: true });
  });
}
export async function baixarProtegido(obj, nome) {
  const senha = await pedirSenha({ titulo: 'Proteger o arquivo de backup', texto: 'O arquivo sai cifrado: só abre com esta senha. Pode ser a mesma senha de abertura; anote se for outra. Sem ela, o arquivo não pode ser restaurado.', confirmar: true });
  if (!senha) return false;
  const p = await protegerBackup(obj, senha);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(p)], { type: 'application/json' })); a.download = nome;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
// Lê um arquivo .json escolhido: backup protegido (pede a senha), backup antigo sem proteção ou dados validados.
export async function lerArquivoDados(file) {
  let obj; try { obj = JSON.parse(await file.text()); } catch { throw new Error('Este arquivo não é um backup do painel.'); }
  if (!ehBackupProtegido(obj)) return obj;
  for (;;) {
    const senha = await pedirSenha({ titulo: 'Abrir backup protegido', texto: 'Digite a senha usada quando este backup foi baixado.' });
    if (!senha) return null;
    try { return await abrirBackup(obj, senha); } catch (e) { if (!confirm(e.message + ' Tentar de novo?')) return null; }
  }
}
