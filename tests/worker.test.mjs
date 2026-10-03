import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../worker.js', import.meta.url), 'utf8');
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const { default: worker } = await import(moduleUrl);

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes('COUNT(*)')) return { total: this.db.rows.size };
    if (this.sql.includes('WHERE id = ?')) return this.db.rows.get(this.values[0]) || null;
    if (this.sql.includes('WHERE band = ?')) {
      const [band, name, excludedId] = this.values;
      return [...this.db.rows.values()].find((row) =>
        row.band.toLocaleLowerCase() === band.toLocaleLowerCase() &&
        row.name.toLocaleLowerCase() === name.toLocaleLowerCase() &&
        (!excludedId || row.id !== excludedId)
      ) || null;
    }
    throw new Error(`Unhandled first query: ${this.sql}`);
  }

  async all() {
    if (!this.sql.includes('ORDER BY band')) throw new Error(`Unhandled all query: ${this.sql}`);
    const [limit, offset] = this.values;
    const results = [...this.db.rows.values()]
      .sort((a, b) => a.band.localeCompare(b.band, 'ja', { sensitivity: 'base' }) ||
        b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id))
      .slice(offset, offset + limit)
      .map(({ data: _data, ...row }) => row);
    return { results };
  }

  async run() {
    if (this.sql.startsWith('INSERT')) {
      const [id, band, name, data, createdAt, updatedAt] = this.values;
      this.db.rows.set(id, { id, band, name, data, created_at: createdAt, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith('UPDATE')) {
      const [band, name, data, updatedAt, id] = this.values;
      const previous = this.db.rows.get(id);
      if (!previous) return { meta: { changes: 0 } };
      this.db.rows.set(id, { ...previous, band, name, data, updated_at: updatedAt });
      return { meta: { changes: 1 } };
    }
    if (this.sql.startsWith('DELETE')) {
      return { meta: { changes: this.db.rows.delete(this.values[0]) ? 1 : 0 } };
    }
    throw new Error(`Unhandled run query: ${this.sql}`);
  }
}

class FakeD1 {
  constructor() {
    this.rows = new Map();
  }

  prepare(sql) {
    return new Statement(this, sql);
  }
}

function plotData(seed = 0) {
  return {
    app: 'camera-plot',
    version: 5,
    stage: { w: 12, d: 8 },
    cams: [{ name: `CAM ${seed}`, x: seed, y: 2, angle: 0, focal: 35, sw: 36, sh: 24 }],
    subjects: [{ kind: 'person', name: `人物 ${seed}`, x: 1, y: 1 }]
  };
}

function request(path, method = 'GET', body) {
  const init = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return new Request(`https://example.test${path}`, init);
}

async function responseJson(response) {
  return response.status === 204 ? null : response.json();
}

test('rejects malformed API paths and invalid pagination', async () => {
  const env = { DB: new FakeD1(), ASSETS: { fetch: () => new Response('asset') } };
  const malformed = await worker.fetch(request('/api/plots/foo/bar'), env);
  assert.equal(malformed.status, 404);
  assert.deepEqual(await responseJson(malformed), { error: 'not_found' });

  const pagination = await worker.fetch(request('/api/plots?limit=500'), env);
  assert.equal(pagination.status, 400);
  assert.deepEqual(await responseJson(pagination), { error: 'invalid_pagination' });
});

test('validates persisted plot data', async () => {
  const env = { DB: new FakeD1(), ASSETS: { fetch: () => new Response('asset') } };
  const response = await worker.fetch(request('/api/plots', 'POST', {
    band: 'Band', name: 'Broken', data: { app: 'camera-plot', stage: true, cams: [] }
  }), env);
  assert.equal(response.status, 400);
  assert.deepEqual(await responseJson(response), { error: 'invalid_payload' });
});

test('creates, updates, paginates, and rejects duplicate names', async () => {
  const env = { DB: new FakeD1(), ASSETS: { fetch: () => new Response('asset') } };
  const createdIds = [];

  for (let index = 0; index < 3; index += 1) {
    const response = await worker.fetch(request('/api/plots', 'POST', {
      band: 'Band A', name: `Profile ${index}`, data: plotData(index)
    }), env);
    assert.equal(response.status, 201);
    createdIds.push((await responseJson(response)).id);
  }

  const duplicate = await worker.fetch(request('/api/plots', 'POST', {
    band: 'band a', name: 'profile 0', data: plotData(9)
  }), env);
  assert.equal(duplicate.status, 409);
  assert.equal((await responseJson(duplicate)).error, 'duplicate_name');

  const updated = await worker.fetch(request(`/api/plots/${createdIds[0]}`, 'PUT', {
    band: 'Band A', name: 'Renamed', data: plotData(10)
  }), env);
  assert.equal(updated.status, 200);
  assert.equal((await responseJson(updated)).name, 'Renamed');

  const renameConflict = await worker.fetch(request(`/api/plots/${createdIds[0]}`, 'PUT', {
    band: 'Band A', name: 'Profile 1', data: plotData(11)
  }), env);
  assert.equal(renameConflict.status, 409);

  const page = await worker.fetch(request('/api/plots?limit=2&offset=0'), env);
  assert.equal(page.status, 200);
  const pageBody = await responseJson(page);
  assert.equal(pageBody.plots.length, 2);
  assert.equal(pageBody.total, 3);
  assert.equal(pageBody.has_more, true);

  const lastPage = await worker.fetch(request('/api/plots?limit=2&offset=2'), env);
  const lastPageBody = await responseJson(lastPage);
  assert.equal(lastPageBody.plots.length, 1);
  assert.equal(lastPageBody.has_more, false);
});
