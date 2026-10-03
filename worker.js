const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value, min, max) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function validNamedPosition(value) {
  return isObject(value) && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 200 &&
    finiteNumber(value.x, -1000, 1000) && finiteNumber(value.y, -1000, 1000);
}

function validCamera(value) {
  return validNamedPosition(value) && finiteNumber(value.angle, 0, 360) &&
    finiteNumber(value.focal, 1, 2000) && finiteNumber(value.sw, 1, 100) && finiteNumber(value.sh, 1, 100);
}

function validSubject(value) {
  return validNamedPosition(value) && (value.kind === 'person' || value.kind === 'obj');
}

function validPlot(data) {
  return isObject(data) && data.app === 'camera-plot' && isObject(data.stage) &&
    finiteNumber(data.stage.w, 1, 300) && finiteNumber(data.stage.d, 1, 300) &&
    Array.isArray(data.cams) && data.cams.length <= 500 && data.cams.every(validCamera) &&
    Array.isArray(data.subjects) && data.subjects.length <= 2000 && data.subjects.every(validSubject);
}

async function readPayload(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) throw new Error('too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new Error('too_large');
  const body = JSON.parse(text);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const band = typeof body.band === 'string' ? body.band.trim() : '';
  if (!band || band.length > 80 || !name || name.length > 80 || !validPlot(body.data)) throw new Error('invalid');
  return { band, name, data: JSON.stringify(body.data) };
}

function parseRoute(pathname) {
  if (pathname === '/api/plots') return { collection: true, id: null };
  const match = pathname.match(/^\/api\/plots\/([^/]+)$/);
  if (!match || !UUID_RE.test(match[1])) return null;
  return { collection: false, id: match[1] };
}

function pageParams(url) {
  const rawLimit = url.searchParams.get('limit');
  const rawOffset = url.searchParams.get('offset');
  const limit = rawLimit === null ? DEFAULT_PAGE_SIZE : Number(rawLimit);
  const offset = rawOffset === null ? 0 : Number(rawOffset);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE ||
      !Number.isInteger(offset) || offset < 0 || offset > 1000000) return null;
  return { limit, offset };
}

async function duplicateId(env, band, name, excludedId) {
  let query = 'SELECT id FROM plots WHERE band = ? COLLATE NOCASE AND name = ? COLLATE NOCASE';
  const values = [band, name];
  if (excludedId) {
    query += ' AND id != ?';
    values.push(excludedId);
  }
  const row = await env.DB.prepare(query).bind(...values).first();
  return row ? row.id : null;
}

function isUniqueError(error) {
  return String(error && error.message || error).toLowerCase().includes('unique');
}

async function handleApi(request, env, url, route) {
  const id = route.id;

  if (request.method === 'GET' && route.collection) {
    const page = pageParams(url);
    if (!page) return json({ error: 'invalid_pagination' }, 400);
    const [result, count] = await Promise.all([
      env.DB.prepare(
        'SELECT id, band, name, created_at, updated_at FROM plots ORDER BY band COLLATE NOCASE, updated_at DESC, id ASC LIMIT ? OFFSET ?'
      ).bind(page.limit, page.offset).all(),
      env.DB.prepare('SELECT COUNT(*) AS total FROM plots').first()
    ]);
    const plots = result.results || [];
    const total = Number(count && count.total || 0);
    return json({ plots, total, limit: page.limit, offset: page.offset, has_more: page.offset + plots.length < total });
  }
  if (request.method === 'GET' && !route.collection) {
    const row = await env.DB.prepare(
      'SELECT id, band, name, data, created_at, updated_at FROM plots WHERE id = ?'
    ).bind(id).first();
    if (!row) return json({ error: 'not_found' }, 404);
    return json({ ...row, data: JSON.parse(row.data) });
  }
  if ((request.method === 'POST' && route.collection) || (request.method === 'PUT' && !route.collection)) {
    let payload;
    try { payload = await readPayload(request); }
    catch (error) {
      return json({ error: error.message === 'too_large' ? 'too_large' : 'invalid_payload' }, error.message === 'too_large' ? 413 : 400);
    }
    const now = new Date().toISOString();
    const conflict = await duplicateId(env, payload.band, payload.name, id);
    if (conflict) return json({ error: 'duplicate_name', existing_id: conflict }, 409);
    if (route.collection) {
      const newId = crypto.randomUUID();
      try {
        await env.DB.prepare(
          'INSERT INTO plots (id, band, name, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(newId, payload.band, payload.name, payload.data, now, now).run();
      } catch (error) {
        if (isUniqueError(error)) return json({ error: 'duplicate_name' }, 409);
        throw error;
      }
      return json({ id: newId, band: payload.band, name: payload.name, created_at: now, updated_at: now }, 201);
    }
    let result;
    try {
      result = await env.DB.prepare(
        'UPDATE plots SET band = ?, name = ?, data = ?, updated_at = ? WHERE id = ?'
      ).bind(payload.band, payload.name, payload.data, now, id).run();
    } catch (error) {
      if (isUniqueError(error)) return json({ error: 'duplicate_name' }, 409);
      throw error;
    }
    if (!result.meta.changes) return json({ error: 'not_found' }, 404);
    return json({ id, band: payload.band, name: payload.name, updated_at: now });
  }
  if (request.method === 'DELETE' && !route.collection) {
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
      const route = parseRoute(url.pathname);
      if (!route) return json({ error: 'not_found' }, 404);
      try { return await handleApi(request, env, url, route); }
      catch (error) {
        console.error('Plot API error', error);
        return json({ error: 'internal_error' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
