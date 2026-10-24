// Local-only web app. Binds to 127.0.0.1; the only outgoing call is to Ollama on this machine.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { scanImage, OLLAMA_URL, MODEL } from './lib/extract.mjs';
import { normalizeState } from './lib/inventory.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 3977);
const DATA = process.env.LMC_DATA || path.join(HERE, 'data', 'cabinet.json');
const PHOTOS = path.join(path.dirname(DATA), 'photos'); // scanned photos stay here, on this computer
const DEMO_DIR = path.join(HERE, 'samples', 'generated');
const DEMO_FILES = ['1-shelf-paracetamol.jpg', '2-table-ibuprofen.jpg', '3-shelf-vitamin.jpg', '4-side-date-saline.jpg', '5-three-boxes.jpg'];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

const readState = () => {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(DATA, 'utf8'))); // also migrates the first version's bare array
  } catch {
    return normalizeState(null);
  }
};
const writeState = (state) => {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(state, null, 2));
};

// A photo is deleted as soon as no line refers to it any more (line removed, or "Clear all").
const deleteUnusedPhotos = (state) => {
  if (!fs.existsSync(PHOTOS)) return;
  const used = new Set(state.items.map((i) => i.photo).filter(Boolean));
  for (const f of fs.readdirSync(PHOTOS)) if (/^[0-9a-f]{16}\.jpg$/.test(f) && !used.has(f)) fs.rmSync(path.join(PHOTOS, f), { force: true });
};

// The demo cabinet: the real Gemma results for the generated test photos, committed in samples/generated.
const demoItems = () => {
  const res = JSON.parse(fs.readFileSync(path.join(DEMO_DIR, 'results-v2-prompt.json'), 'utf8'));
  return DEMO_FILES.flatMap((f) => (res.photos[f]?.raw ?? []).map((r) => ({ name: r.name, expiry: r.expiry, photo: `demo:${f}`, demo: true })));
};

const body = (req, limit = 15e6) =>
  new Promise((ok, no) => {
    let n = 0;
    const c = [];
    req.on('data', (d) => {
      n += d.length;
      if (n > limit) {
        no(new Error('too large'));
        req.destroy();
      } else c.push(d);
    });
    req.on('end', () => ok(Buffer.concat(c).toString('utf8')));
  });
const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const sendFile = (res, file, type) => {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
};

export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Reject requests whose Host is not localhost (blocks DNS rebinding from web pages).
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return json(res, 403, { error: 'forbidden' });
    if (url.pathname === '/api/health') {
      let ollama = false;
      try {
        ollama = (await fetch(`${OLLAMA_URL}/api/tags`)).ok;
      } catch {}
      return json(res, 200, { ollama, model: MODEL });
    }
    if (url.pathname === '/api/state' && req.method === 'GET') return json(res, 200, readState());
    if (url.pathname === '/api/state' && req.method === 'PUT') {
      const state = normalizeState(JSON.parse(await body(req)));
      writeState(state);
      deleteUnusedPhotos(state);
      return json(res, 200, state);
    }
    if (url.pathname === '/api/demo' && req.method === 'GET') return json(res, 200, { items: demoItems() });
    if (url.pathname === '/api/scan' && req.method === 'POST') {
      const { image } = JSON.parse(await body(req));
      if (typeof image !== 'string' || !image) return json(res, 400, { error: 'image missing' });
      const b64 = image.replace(/^data:image\/\w+;base64,/, '');
      let items;
      try {
        items = await scanImage(b64);
      } catch (e) {
        return json(res, 502, { error: `Could not reach the local model (${e.message}). Is Ollama running?` });
      }
      // Keep the photo only if it produced lines. The lines are added to the saved list here, so a photo is never unreferenced.
      let photo;
      if (items.length) {
        photo = crypto.randomBytes(8).toString('hex') + '.jpg';
        fs.mkdirSync(PHOTOS, { recursive: true });
        fs.writeFileSync(path.join(PHOTOS, photo), Buffer.from(b64, 'base64'));
      }
      const state = readState();
      state.items.push(...items.map((i) => ({ ...i, ...(photo ? { photo } : {}) })));
      writeState(state);
      return json(res, 200, { added: items.length, state: readState() });
    }
    // Photos: only files with our own generated names, from data/photos or the committed demo photos.
    let m;
    if ((m = url.pathname.match(/^\/photos\/([0-9a-f]{16}\.jpg)$/))) {
      const f = path.join(PHOTOS, m[1]);
      return fs.existsSync(f) ? sendFile(res, f, 'image/jpeg') : json(res, 404, { error: 'not found' });
    }
    if ((m = url.pathname.match(/^\/demo-photos\/([\w.-]+)$/)) && DEMO_FILES.includes(m[1])) {
      const f = path.join(DEMO_DIR, m[1]);
      return fs.existsSync(f) ? sendFile(res, f, 'image/jpeg') : json(res, 404, { error: 'not found' });
    }
    // Static files: public/ plus the shared logic in lib/*.mjs (the browser runs the exact code the tests cover).
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const root = rel.startsWith('lib/') && rel.endsWith('.mjs') ? path.join(HERE, 'lib') : path.join(HERE, 'public');
    const file = path.join(root, rel.startsWith('lib/') ? rel.slice(4) : rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not found' });
    sendFile(res, file, TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Lazy Medicine Cabinet: http://localhost:${PORT} (model ${MODEL})`));
}
