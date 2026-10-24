// Generates 5 "photos" of FICTIONAL medicine boxes (invented brands, no real logos or packaging)
// by rendering CSS 3D boxes with Playwright. Output: samples/*.jpg and samples/truth.json.
// Usage: node tools/make-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'samples', 'generated');
fs.mkdirSync(OUT, { recursive: true });

// Ground truth. `printed` is exactly the text on the box; `status` is for today = 2026-10-24.
const BOXES = {
  kalmora: { brand: 'Kalmora', generic: 'Paracetamol 500 mg', sub: '20 tablets', color: '#2f7fc1', accent: '#ffd23f', printed: 'EXP 03/2027', status: 'ok' },
  brevixa: { brand: 'Brevixa', generic: 'Ibuprofen 200 mg', sub: '24 coated tablets', color: '#d9534f', accent: '#fff3d6', printed: 'EXP: 2025-11', status: 'expired' },
  sunnest: { brand: 'SunNest', generic: 'Vitamin D3 1000 IU', sub: '60 softgels', color: '#f2a93b', accent: '#7a3b00', printed: 'Exp. 08.2026', status: 'expired' },
  nasovie: { brand: 'Nasovie', generic: 'Saline nasal spray', sub: '20 ml', color: '#3bb3a6', accent: '#ffffff', printed: 'Use by 12/2026', status: 'soon90' },
  allerisa: { brand: 'Allerisa', generic: 'Loratadine 10 mg', sub: '30 tablets', color: '#7b5ea7', accent: '#e9ddff', printed: 'EXP 01/2028', status: 'ok' },
  kalmora2: { brand: 'Kalmora', generic: 'Paracetamol 500 mg', sub: '16 tablets', color: '#2f7fc1', accent: '#ffd23f', printed: 'EXP: 2026-09', status: 'expired' },
  brevixa2: { brand: 'Brevixa', generic: 'Ibuprofen 200 mg', sub: '12 tablets', color: '#d9534f', accent: '#fff3d6', printed: 'Use by 12/2026', status: 'soon90' },
};

// Each scene: boxes with position/rotation, where the date is printed, and the background style.
const SCENES = [
  { id: '1-shelf-paracetamol', bg: 'shelf', blur: 0.7, glare: [62, 28], boxes: [{ k: 'kalmora', x: 0, ry: -24, rx: -4, date: 'front' }] },
  { id: '2-table-ibuprofen', bg: 'table', blur: 1.1, glare: [30, 40], boxes: [{ k: 'brevixa', x: 0, ry: 31, rx: -10, rz: -3, date: 'front' }] },
  { id: '3-shelf-vitamin', bg: 'shelf', blur: 0.9, glare: [75, 55], boxes: [{ k: 'sunnest', x: 0, ry: -35, rx: -6, date: 'front' }] },
  { id: '4-side-date-saline', bg: 'table', blur: 0.8, glare: [48, 20], boxes: [{ k: 'nasovie', x: 0, ry: -52, rx: -8, date: 'side' }] },
  {
    id: '5-three-boxes',
    bg: 'shelf',
    blur: 0.9,
    glare: [55, 35],
    boxes: [
      { k: 'allerisa', x: -430, ry: 22, rx: -4, date: 'front', scale: 0.85 },
      { k: 'kalmora2', x: 0, ry: -14, rx: -4, date: 'front', scale: 0.85 },
      { k: 'brevixa2', x: 430, ry: -30, rx: -4, date: 'front', scale: 0.85 },
    ],
  },
];

const W = 300, H = 420, D = 110;

function faceFront(b, date) {
  const stamp = date === 'front' ? `<div class="stamp">${b.printed}</div>` : '';
  return `<div class="face front" style="background:linear-gradient(160deg,#fff 0 38%,${b.color} 38% 100%)">
    <div class="brand" style="color:${b.color}">${b.brand}</div>
    <div class="gen">${b.generic}</div><div class="sub">${b.sub}</div>
    <div class="band" style="background:${b.accent}"></div>
    <div class="dot" style="background:${b.accent}"></div>
    ${stamp}</div>`;
}
function faceSide(b, date) {
  const small = date === 'side' ? `<div class="sidedate">${b.printed}</div>` : '';
  return `<div class="face side" style="background:${b.color}"><div class="sidetext">${b.brand} Â· ${b.generic}</div>${small}</div>`;
}
function box(b, o) {
  const s = o.scale || 1.5;
  return `<div class="boxwrap" style="left:calc(50% + ${o.x}px);top:${800 - Math.round(H * s)}px;transform:scale(${s})">
    <div class="shadow"></div>
    <div class="cuboid" style="transform:rotateX(${o.rx}deg) rotateY(${o.ry}deg) rotateZ(${o.rz || 0}deg)">
      ${faceFront(b, o.date)}
      <div class="face back" style="background:${b.color}"></div>
      ${faceSide(b, o.date).replace('class="face side"', 'class="face right"')}
      <div class="face left" style="background:${b.color}"></div>
      <div class="face top" style="background:${b.color}"></div>
    </div></div>`;
}

function page(scene) {
  const bg =
    scene.bg === 'shelf'
      ? `background:linear-gradient(#cfc7bb 0 66%,#8a6a47 66% 69%,#a07c52 69% 100%)`
      : `background:linear-gradient(#b9c2c6 0 40%,#d8c3a0 40% 100%)`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;width:1600px;height:1200px;overflow:hidden;font-family:Arial,Helvetica,sans-serif}
  #scene{position:relative;width:1600px;height:1200px;${bg};filter:blur(${scene.blur}px) contrast(1.04) saturate(.92);perspective:1500px;perspective-origin:50% 35%}
  .boxwrap{position:absolute;width:0;height:0;transform-style:preserve-3d}
  .shadow{position:absolute;left:-190px;top:${H - 25}px;width:380px;height:70px;border-radius:50%;background:radial-gradient(rgba(0,0,0,.5),rgba(0,0,0,0) 70%);filter:blur(6px)}
  .cuboid{position:absolute;left:${-W / 2}px;top:0;width:${W}px;height:${H}px;transform-style:preserve-3d}
  .face{position:absolute;box-sizing:border-box;backface-visibility:hidden;overflow:hidden;border:1px solid rgba(0,0,0,.18)}
  .front{width:${W}px;height:${H}px;transform:translateZ(${D / 2}px)}
  .back{width:${W}px;height:${H}px;transform:rotateY(180deg) translateZ(${D / 2}px)}
  .right{width:${D}px;height:${H}px;left:${(W - D) / 2}px;transform:rotateY(90deg) translateZ(${W / 2}px)}
  .left{width:${D}px;height:${H}px;left:${(W - D) / 2}px;transform:rotateY(-90deg) translateZ(${W / 2}px)}
  .top{width:${W}px;height:${D}px;top:${(H - D) / 2}px;transform:rotateX(90deg) translateZ(${H / 2}px);filter:brightness(1.12)}
  .brand{position:absolute;left:22px;top:26px;font:800 44px/1 Arial;letter-spacing:-1px}
  .gen{position:absolute;left:22px;top:190px;color:#fff;font:700 27px/1.15 Arial;width:250px}
  .sub{position:absolute;left:22px;top:262px;color:#fff;font:500 19px Arial;opacity:.95}
  .band{position:absolute;left:0;right:0;top:318px;height:10px}
  .dot{position:absolute;right:26px;top:70px;width:46px;height:46px;border-radius:50%;opacity:.9}
  .stamp{position:absolute;right:14px;bottom:14px;font:600 17px 'Courier New',monospace;color:#1b1b1b;background:rgba(255,255,255,.88);padding:2px 6px;letter-spacing:.5px}
  .sidetext{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(90deg);white-space:nowrap;color:#fff;font:700 20px Arial}
  .sidedate{position:absolute;left:36px;top:300px;transform:rotate(90deg);transform-origin:0 0;font:600 11px 'Courier New',monospace;color:#fff;white-space:nowrap}
  #glare{position:absolute;inset:0;background:radial-gradient(ellipse 300px 190px at ${scene.glare[0]}% ${scene.glare[1]}%,rgba(255,255,255,.55),rgba(255,255,255,0) 70%);pointer-events:none}
  #vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(0,0,0,0) 55%,rgba(0,0,0,.28));pointer-events:none}
  #noise{position:absolute;inset:0;opacity:.14;mix-blend-mode:multiply;pointer-events:none}
  </style></head><body><div id="scene">${scene.boxes.map((o) => box(BOXES[o.k], o)).join('')}
  <div id="glare"></div><div id="vig"></div>
  <svg id="noise" width="1600" height="1200"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>
  </div></body></html>`;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
const truth = {};
for (const s of SCENES) {
  const p = await ctx.newPage();
  await p.setContent(page(s));
  await p.screenshot({ path: path.join(OUT, `${s.id}.jpg`), type: 'jpeg', quality: 86 });
  truth[`${s.id}.jpg`] = s.boxes.map((o) => ({ name: BOXES[o.k].generic, brand: BOXES[o.k].brand, expiry: BOXES[o.k].printed, status: BOXES[o.k].status }));
  await p.close();
  console.log('wrote', s.id);
}
fs.writeFileSync(path.join(OUT, 'truth.json'), JSON.stringify({ today: '2026-10-24', photos: truth }, null, 2));
await browser.close();

