// Runs every photo in samples/ through the same scan code the app uses and compares with truth.json.
// Usage: node tools/run-samples.mjs   (needs Ollama running with the model pulled; ffmpeg on PATH)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanImage, MODEL } from '../lib/extract.mjs';
import { statusFor } from '../lib/status.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', 'samples', process.argv[2] || 'generated');
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lmc-'));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const report = { model: MODEL, today: truth.today, photos: {} };

for (const [file, boxes] of Object.entries(truth.photos)) {
  const small = path.join(tmp, file);
  // Same idea as the browser: longest side 1024 px, JPEG.
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(DIR, file), '-vf', "scale='min(1024,iw)':-2", '-q:v', '3', small]);
  const t0 = Date.now();
  let read = [];
  let error = null;
  try {
    read = await scanImage(fs.readFileSync(small).toString('base64'));
  } catch (e) {
    error = e.message;
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  const rows = boxes.map((b) => {
    const hit = read.find((r) => norm(r.name).includes(norm(b.name)) || norm(b.name).includes(norm(r.name)) || (b.brand && norm(r.name).includes(norm(b.brand))));
    return {
      truth: `${b.brand} ${b.name} | ${b.expiry} | ${b.status}`,
      read: hit ? `${hit.name} | ${hit.expiry} | ${statusFor(hit.expiry, truth.today).status}` : '(not found)',
      nameOk: !!hit && norm(hit.name).includes(norm(b.name)),
      expiryOk: !!hit && norm(hit.expiry) === norm(b.expiry),
      statusOk: !!hit && statusFor(hit.expiry, truth.today).status === b.status,
    };
  });
  report.photos[file] = { secs, error, raw: read, rows };
  console.log(`${file} (${secs}s)${error ? ' ERROR ' + error : ''}`);
  console.log('  raw:', JSON.stringify(read));
  rows.forEach((r) => console.log(`  truth: ${r.truth}\n  read : ${r.read}   name:${r.nameOk} expiry:${r.expiryOk} status:${r.statusOk}`));
  fs.writeFileSync(path.join(DIR, process.env.LMC_RESULTS || 'results.json'), JSON.stringify(report, null, 2));
}

