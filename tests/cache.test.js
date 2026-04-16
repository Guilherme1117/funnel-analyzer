const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.CACHE_DIR = path.join(os.tmpdir(), 'funnel-analyzer-test-cache-' + Date.now());

const cache = require('../src/cache');

afterAll(() => {
  fs.rmSync(process.env.CACHE_DIR, { recursive: true, force: true });
});

test('hashPrompt returns 32-char hex string', () => {
  const h = cache.hashPrompt('hello world');
  expect(h).toMatch(/^[a-f0-9]{32}$/);
});

test('hashPrompt is deterministic', () => {
  expect(cache.hashPrompt('abc')).toBe(cache.hashPrompt('abc'));
});

test('get returns null for unknown hash', () => {
  expect(cache.get('nonexistent')).toBeNull();
});

test('set and get round-trips data', () => {
  const data = { clinical_terms: ['papada', 'flacidez'] };
  cache.set('testhash', data);
  expect(cache.get('testhash')).toEqual(data);
});

test('list returns stored entries', () => {
  cache.set('listhash', { x: 1 });
  const entries = cache.list();
  expect(entries.some(e => e.hash === 'listhash')).toBe(true);
  expect(entries[0]).toHaveProperty('hash');
  expect(entries[0]).toHaveProperty('created_at');
  expect(entries[0]).toHaveProperty('size_bytes');
});

test('del removes an entry and returns true', () => {
  cache.set('delhash', { y: 2 });
  expect(cache.del('delhash')).toBe(true);
  expect(cache.get('delhash')).toBeNull();
});

test('del returns true for nonexistent hash', () => {
  expect(cache.del('ghosthash')).toBe(true);
});
