import test from 'node:test';
import assert from 'node:assert/strict';
import { parseModelOutput, scanImage, PROMPT } from '../lib/extract.mjs';

test('parses clean JSON, code fences and surrounding chatter', () => {
  const want = [{ name: 'Ibuprofen 200 mg', expiry: 'EXP 03/2027' }];
  const raw = JSON.stringify({ items: want });
  assert.deepEqual(parseModelOutput(raw), want);
  assert.deepEqual(parseModelOutput('```json\n' + raw + '\n```'), want);
  assert.deepEqual(parseModelOutput('Here you go: ' + raw + ' Hope that helps'), want);
});

test('drops empty and duplicate lines, survives garbage', () => {
  const raw = JSON.stringify({ items: [{ name: 'A', expiry: '' }, { name: 'a', expiry: '' }, { name: '', expiry: '' }, { name: 5 }] });
  assert.equal(parseModelOutput(raw).length, 2);
  assert.deepEqual(parseModelOutput('not json'), []);
  assert.deepEqual(parseModelOutput(undefined), []);
});

test('scanImage only calls the local Ollama and sends the image', async () => {
  let seen;
  const fake = async (url, init) => {
    seen = { url, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ message: { content: '{"items":[{"name":"X","expiry":"01/2030"}]}' } }) };
  };
  const out = await scanImage('QUJD', fake);
  assert.match(seen.url, /^http:\/\/127\.0\.0\.1:11434\//);
  assert.deepEqual(seen.body.messages[0].images, ['QUJD']);
  assert.equal(seen.body.options.temperature, 0);
  assert.deepEqual(out, [{ name: 'X', expiry: '01/2030' }]);
});

test('the prompt asks for transcription only', () => {
  assert.match(PROMPT, /Do not add doses, advice or warnings/);
});
