// Expiry parsing and status. Pure functions: the model only transcribes, all date maths happens here.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export const MONTH_ONLY_NOTE = 'Month-only dates are treated as the end of that month.';

const endOfMonth = (y, m) => new Date(Date.UTC(y, m, 0)); // m is 1-12
const fullYear = (y) => (y < 100 ? 2000 + y : y);

// Returns { date: Date (UTC midnight, last valid day), monthOnly } or null when unreadable.
export function parseExpiry(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw
    .toLowerCase()
    .replace(/\b(exp(iry|\.)?|expires?|use by|best before|bb|ed)\b[:.\s]*/g, ' ')
    .replace(/,/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let m;
  const dayOk = (d, mo, y) => mo >= 1 && mo <= 12 && d >= 1 && d <= endOfMonth(y, mo).getUTCDate();

  // 2026-10-31 or 2026/10/31
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    return dayOk(d, mo, y) ? { date: new Date(Date.UTC(y, mo - 1, d)), monthOnly: false } : null;
  }
  // 31/10/2026, 31.10.26 (day first)
  if ((m = s.match(/^(\d{1,2})[-/. ](\d{1,2})[-/. ](\d{2}|\d{4})$/))) {
    const [d, mo, y] = [+m[1], +m[2], fullYear(+m[3])];
    return dayOk(d, mo, y) ? { date: new Date(Date.UTC(y, mo - 1, d)), monthOnly: false } : null;
  }
  // 2026-10
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})$/))) {
    const [y, mo] = [+m[1], +m[2]];
    return mo >= 1 && mo <= 12 ? { date: endOfMonth(y, mo), monthOnly: true } : null;
  }
  // 03/2027, 03-27, 03 2027
  if ((m = s.match(/^(\d{1,2})[-/. ](\d{2}|\d{4})$/))) {
    const [mo, y] = [+m[1], fullYear(+m[2])];
    return mo >= 1 && mo <= 12 ? { date: endOfMonth(y, mo), monthOnly: true } : null;
  }
  // oct 2026, october 26
  if ((m = s.match(/^([a-z]{3,9})[-/. ]+(\d{2}|\d{4})$/))) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3));
    return idx >= 0 ? { date: endOfMonth(fullYear(+m[2]), idx + 1), monthOnly: true } : null;
  }
  // 2026 oct
  if ((m = s.match(/^(\d{4})[-/. ]+([a-z]{3,9})$/))) {
    const idx = MONTHS.indexOf(m[2].slice(0, 3));
    return idx >= 0 ? { date: endOfMonth(+m[1], idx + 1), monthOnly: true } : null;
  }
  return null;
}

const DAY = 86400000;

// today: Date or 'YYYY-MM-DD'. status is one of: expired | soon30 | soon90 | ok | unknown
export function statusFor(expiryRaw, today = new Date()) {
  const p = parseExpiry(expiryRaw);
  if (!p) return { status: 'unknown', monthOnly: false, iso: null, daysLeft: null };
  const t =
    typeof today === 'string'
      ? new Date(today + 'T00:00:00Z')
      : new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const daysLeft = Math.round((p.date - t) / DAY);
  const status = daysLeft < 0 ? 'expired' : daysLeft <= 30 ? 'soon30' : daysLeft <= 90 ? 'soon90' : 'ok';
  return { status, monthOnly: p.monthOnly, iso: p.date.toISOString().slice(0, 10), daysLeft };
}

export const STATUS_LABEL = {
  expired: 'Expired',
  soon30: 'Expires within 30 days',
  soon90: 'Expires within 90 days',
  ok: 'OK',
  unknown: 'Date not found, please check the box and enter it by hand.',
};
