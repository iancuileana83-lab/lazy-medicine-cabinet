// Talks to the local Ollama server only (127.0.0.1). Transcription only: no advice, doses or interactions.
export const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
export const MODEL = process.env.LMC_MODEL || 'gemma3:4b';

export const PROMPT = `You are reading a photo of medicine packaging. Look at every separate medicine box, bottle or blister pack in the photo, one by one. For each one, copy exactly what is printed:
- "name": ALL the product text on the front, joined with a space: the brand name AND the medicine name AND the strength or size, in reading order. Example: "Brandname Paracetamol 500 mg". Copy the letters exactly, do not correct spelling.
- "expiry": the expiry date together with the words printed before it, copied character by character. Example: "EXP 03/2027" or "Use by 12/2026". Look at every face of the box, including small print on the sides. Copy the digits carefully. Use an empty string if you cannot read a date.
Do not describe what the medicine is for. Do not add doses, advice or warnings that are not printed. If you are unsure, leave the field empty. Answer with JSON only.`;

export const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, expiry: { type: 'string' } }, required: ['name', 'expiry'] },
    },
  },
  required: ['items'],
};

// Accepts the model's text, returns clean [{name, expiry}]; tolerant of code fences and junk.
export function parseModelOutput(text) {
  const s = String(text ?? '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return [];
    try {
      data = JSON.parse(s.slice(a, b + 1));
    } catch {
      return [];
    }
  }
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  const seen = new Set();
  return list
    .map((x) => ({ name: String(x?.name ?? '').trim(), expiry: String(x?.expiry ?? '').trim() }))
    .filter((x) => x.name || x.expiry)
    .filter((x) => {
      const k = (x.name + '|' + x.expiry).toLowerCase();
      return seen.has(k) ? false : seen.add(k);
    });
}

export async function scanImage(base64Jpeg, fetchImpl = fetch) {
  const r = await fetchImpl(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: SCHEMA,
      options: { temperature: 0, num_ctx: 4096 },
      messages: [{ role: 'user', content: PROMPT, images: [base64Jpeg] }],
    }),
  });
  if (!r.ok) throw new Error(`Ollama returned ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return parseModelOutput(j?.message?.content);
}
