import { statusFor, STATUS_LABEL } from '/lib/status.mjs';
import { todayISO, addMonths, formatDate, isDue, summarize, view, bagLists, timeLeft } from '/lib/inventory.mjs';

const $ = (id) => document.getElementById(id);
const today = todayISO();
let state = { items: [], nextCheck: null };

const SUMMARY = [
  ['expired', 'Expired'],
  ['soon30', 'Expires within 30 days'],
  ['soon90', 'Expires within 90 days'],
  ['ok', 'OK'],
];

const icon = (name) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'ico');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
};
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const save = () =>
  fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });

// ---------- Cabinet ----------
function renderSummary() {
  const c = summarize(state.items, today);
  const filter = $('filter').value;
  $('summary').replaceChildren(
    ...SUMMARY.map(([key, label]) => {
      const b = el('button', { type: 'button', className: `sum s-${key}` });
      b.dataset.status = key;
      b.setAttribute('aria-pressed', String(filter === key));
      b.append(el('span', { className: 'n', textContent: String(c[key]) }), el('span', { className: 'l' }, icon(key), label));
      b.addEventListener('click', () => {
        $('filter').value = filter === key ? 'all' : key; // click again to clear the filter
        renderCabinet();
      });
      return b;
    }),
  );
  $('summary-unknown').hidden = c.unknown === 0;
  $('summary-unknown').textContent = `Date not found: ${c.unknown}. Please check these boxes by hand.`;
  $('reminder').hidden = c.expired === 0;
}

const photoUrl = (p) => (p.startsWith('demo:') ? `/demo-photos/${p.slice(5)}` : `/photos/${p}`);

// The product name is a textarea that grows with its text, so long names are never cut off.
const grow = (t) => {
  t.style.height = 'auto';
  t.style.height = `${t.scrollHeight + (t.offsetHeight - t.clientHeight)}px`; // content plus the border, so nothing is clipped
};

function renderRows() {
  const rows = view(state.items, today, { filter: $('filter').value, sort: $('sort').value });
  $('rows').replaceChildren(
    ...rows.map(({ item, index, st }) => {
      const tr = el('tr', { className: st.status === 'expired' ? 'r-expired' : st.status === 'soon30' ? 'r-soon30' : '' });
      const field = (k, label) => {
        const inp = k === 'name' ? el('textarea', { rows: 1, value: item.name }) : el('input', { type: 'text', value: item[k] });
        inp.setAttribute('aria-label', label);
        inp.dataset.k = k;
        if (k === 'name') {
          inp.addEventListener('input', () => grow(inp));
          inp.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), inp.blur())); // names are one line of text
        }
        inp.addEventListener('change', () => {
          state.items[index][k] = inp.value;
          save();
          renderAll();
        });
        const td = el('td', {}, inp);
        td.dataset.label = k === 'name' ? 'Product name (as printed)' : 'Expiry (as printed)';
        return td;
      };
      const photoTd = el('td');
      photoTd.dataset.label = '';
      if (item.photo) {
        const btn = el('button', { type: 'button', className: 'thumb' }, el('img', { src: photoUrl(item.photo), alt: 'Photo this line was read from. Click to enlarge.', loading: 'lazy' }));
        btn.addEventListener('click', () => openPhoto(photoUrl(item.photo)));
        photoTd.append(btn);
      }
      const badge = el('span', { className: `badge ${st.status}` }, icon(st.status), STATUS_LABEL[st.status]);
      const statusTd = el('td', {}, badge);
      if (st.status !== 'unknown') statusTd.append(el('div', { className: 'left', textContent: timeLeft(st.daysLeft) }));
      statusTd.dataset.label = 'Status';
      const rm = el('button', { type: 'button', className: 'btn remove', textContent: 'Remove' });
      rm.addEventListener('click', () => {
        state.items.splice(index, 1); // the server deletes the photo once no line uses it
        save();
        renderAll();
      });
      tr.append(photoTd, field('name', 'Product name'), field('expiry', 'Expiry date'), statusTd, el('td', {}, rm));
      return tr;
    }),
  );
  $('rows').querySelectorAll('textarea').forEach(grow);
  $('table').hidden = state.items.length === 0;
  $('empty').hidden = state.items.length > 0;
  $('demo-banner').hidden = !state.items.some((i) => i.demo);
}
window.addEventListener('resize', () => $('rows').querySelectorAll('textarea').forEach(grow));

// ---------- Photo viewer ----------
function openPhoto(url) {
  $('lb-img').src = url;
  $('lightbox').hidden = false;
  $('lb-close').focus();
}
const closePhoto = () => {
  $('lightbox').hidden = true;
  $('lb-img').removeAttribute('src');
};
$('lb-close').addEventListener('click', closePhoto);
$('lightbox').addEventListener('click', (e) => e.target === $('lightbox') && closePhoto());
document.addEventListener('keydown', (e) => e.key === 'Escape' && !$('lightbox').hidden && closePhoto());

// ---------- Demo cabinet ----------
$('demo-load').addEventListener('click', async () => {
  const { items } = await (await fetch('/api/demo')).json();
  state.items.push(...items);
  await save();
  renderAll();
});
$('demo-remove').addEventListener('click', () => {
  state.items = state.items.filter((i) => !i.demo); // your own lines stay
  save();
  renderAll();
});

const renderCabinet = () => {
  renderSummary();
  renderRows();
};

// ---------- Next check ----------
function renderNextCheck() {
  $('nextcheck-text').textContent = `Next check: ${formatDate(state.nextCheck)}`;
  $('nextcheck-due').hidden = !isDue(state.nextCheck, today);
  $('nextcheck-input').value = state.nextCheck;
}
$('nextcheck-change').addEventListener('click', () => {
  $('nextcheck-input').hidden = !$('nextcheck-input').hidden;
});
$('nextcheck-input').addEventListener('change', (e) => {
  if (!e.target.value) return;
  state.nextCheck = e.target.value;
  save();
  renderNextCheck();
});

// ---------- Pharmacy bag ----------
function renderBag() {
  const { expired, unknown } = bagLists(state.items, today);
  const li = ({ item }, withDate) =>
    el('li', {}, el('span', { className: 'nm', textContent: item.name || '(no name)' }), el('span', { className: 'ex', textContent: item.expiry ? `Printed: ${item.expiry}` : '' }));
  $('bag-list').replaceChildren(...expired.map((r) => li(r)));
  $('bag-empty').hidden = expired.length > 0;
  $('bag-unknown').replaceChildren(...unknown.map((r) => li(r)));
  $('bag-unknown-wrap').hidden = unknown.length === 0;
  $('bag-count').hidden = expired.length === 0;
  $('bag-count').textContent = String(expired.length);
  $('printhead').textContent = `Take-back list, printed ${formatDate(today)}`;
}
$('print').addEventListener('click', () => window.print());

// ---------- Tabs ----------
function showTab(name) {
  document.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  for (const n of ['cabinet', 'bag', 'about']) $(`panel-${n}`).hidden = n !== name;
  history.replaceState(null, '', name === 'cabinet' ? location.pathname : `#${name}`);
}
document.querySelectorAll('[role=tab]').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

// ---------- Actions ----------
$('filter').addEventListener('change', renderCabinet);
$('sort').addEventListener('change', renderCabinet);
$('add').addEventListener('click', () => {
  state.items.push({ name: '', expiry: '' });
  $('filter').value = 'all';
  save();
  renderAll();
});
$('clear').addEventListener('click', () => {
  $('confirm').hidden = false;
  $('clear').hidden = true;
});
$('confirm-no').addEventListener('click', () => {
  $('confirm').hidden = true;
  $('clear').hidden = false;
});
$('confirm-yes').addEventListener('click', () => {
  state.items = [];
  save();
  $('confirm').hidden = true;
  $('clear').hidden = false;
  renderAll();
});

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

$('photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('state').textContent = 'Reading the labels with the local model. This can take a minute or two on a laptop CPU...';
  try {
    const image = await toJpeg(file);
    const r = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    state.items = j.state.items; // the server added the new lines and kept the photo
    renderAll();
    $('state').textContent = j.added ? `Found ${j.added} line(s). Please check each one against the real box.` : 'No medicines found in that photo. You can add lines by hand.';
  } catch (err) {
    $('state').textContent = err.message;
  }
  e.target.value = '';
});

function renderAll() {
  renderCabinet();
  renderBag();
}

// ---------- Start ----------
state = await (await fetch('/api/state')).json();
if (!state.nextCheck) {
  state.nextCheck = addMonths(today, 3); // default: three months from the first visit
  save();
}
renderNextCheck();
renderAll();
showTab(['bag', 'about'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'cabinet');
