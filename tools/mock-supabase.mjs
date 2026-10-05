// Imita as duas funções do supabase.sql (mesma semântica) para testes locais.
import http from 'http';
const cofres = new Map(); let chamadas = 0;
const srv = http.createServer((q, r) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey,authorization,content-type', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' };
  if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
  let b = ''; q.on('data', c => b += c); q.on('end', () => {
    const json = (st, o) => { r.writeHead(st, { ...cors, 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (q.url === '/__estado') return json(200, { chamadas, cofres: [...cofres.entries()].map(([id, c]) => ({ id, versao: c.versao, tamanho: c.dados.length, inicio: c.dados.slice(0, 40), colunas: Object.keys(c).filter(k => k !== 'anterior') })) });
    if (q.url === '/__corpos') return json(200, { ultimo: srv.ultimoCorpo || '' });
    if (q.url === '/__rollback') { for (const c of cofres.values()) if (c.anterior) Object.assign(c, c.anterior); return json(200, {}); }
    if (q.url === '/__adulterar') { for (const c of cofres.values()) { const [v, iv, ct] = c.dados.split('.'); c.dados = [v, iv, (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1)].join('.'); } return json(200, {}); }
    if (q.url === '/__guardar') { for (const c of cofres.values()) c.anterior = { versao: c.versao, dados: c.dados }; return json(200, {}); }
    if (q.url === '/__offline') { srv.offline = !srv.offline; return json(200, { offline: srv.offline }); }
    if (srv.offline) { q.socket.destroy(); return; }
    if (q.headers.apikey !== 'sb_publishable_TESTE_1234567890abcdef') return json(401, { message: 'Invalid API key' });
    chamadas++;
    const p = JSON.parse(b || '{}');
    srv.ultimoCorpo = b;
    const hexOk = /^[0-9a-f]{64}$/.test(p.p_id || '');
    if (q.url === '/rest/v1/rpc/ler_cofre') { const c = cofres.get(p.p_id); return json(200, c && hexOk ? [{ versao: c.versao, dados: c.dados, atualizado_em: c.em }] : []); }
    if (q.url === '/rest/v1/rpc/gravar_cofre') {
      if (Object.keys(p).sort().join() !== 'p_dados,p_id,p_versao_esperada') return json(404, { code: 'PGRST202', message: 'Could not find the function' });
      if (!hexOk) return json(400, { message: 'cofre inválido' });
      if (!/^v2z?\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(p.p_dados)) return json(400, { message: 'conteúdo não está cifrado no formato do app' });
      const c = cofres.get(p.p_id);
      if (!c) { if (p.p_versao_esperada !== 0) return json(200, -1); if (cofres.size >= 3) return json(400, { message: 'limite de cofres atingido' }); cofres.set(p.p_id, { versao: 1, dados: p.p_dados, em: new Date().toISOString() }); return json(200, 1); }
      if (c.versao !== p.p_versao_esperada) return json(200, -1);
      Object.assign(c, { versao: c.versao + 1, dados: p.p_dados, em: new Date().toISOString() }); return json(200, c.versao);
    }
    json(404, { code: 'PGRST202', message: 'Could not find the function' });
  });
});
srv.listen(8766, () => console.log('mock supabase :8766'));
