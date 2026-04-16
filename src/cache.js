const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = process.env.CACHE_DIR || path.join(__dirname, '..', 'cache');

function ensureDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function hashPrompt(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

function get(hash) {
  ensureDir();
  const file = path.join(CACHE_DIR, `${hash}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function set(hash, data) {
  ensureDir();
  fs.writeFileSync(path.join(CACHE_DIR, `${hash}.json`), JSON.stringify(data, null, 2));
}

function list() {
  ensureDir();
  return fs.readdirSync(CACHE_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const stat = fs.statSync(path.join(CACHE_DIR, f));
      return { hash: f.replace('.json', ''), created_at: stat.birthtime.toISOString(), size_bytes: stat.size };
    });
}

function del(hash) {
  const file = path.join(CACHE_DIR, `${hash}.json`);
  if (fs.existsSync(file)) fs.unlinkSync(file);
  return true;
}

module.exports = { hashPrompt, get, set, list, del };
