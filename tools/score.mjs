// Scores result files from run-samples.mjs against truth.json with ONE set of strict rules,
// so before/after runs are comparable.  Usage: node tools/score.mjs results-a.json [results-b.json ...]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { statusFor } from '../lib/status.mjs';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'generated');
const truth = JSON.parse(fs.readFileSync(path.join(DIR, 'truth.json'), 'utf8'));
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

for (const f of process.argv.slice(2)) {
  const rep = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const t = { boxes: 0, found: 0, fullName: 0, dateExact: 0, dateValue: 0, status: 0, secs: 0 };
  console.log(`\n== ${f} ==`);
  for (const [file, boxes] of Object.entries(truth.photos)) {
    const ph = rep.photos[file];
    t.secs += ph.secs;
    const pool = [...ph.raw];
    for (const b of boxes) {
      t.boxes++;
      // a read line belongs to this box if it mentions its brand or its generic name
      const i = pool.findIndex((r) => norm(r.name).includes(norm(b.brand)) || norm(r.name).includes(norm(b.name)));
      const r = i >= 0 ? pool.splice(i, 1)[0] : null;
      const full = !!r && norm(r.name).includes(norm(b.brand)) && norm(r.name).includes(norm(b.name));
      const exact = !!r && norm(r.expiry) === norm(b.expiry);
      const st = r ? statusFor(r.expiry, truth.today).status : 'unknown';
      const value = !!r && st !== 'unknown' && statusFor(r.expiry, truth.today).iso === statusFor(b.expiry, truth.today).iso;
      if (r) t.found++;
      if (full) t.fullName++;
      if (exact) t.dateExact++;
      if (value) t.dateValue++;
      if (st === b.status) t.status++;
      console.log(`${file.slice(0, 2)} | truth: ${b.brand} ${b.name} | ${b.expiry}\n   | read : ${r ? r.name + ' | ' + r.expiry : '(not found)'}  -> full-name:${full} date-text:${exact} date-value:${value} status:${st === b.status}`);
    }
  }
  console.log(`TOTAL of ${t.boxes}: found ${t.found}, full name ${t.fullName}, date text exact ${t.dateExact}, date value ${t.dateValue}, status ${t.status}; ${t.secs}s for 5 photos`);
}
