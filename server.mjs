// Local-only web app. Binds to 127.0.0.1; the only outgoing call is to Ollama on this machine.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanImage, OLLAMA_URL, MODEL } from './lib/extract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 3977);
const DATA = process.env.LMC_DATA || path.join(HERE, 'data', 'cabinet.json');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const readItems = () => {
  try {
    return JSON.parse(fs.readFileSync(DATA, 'utf8'));
  } catch {
    return [];
  }
};
const writeItems = (items) => {
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(items, null, 2));
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
    if (url.pathname === '/api/items' && req.method === 'GET') return json(res, 200, readItems());
    if (url.pathname === '/api/items' && req.method === 'PUT') {
      const items = JSON.parse(await body(req));
      if (!Array.isArray(items)) return json(res, 400, { error: 'expected an array' });
      writeItems(items.map((x) => ({ name: String(x.name ?? ''), expiry: String(x.expiry ?? '') })));
      return json(res, 200, { ok: true });
    }
    if (url.pathname === '/api/scan' && req.method === 'POST') {
      const { image } = JSON.parse(await body(req));
      if (typeof image !== 'string' || !image) return json(res, 400, { error: 'image missing' });
      try {
        return json(res, 200, { items: await scanImage(image.replace(/^data:image\/\w+;base64,/, '')) });
      } catch (e) {
        return json(res, 502, { error: `Could not reach the local model (${e.message}). Is Ollama running?` });
      }
    }
    const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const root = path.join(HERE, 'public');
    // The browser reuses the exact status logic the tests cover.
    const file = rel === 'status.js' ? path.join(HERE, 'lib', 'status.mjs') : path.join(root, rel);
    if (rel === 'status.js') {
      res.writeHead(200, { 'Content-Type': TYPES['.js'] });
      return fs.createReadStream(file).pipe(res);
    }
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'not found' });
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, '127.0.0.1', () => console.log(`Lazy Medicine Cabinet: http://localhost:${PORT} (model ${MODEL})`));
}
