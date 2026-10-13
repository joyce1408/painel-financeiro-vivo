// Ajudantes dos testes: criar a senha de abertura no primeiro acesso e desbloquear.
export const SENHA_TESTE = 'senha-de-teste-123';
export async function primeiroAcesso(p, senha = SENHA_TESTE) {
  await p.waitForSelector('#trava [name=s1]', { timeout: 30000 });
  await p.fill('#trava [name=s1]', senha); await p.fill('#trava [name=s2]', senha);
  await p.click('#trava [data-ok]');
  await p.waitForSelector('#trava [data-codigo]', { timeout: 30000 });
  const codigo = (await p.textContent('#trava [data-codigo]')).trim();
  await p.check('#trava [name=anotei]'); await p.fill('#trava [name=fim]', codigo.replace(/-/g, '').slice(-4));
  await p.click('#trava [data-ok]');
  // migração (se houver base antiga) mostra "Pronto"
  await p.waitForFunction(() => (window.__painel && window.__painel.pronto) || /Pronto|não foi concluída/.test(document.querySelector('#trava')?.innerText || ''), null, { timeout: 60000 });
  if (await p.$('#trava:not([hidden]) [data-ok]')) await p.click('#trava [data-ok]');
  await p.waitForFunction(() => window.__painel && window.__painel.pronto, null, { timeout: 60000 });
  return codigo;
}
export async function desbloquear(p, senha = SENHA_TESTE) {
  await p.waitForSelector('#trava [name=s]', { timeout: 30000 });
  await p.fill('#trava [name=s]', senha); await p.click('#trava [data-ok]');
  await p.waitForFunction(() => window.__painel && window.__painel.pronto, null, { timeout: 30000 });
}
