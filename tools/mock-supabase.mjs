// Imita as duas funções do supabase.sql (mesma semântica) para testes locais.
import http from 'http';
const cofres = new Map(); let chamadas = 0;
const srv = http.createServer((q, r) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'apikey,authorization,content-type', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS' };
  if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
  let b = ''; q.on('data', c => b += c); q.on('end', () => {
    const json = (st, o) => { r.writeHead(st, { ...cors, 'Content-Type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (q.url === '/__estado') return json(200, { chamadas, cofres: [...cofres.entries()].map(([id, c]) => ({ id, versao: c.versao, tamanho: c.dados.length, inicio: c.dados.slice(0, 40), por: c.atualizado_por })) });
    if (q.url === '/__offline') { srv.offline = !srv.offline; return json(200, { offline: srv.offline }); }
    if (srv.offline) { q.socket.destroy(); return; }
    if (q.headers.apikey !== 'sb_publishable_TESTE_1234567890abcdef') return json(401, { message: 'Invalid API key' });
    chamadas++;
    const p = JSON.parse(b || '{}');
    if (q.url === '/rest/v1/rpc/ler_cofre') { const c = cofres.get(p.p_id); return json(200, c && p.p_id.length >= 32 ? [{ versao: c.versao, dados: c.dados, atualizado_em: c.em, atualizado_por: c.atualizado_por }] : []); }
    if (q.url === '/rest/v1/rpc/gravar_cofre') {
      if (p.p_id.length < 32) return json(400, { message: 'cofre inválido' });
      const c = cofres.get(p.p_id);
      if (!c) { if (p.p_versao_esperada !== 0) return json(200, -1); cofres.set(p.p_id, { versao: 1, dados: p.p_dados, em: new Date().toISOString(), atualizado_por: p.p_por }); return json(200, 1); }
      if (c.versao !== p.p_versao_esperada) return json(200, -1);
      Object.assign(c, { versao: c.versao + 1, dados: p.p_dados, em: new Date().toISOString(), atualizado_por: p.p_por }); return json(200, c.versao);
    }
    json(404, { code: 'PGRST202', message: 'Could not find the function' });
  });
});
srv.listen(8766, () => console.log('mock supabase :8766'));
