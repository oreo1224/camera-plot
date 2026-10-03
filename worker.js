const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_BODY_BYTES = 1024 * 1024;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function validPlot(data) {
  return data && data.app === 'camera-plot' && data.stage && Array.isArray(data.cams);
}

async function readPayload(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw new Error('too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Error('too_large');
  const body = JSON.parse(text);
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const band = typeof body.band === 'string' ? body.band.trim().slice(0, 80) : '';
  if (!band || !name || !validPlot(body.data)) throw new Error('invalid');
  return { band, name, data: JSON.stringify(body.data) };
}

async function handleApi(request, env, url) {
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts.length === 3 ? parts[2] : null;

  if (request.method === 'GET' && !id) {
    const result = await env.DB.prepare(
      'SELECT id, band, name, created_at, updated_at FROM plots ORDER BY band COLLATE NOCASE, updated_at DESC LIMIT 500'
    ).all();
    return json({ plots: result.results || [] });
  }
  if (request.method === 'GET' && id) {
    const row = await env.DB.prepare(
      'SELECT id, band, name, data, created_at, updated_at FROM plots WHERE id = ?'
    ).bind(id).first();
    if (!row) return json({ error: 'not_found' }, 404);
    return json({ ...row, data: JSON.parse(row.data) });
  }
  if ((request.method === 'POST' && !id) || (request.method === 'PUT' && id)) {
    let payload;
    try { payload = await readPayload(request); }
    catch (error) {
      return json({ error: error.message === 'too_large' ? 'too_large' : 'invalid_payload' }, error.message === 'too_large' ? 413 : 400);
    }
    const now = new Date().toISOString();
    if (!id) {
      const newId = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO plots (id, owner_hash, band, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(newId, 'shared', payload.band, payload.name, payload.data, now, now).run();
      return json({ id: newId, band: payload.band, name: payload.name, created_at: now, updated_at: now }, 201);
    }
    const result = await env.DB.prepare(
      'UPDATE plots SET band = ?, name = ?, data = ?, updated_at = ? WHERE id = ?'
    ).bind(payload.band, payload.name, payload.data, now, id).run();
    if (!result.meta.changes) return json({ error: 'not_found' }, 404);
    return json({ id, name: payload.name, updated_at: now });
  }
  if (request.method === 'DELETE' && id) {
    const result = await env.DB.prepare('DELETE FROM plots WHERE id = ?').bind(id).run();
    if (!result.meta.changes) return json({ error: 'not_found' }, 404);
    return new Response(null, { status: 204 });
  }
  return json({ error: 'method_not_allowed' }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/plots' || url.pathname.startsWith('/api/plots/')) {
      try { return await handleApi(request, env, url); }
      catch (error) {
        console.error('Plot API error', error);
        return json({ error: 'internal_error' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
