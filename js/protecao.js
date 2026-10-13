// Senha de abertura e criptografia local.
//
// A senha NÃO é guardada em lugar nenhum. Dela sai (PBKDF2-SHA256, 600 mil iterações, sal aleatório) uma chave
// que só serve para abrir o "envelope" com as chaves dos dados. O código de recuperação abre um segundo envelope
// com as mesmas chaves. Errar a senha nunca apaga nada: só aumenta o tempo de espera entre tentativas.
import { lerProtecao, gravarProtecao, usarChaves } from './db.js';

const ITER_SENHA = 600000, ITER_CODIGO = 200000, ITER_BACKUP = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => { u8 = new Uint8Array(u8); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const aleat = n => crypto.getRandomValues(new Uint8Array(n));

async function chaveDeSenha(segredo, sal, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(segredo.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function fechar(bytes, chave, rotulo) { const iv = aleat(12); return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(rotulo) }, chave, bytes)) }; }
async function abrirEnv(env, chave, rotulo) { return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(env.iv), additionalData: enc.encode(rotulo) }, chave, deB64(env.ct))); }

// Código de recuperação: 20 caracteres sem letras ambíguas (≈ 100 bits), em grupos de 4.
const ALFA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function gerarCodigo() { const r = aleat(20); return [...r].map(x => ALFA[x % 32]).join('').replace(/(.{4})(?=.)/g, '$1-'); }
// Ignora espaços, traços e maiúsculas/minúsculas ao digitar o código.
const codigoCanon = c => String(c || '').toUpperCase().replace(/[^A-Z2-9]/g, '');

export const SENHA_MIN = 6;
export function validarNovaSenha(s1, s2) {
  if (!s1 || s1.length < SENHA_MIN) return `A senha precisa ter pelo menos ${SENHA_MIN} caracteres.`;
  if (s1 !== s2) return 'As duas senhas não são iguais.';
  return null;
}

export const protecaoExiste = async () => !!(await lerProtecao());

// Cria a proteção: chaves aleatórias novas, embrulhadas pela senha e pelo código. Devolve o código (mostrar uma vez).
export async function criarProtecao(senha) {
  const material = aleat(64);
  const salS = aleat(16), salR = aleat(16), codigo = gerarCodigo();
  const envS = await fechar(material, await chaveDeSenha(senha, salS, ITER_SENHA), 'senha');
  const envR = await fechar(material, await chaveDeSenha(codigoCanon(codigo), salR, ITER_CODIGO), 'codigo');
  await gravarProtecao({ versao: 1, criadoEm: new Date().toISOString(), iterS: ITER_SENHA, salS: b64(salS), envS, iterR: ITER_CODIGO, salR: b64(salR), envR, autoMin: 1, falhas: 0, esperaAte: 0 });
  await usarChaves(material);
  return codigo;
}

// Espera crescente depois de 5 erros: 30 s, 1 min, 2 min… até 15 min. Nunca apaga dados.
const espera = falhas => falhas < 5 ? 0 : Math.min(30000 * 2 ** (falhas - 5), 15 * 60000);
export async function aguardarMs() { const c = await lerProtecao(); return c ? Math.max(0, (c.esperaAte || 0) - Date.now()) : 0; }
async function registrarFalha(c) { c.falhas = (c.falhas || 0) + 1; c.esperaAte = Date.now() + espera(c.falhas); await gravarProtecao(c); return c; }

export async function abrirComSenha(senha) {
  const c = await lerProtecao(); if (!c) throw new Error('Proteção não configurada.');
  if ((c.esperaAte || 0) > Date.now()) return { ok: false, esperaMs: c.esperaAte - Date.now() };
  let material;
  try { material = await abrirEnv(c.envS, await chaveDeSenha(senha, deB64(c.salS), c.iterS), 'senha'); }
  catch { const n = await registrarFalha(c); return { ok: false, falhas: n.falhas, esperaMs: Math.max(0, n.esperaAte - Date.now()) }; }
  await usarChaves(material);
  if (c.falhas) { c.falhas = 0; c.esperaAte = 0; await gravarProtecao(c); }
  return { ok: true };
}

// Esqueci a senha: o código de recuperação abre as chaves e define uma senha nova. Os dados continuam os mesmos.
export async function recuperarComCodigo(codigo, novaSenha) {
  const c = await lerProtecao(); if (!c) throw new Error('Proteção não configurada.');
  if ((c.esperaAte || 0) > Date.now()) return { ok: false, esperaMs: c.esperaAte - Date.now() };
  let material;
  try { material = await abrirEnv(c.envR, await chaveDeSenha(codigoCanon(codigo), deB64(c.salR), c.iterR), 'codigo'); }
  catch { const n = await registrarFalha(c); return { ok: false, falhas: n.falhas, esperaMs: Math.max(0, n.esperaAte - Date.now()) }; }
  const salS = aleat(16);
  c.salS = b64(salS); c.iterS = ITER_SENHA; c.envS = await fechar(material, await chaveDeSenha(novaSenha, salS, ITER_SENHA), 'senha');
  c.falhas = 0; c.esperaAte = 0; c.senhaTrocadaEm = new Date().toISOString();
  await gravarProtecao(c); await usarChaves(material);
  return { ok: true };
}

export async function trocarSenha(atual, nova) {
  const c = await lerProtecao();
  let material;
  try { material = await abrirEnv(c.envS, await chaveDeSenha(atual, deB64(c.salS), c.iterS), 'senha'); } catch { return false; }
  const salS = aleat(16);
  c.salS = b64(salS); c.iterS = ITER_SENHA; c.envS = await fechar(material, await chaveDeSenha(nova, salS, ITER_SENHA), 'senha'); c.senhaTrocadaEm = new Date().toISOString();
  material.fill(0); await gravarProtecao(c); return true;
}
// Gera um código de recuperação novo (o anterior deixa de funcionar).
export async function novoCodigo(senha) {
  const c = await lerProtecao();
  let material;
  try { material = await abrirEnv(c.envS, await chaveDeSenha(senha, deB64(c.salS), c.iterS), 'senha'); } catch { return null; }
  const salR = aleat(16), codigo = gerarCodigo();
  c.salR = b64(salR); c.iterR = ITER_CODIGO; c.envR = await fechar(material, await chaveDeSenha(codigoCanon(codigo), salR, ITER_CODIGO), 'codigo'); c.codigoTrocadoEm = new Date().toISOString();
  material.fill(0); await gravarProtecao(c); return codigo;
}
export async function conferirSenha(senha) { const c = await lerProtecao(); try { (await abrirEnv(c.envS, await chaveDeSenha(senha, deB64(c.salS), c.iterS), 'senha')).fill(0); return true; } catch { return false; } }
export async function definirAutoBloqueio(min) { const c = await lerProtecao(); c.autoMin = min; await gravarProtecao(c); }
export async function autoBloqueioMin() { const c = await lerProtecao(); return c ? (c.autoMin ?? 1) : 1; }

// ---------- arquivo de backup protegido por senha ----------
async function gz(u8, modo) { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(modo === 'c' ? new CompressionStream('gzip') : new DecompressionStream('gzip'))).arrayBuffer()); }
const temGz = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
export async function protegerBackup(obj, senha) {
  const sal = aleat(16), iv = aleat(12), z = temGz();
  const bruto = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode('backup') }, await chaveDeSenha(senha, sal, ITER_BACKUP), z ? await gz(bruto, 'c') : bruto);
  return { app: 'painel-financeiro-vivo', formato: 'backup-protegido-v1', exportadoEm: obj.exportadoEm, iter: ITER_BACKUP, sal: b64(sal), iv: b64(iv), gzip: z, dados: b64(ct) };
}
export const ehBackupProtegido = o => o && o.formato === 'backup-protegido-v1' && o.dados && o.sal;
export async function abrirBackup(o, senha) {
  let pt;
  try { pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: deB64(o.iv), additionalData: enc.encode('backup') }, await chaveDeSenha(senha, deB64(o.sal), o.iter), deB64(o.dados))); }
  catch { throw new Error('Senha do backup incorreta (ou arquivo alterado).'); }
  if (o.gzip) pt = await gz(pt, 'd');
  return JSON.parse(dec.decode(pt));
}
