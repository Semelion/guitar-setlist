import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLibraryApi, keys} from '../static/api-core.ts';
import {csvDecode} from '../lib/core.ts';

const seed = readFileSync(new URL('../lib/catalog.csv', import.meta.url), 'utf8');
const memKv = () => {
 const m = new Map();
 return {
  getItem: k => (m.has(k) ? m.get(k) : null),
  setItem: (k, v) => void m.set(k, String(v)),
  _map: m,
 };
};
const U = (q = '') => new URL('https://site.local/api/library' + q);

test('static GET seeds 291 songs with empty session', async () => {
 const api = createLibraryApi(seed, memKv());
 const r = await api(U(), 'GET');
 assert.equal(r.status, 200);
 const d = r.json;
 assert.equal(d.songs.length, 291);
 assert.equal(d.catalogVersion, 'seed');
 assert.equal(d.sessionVersion, 'seed');
 assert.deepEqual(d.session, {queue: [], skipped: [], played: [], active: null});
});

test('static PUT saves session and enforces version conflicts', async () => {
 const api = createLibraryApi(seed, memKv());
 const ok = await api(U(), 'PUT', JSON.stringify({version: 'seed', session: {queue: ['song-002'], played: [], skipped: [], active: null}}));
 assert.equal(ok.status, 200);
 assert.match(ok.json.version, /^local-1$/);
 const stale = await api(U(), 'PUT', JSON.stringify({version: 'seed', session: {queue: [], played: [], skipped: [], active: null}}));
 assert.equal(stale.status, 409);
 const get = await api(U(), 'GET');
 assert.deepEqual(get.json.session.queue, ['song-002']);
 assert.equal(get.json.sessionVersion, 'local-1');
});

test('static POST adds song, rejects duplicates, bad urls and stale versions', async () => {
 const api = createLibraryApi(seed, memKv());
 const song = {artist: 'Тест', title: 'Песня, с "кавычками"', url: 'https://example.com/a', category: 'acoustic'};
 const ok = await api(U(), 'POST', JSON.stringify({version: 'seed', song}));
 assert.equal(ok.status, 200);
 assert.equal(ok.json.songs.length, 292);
 const added = ok.json.songs.at(-1);
 assert.equal(added.artist, 'Тест');
 assert.equal(added.resource_type, 'chords');
 const dup = await api(U(), 'POST', JSON.stringify({version: ok.json.version, song: {...song, title: 'песня, с "кавычками"'}}));
 assert.equal(dup.status, 400);
 const bad = await api(U(), 'POST', JSON.stringify({version: ok.json.version, song: {artist: 'X', title: 'Y', url: 'javascript:alert(1)'}}));
 assert.equal(bad.status, 400);
 const stale = await api(U(), 'POST', JSON.stringify({version: 'seed', song: {artist: 'A', title: 'B', url: 'https://e.com'}}));
 assert.equal(stale.status, 409);
});

test('static download returns BOM CSV that round-trips', async () => {
 const kv = memKv();
 const api = createLibraryApi(seed, kv);
 await api(U(), 'POST', JSON.stringify({version: 'seed', song: {artist: 'КИНО', title: 'Тест, «кавычки»\nи перенос', url: 'https://e.com/x', category: 'ru'}}));
 const r = await api(U('?download=1'), 'GET');
 assert.equal(r.status, 200);
 assert.ok(r.csv.startsWith('\uFEFF'));
 const rows = csvDecode(r.csv);
 assert.equal(rows.length, 292);
 assert.equal(rows.at(-1).title, 'Тест, «кавычки»\nи перенос');
});

test('static data survives "restart" via shared storage', async () => {
 const kv = memKv();
 const api1 = createLibraryApi(seed, kv);
 await api1(U(), 'PUT', JSON.stringify({version: 'seed', session: {queue: ['song-010'], played: [], skipped: ['song-011'], active: null}}));
 const api2 = createLibraryApi(seed, kv);
 const r = await api2(U(), 'GET');
 assert.deepEqual(r.json.session.queue, ['song-010']);
 assert.deepEqual(r.json.session.skipped, ['song-011']);
 assert.equal(r.json.sessionVersion, 'local-1');
 assert.ok(kv.getItem(keys.session));
});
