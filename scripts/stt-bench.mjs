#!/usr/bin/env node
// Banco de pruebas de dictado: compara motores de transcripción con los mismos audios.
//
//   node --experimental-strip-types scripts/stt-bench.mjs --guion                      → escribe la hoja de lectura (para grabar)
//   node --experimental-strip-types scripts/stt-bench.mjs --audio <carpeta> [opciones] → transcribe y puntúa
//
// Audios: <carpeta>/<id>.(wav|mp3|m4a|mp4|webm|ogg|flac), con los id de tests/stt-bench/guion.json (op01, en03, ...).
// Claves por variable de entorno (nunca por argumento): OPENAI_API_KEY, ELEVENLABS_API_KEY, DEEPGRAM_API_KEY.
// Opciones:
//   --engines openai,elevenlabs,deepgram   (por defecto: los que tengan clave)
//   --keyterms                             añade el glosario dental como pistas (EL y Deepgram) — se puntúa aparte
//   --el-model scribe_v2                   modelo de ElevenLabs (verificar el ID del modelo médico en su documentación)
//   --dg-model nova-3                      modelo de Deepgram
//   --only op01,en02                       solo esos dictados
//   --out <carpeta>                        por defecto ./stt-bench-out (transcripciones cacheadas: repetir no vuelve a gastar)
//   --score-only                           no llama a ningún motor; solo puntúa lo ya guardado en --out
// Los audios y las transcripciones quedan en tu equipo; nada se guarda en fichas.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReport } from './stt-bench-lib.mjs';
import { transcribeDentalAudio } from '../lib/dictation/openai-transcription.ts';
import { DENTAL_SPEECH_HINTS } from '../lib/dictation/dental-lexicon.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

const guion = JSON.parse(readFileSync(join(root, 'tests/stt-bench/guion.json'), 'utf8'));
const only = value('--only', '').split(',').filter(Boolean);
const dictados = guion.dictados.filter((d) => !only.length || only.includes(d.id));
const outDir = resolve(value('--out', './stt-bench-out'));
const MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.flac': 'audio/flac' };

if (flag('--guion')) {
  mkdirSync(outDir, { recursive: true });
  const body = dictados.map((d) => `## ${d.id} · ${d.especialidad}${d.real ? ' · ⭐ GRABAR EN CONSULTA (ruido real)' : ''}\n\n${d.texto}\n`).join('\n');
  const file = join(outDir, 'guion-lectura.md');
  writeFileSync(file, `# Hoja de lectura del banco de dictado\n\nLee cada texto en voz alta como dictarías en consulta. Guarda el audio con el id como nombre (op01.m4a, en03.wav...). Los marcados ⭐ grábalos con el ruido real de la consulta.\n\n${body}`);
  console.log(`Hoja de lectura: ${file}`);
  process.exit(0);
}

// Pistas de glosario para los motores que las aceptan: frases cortas, sin duplicados.
function glossary(maxTerms, maxWords = 5, maxChars = 50) {
  const seen = new Set();
  const out = [];
  for (const { phrase } of DENTAL_SPEECH_HINTS) {
    const p = phrase.trim();
    if (!p || p.length > maxChars || p.split(/\s+/).length > maxWords || /[<>{}\[\]\\]/.test(p)) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key); out.push(p);
    if (out.length >= maxTerms) break;
  }
  return out;
}

const ENGINES = {
  async openai(file, mime) {
    const key = process.env.OPENAI_API_KEY; if (!key) throw new Error('Falta OPENAI_API_KEY');
    const blob = new Blob([readFileSync(file)], { type: mime });
    return (await transcribeDentalAudio(blob, key)).text; // exactamente lo que usa la app hoy
  },
  async elevenlabs(file, mime) {
    const key = process.env.ELEVENLABS_API_KEY; if (!key) throw new Error('Falta ELEVENLABS_API_KEY');
    const form = new FormData();
    form.append('file', new Blob([readFileSync(file)], { type: mime }), file.split('/').pop());
    form.append('model_id', value('--el-model', 'scribe_v2'));
    form.append('language_code', 'spa');
    form.append('tag_audio_events', 'false');
    if (flag('--keyterms')) for (const t of glossary(1000)) form.append('keyterms', t);
    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': key }, body: form, signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
    return (await res.json()).text ?? '';
  },
  async deepgram(file, mime) {
    const key = process.env.DEEPGRAM_API_KEY; if (!key) throw new Error('Falta DEEPGRAM_API_KEY');
    const q = new URLSearchParams({ model: value('--dg-model', 'nova-3'), language: 'es', smart_format: 'true' });
    if (flag('--keyterms')) for (const t of glossary(60, 4, 40)) q.append('keyterm', t); // tope de 500 tokens por solicitud
    const res = await fetch(`https://api.deepgram.com/v1/listen?${q}`, { method: 'POST', headers: { Authorization: `Token ${key}`, 'Content-Type': mime }, body: readFileSync(file), signal: AbortSignal.timeout(180_000) });
    if (!res.ok) throw new Error(`Deepgram ${res.status}`);
    return (await res.json()).results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '';
  },
};
const KEYS = { openai: 'OPENAI_API_KEY', elevenlabs: 'ELEVENLABS_API_KEY', deepgram: 'DEEPGRAM_API_KEY' };

const suffix = flag('--keyterms') ? '+glosario' : '';
const label = (engine) => (engine === 'openai' ? 'openai (app actual)' : engine === 'elevenlabs' ? `elevenlabs ${value('--el-model', 'scribe_v2')}${suffix}` : `deepgram ${value('--dg-model', 'nova-3')}${suffix}`);
const folder = (engine) => join(outDir, label(engine).replace(/[^\w+.-]+/g, '_'));

const scoreOnly = flag('--score-only');
const audioDir = value('--audio', '');
if (!scoreOnly && !audioDir) { console.error('Uso: --audio <carpeta con los audios> (o --score-only / --guion). Ver el encabezado del script.'); process.exit(2); }
const wanted = value('--engines', '').split(',').filter(Boolean);
const engines = (wanted.length ? wanted : Object.keys(ENGINES).filter((e) => process.env[KEYS[e]])).filter((e) => e in ENGINES);
if (!scoreOnly && !engines.length) { console.error('No hay motores: define OPENAI_API_KEY, ELEVENLABS_API_KEY y/o DEEPGRAM_API_KEY.'); process.exit(2); }

const audioFiles = {};
if (audioDir) for (const f of readdirSync(resolve(audioDir))) { const ext = extname(f).toLowerCase(); if (MIME[ext]) audioFiles[f.slice(0, -ext.length)] = join(resolve(audioDir), f); }

const results = {};
const toScore = scoreOnly ? readdirSync(outDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => ({ name: d.name, dir: join(outDir, d.name) }))
  : engines.map((e) => ({ name: label(e), dir: folder(e), engine: e }));

for (const { name, dir, engine } of toScore) {
  mkdirSync(dir, { recursive: true });
  results[name] = {};
  for (const d of dictados) {
    const cache = join(dir, `${d.id}.txt`);
    if (existsSync(cache)) { results[name][d.id] = readFileSync(cache, 'utf8'); continue; }
    if (scoreOnly || !engine || !audioFiles[d.id]) continue;
    try {
      const text = await ENGINES[engine](audioFiles[d.id], MIME[extname(audioFiles[d.id]).toLowerCase()]);
      writeFileSync(cache, text); results[name][d.id] = text;
      process.stderr.write(`✓ ${name} ${d.id}\n`);
    } catch (error) { process.stderr.write(`✗ ${name} ${d.id}: ${error.message}\n`); }
  }
}

const report = buildReport(dictados, results);
const file = join(outDir, 'informe.md');
writeFileSync(file, `# Informe del banco de dictado\n\n${report.markdown}\n`);
console.log(report.markdown);
console.log(`\nInforme guardado en ${file}`);
