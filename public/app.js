import { statusFor, STATUS_LABEL } from './status.js';

const rows = document.getElementById('rows');
const state = document.getElementById('state');
const reminder = document.getElementById('reminder');
const empty = document.getElementById('empty');
let items = [];

const save = () =>
  fetch('/api/items', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) });

function render() {
  rows.innerHTML = '';
  let anyExpired = false;
  items.forEach((it, i) => {
    const st = statusFor(it.expiry);
    if (st.status === 'expired') anyExpired = true;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><input type="text" data-k="name" aria-label="Product name"></td>
      <td><input type="text" data-k="expiry" aria-label="Expiry date"></td>
      <td><span class="badge ${st.status}"></span></td>
      <td><button class="btn danger" type="button">Remove</button></td>`;
    tr.querySelectorAll('input').forEach((inp) => {
      inp.value = it[inp.dataset.k];
      inp.addEventListener('change', () => {
        items[i][inp.dataset.k] = inp.value;
        save();
        render();
      });
    });
    tr.querySelector('.badge').textContent = STATUS_LABEL[st.status];
    tr.querySelector('button').addEventListener('click', () => {
      items.splice(i, 1);
      save();
      render();
    });
    rows.append(tr);
  });
  reminder.hidden = !anyExpired;
  empty.hidden = items.length > 0;
}

// Shrink the photo in the browser: smaller images are much faster on a CPU-only laptop.
function toJpeg(file, max = 1024) {
  return new Promise((ok, no) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ok(c.toDataURL('image/jpeg', 0.9).split(',')[1]);
    };
    img.onerror = () => no(new Error('Could not open that image'));
    img.src = URL.createObjectURL(file);
  });
}

document.getElementById('photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  state.textContent = 'Reading the labels with the local model. This can take a minute or two on a laptop CPU...';
  try {
    const image = await toJpeg(file);
    const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    items.push(...j.items);
    await save();
    render();
    state.textContent = j.items.length ? `Found ${j.items.length} line(s). Please check each one against the real box.` : 'No medicines found in that photo. You can add lines by hand.';
  } catch (err) {
    state.textContent = err.message;
  }
  e.target.value = '';
});

document.getElementById('add').addEventListener('click', () => {
  items.push({ name: '', expiry: '' });
  save();
  render();
});

items = await (await fetch('/api/items')).json();
render();
