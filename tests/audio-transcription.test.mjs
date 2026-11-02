import test from 'node:test';
import assert from 'node:assert/strict';
import { transcribeDentalAudio, MAX_AUDIO_BYTES } from '../lib/dictation/openai-transcription.ts';
import { createAudioTranscription } from '../lib/dictation/audio-transcription.ts';

const audio = () => new Blob([new Uint8Array(500)], { type: 'audio/webm;codecs=opus' });
test('server sends audio with dental context and Spanish hints, never the secret in the form', async () => {
  let request;
  const result = await transcribeDentalAudio(audio(), 'test-secret', { fetcher: async (url, init) => { request = { url, init }; return Response.json({ text: 'Destartraje subgingival en seis sextantes.' }); } });
  assert.equal(result.text, 'Destartraje subgingival en seis sextantes.');
  assert.equal(request.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(request.init.headers.Authorization, 'Bearer test-secret');
  assert.equal(request.init.body.get('model'), 'gpt-transcribe');
  assert.deepEqual(request.init.body.getAll('languages[]'), ['es']);
  assert.ok(request.init.body.getAll('keywords[]').includes('destartraje subgingival'));
  assert.equal(request.init.body.get('file').name, 'dictado.webm');
  assert.equal([...request.init.body.values()].some(v => String(v).includes('test-secret')), false);
});
test('server rejects empty, oversized and unsupported files before calling the provider', async () => {
  const fetcher = () => { throw new Error('should not fetch'); };
  for (const blob of [new Blob([], { type: 'audio/webm' }), new Blob(['text'], { type: 'text/plain' }), new Blob([new Uint8Array(MAX_AUDIO_BYTES + 1)], { type: 'audio/webm' })]) {
    await assert.rejects(transcribeDentalAudio(blob, 'secret', { fetcher }), /Audio vacío/);
  }
});
test('provider failure and silence are explicit; provider body is not leaked', async () => {
  await assert.rejects(transcribeDentalAudio(audio(), 'secret', { fetcher: async () => new Response('private-provider-body', { status: 429 }) }), /límite|saldo/);
  await assert.rejects(transcribeDentalAudio(audio(), 'secret', { fetcher: async () => Response.json({ text: '' }) }), /No se reconoció voz/);
});

let recorder;
let clock = 1000;
class Recorder {
  static isTypeSupported(type) { return type.startsWith('audio/mp4'); }
  constructor(_stream, options) { recorder = this; this.mimeType = options.mimeType; this.state = 'inactive'; }
  start() { this.state = 'recording'; }
  stop() { this.state = 'inactive'; clock += 1000; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob([new Uint8Array(500)], { type: this.mimeType }) }); this.onstop?.(); }); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
async function environment(callback) {
  const original = { fetch: globalThis.fetch, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), window: globalThis.window, MediaRecorder: globalThis.MediaRecorder, now: Date.now };
  let stops = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() { stops++; } }] }) } } });
  globalThis.window = {}; globalThis.MediaRecorder = Recorder; Date.now = () => clock;
  try { await callback(() => stops); }
  finally { globalThis.fetch = original.fetch; Object.defineProperty(globalThis, 'navigator', original.navigator); globalThis.window = original.window; globalThis.MediaRecorder = original.MediaRecorder; Date.now = original.now; }
}
test('recording waits for audio transcription before ending and preserves the existing text', async () => environment(async stops => {
  const events = []; let release;
  globalThis.fetch = async (url, init) => url === '/api/audio-transcription' && !init.method ? Response.json({ available: true }) : new Promise(resolve => { release = resolve; });
  const engine = createAudioTranscription();
  engine.start('Nota previa.', { onStatus: s => events.push(s), onTranscript: text => events.push(text), onError: e => events.push(e), onEnd: () => events.push('ended') });
  await tick(); assert.equal(recorder.mimeType, 'audio/mp4');
  engine.stop(); await tick(); assert.ok(stops() > 0); assert.ok(events.includes('transcribing')); assert.ok(!events.includes('ended'));
  release(Response.json({ text: 'Pulpectomía.' })); await tick();
  assert.deepEqual(events.slice(-3), ['Nota previa. Pulpectomía.', 'idle', 'ended']); engine.abort();
}));
test('failure keeps the same audio for retry; repeated retry cannot submit twice', async () => environment(async () => {
  let calls = 0; const texts = []; let release;
  globalThis.fetch = async (_url, init) => !init.method ? Response.json({ available: true }) : (++calls === 1 ? Response.json({ error: 'sin saldo' }, { status: 429 }) : new Promise(resolve => { release = resolve; }));
  const engine = createAudioTranscription();
  engine.start('', { onTranscript: s => texts.push(s), onError: () => {}, onEnd: () => texts.push('ended') });
  await tick(); engine.stop(); await tick(); assert.equal(engine.hasPendingAudio(), true); assert.deepEqual(texts, []);
  engine.retry(); engine.retry(); await tick(); assert.equal(calls, 2);
  release(Response.json({ text: 'Encía.' })); await tick(); assert.deepEqual(texts, ['Encía.', 'ended']); assert.equal(engine.hasPendingAudio(), false); engine.abort();
}));
test('abort during upload prevents callbacks from modifying a closed or different chart', async () => environment(async () => {
  let release; const texts = [];
  globalThis.fetch = async (_url, init) => !init.method ? Response.json({ available: true }) : new Promise(resolve => { release = resolve; });
  const engine = createAudioTranscription(); engine.start('', { onTranscript: s => texts.push(s), onError: s => texts.push(s), onEnd: () => texts.push('ended') });
  await tick(); engine.stop(); await tick(); engine.abort(); release(Response.json({ text: 'Respuesta tardía.' })); await tick(); assert.deepEqual(texts, []);
}));
test('missing configuration never opens the microphone', async () => environment(async stops => {
  const events = []; let mediaCalls = 0;
  navigator.mediaDevices.getUserMedia = async () => { mediaCalls++; throw new Error('should not capture'); };
  globalThis.fetch = async () => Response.json({ available: false });
  const engine = createAudioTranscription(); engine.start('', { onTranscript: () => {}, onError: e => events.push(e), onEnd: () => events.push('ended') }); await tick();
  assert.equal(mediaCalls, 0); assert.match(events[0], /OPENAI_API_KEY/); assert.equal(engine.hasPendingAudio(), false); assert.equal(stops(), 0); engine.abort();
}));
