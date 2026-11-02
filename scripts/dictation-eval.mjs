#!/usr/bin/env node
// Set de regresión del dictado clínico.
//   node scripts/dictation-eval.mjs            → solo reglas locales (sin red, sin costo)
//   node scripts/dictation-eval.mjs --ai       → además la cadena de Workers AI del deploy (login de wrangler)
//   node scripts/dictation-eval.mjs --openai   → además solo el respaldo OpenAI (gpt-4o-mini; clave en OPENAI_API_KEY del entorno)
// Opciones: --out <dir> (por defecto /workspace/gd-eval), --only c01,c02, --strict (sale con 1 si algo falla),
//   --model <id> (prueba un solo modelo, sin respaldo; para comparar 8B vs 70B).
// Nada se guarda en ninguna ficha: solo se comparan propuestas con lo esperado.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as P from '../lib/dictation/proposal.ts';
import { santiagoToday } from '../lib/dictation/spoken.ts';
import { summarize, compare } from './dictation-eval-lib.mjs';
import { runPatientIdentifyEval } from './patient-identify-eval.mjs';
import { createWorkersAiModel } from '../lib/dictation/workers-ai.ts';
import { openAiCostUsd } from '../lib/dictation/openai-structure.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const outDir = value('--out', '/workspace/gd-eval');
const only = value('--only', '').split(',').filter(Boolean);
const corpus = JSON.parse(readFileSync(join(root, 'tests/fixtures/dictation-corpus.json'), 'utf8'));
const cases = corpus.cases.filter((item) => !only.length || only.some((prefix) => item.id.startsWith(prefix)));

function aiModel(env, usage) {
  // --model <id> fuerza un solo modelo (para comparar 8B vs 70B sin respaldo).
  const forced = value('--model', '');
  const chain = forced ? [forced] : [P.WORKERS_AI_MODEL, ...P.WORKERS_AI_FALLBACKS];
  return {
    id: 'workers-ai',
    model: chain[0],
    async complete(input) {
      const failures = [];
      for (const model of chain) {
        try {
          const result = await env.AI.run(model, P.buildWorkersAiRequest(model, input));
          usage.push(model);
          return { usedModel: model, output: P.validateModelOutput(P.modelOutputToJson(result)) };
        } catch (cause) {
          failures.push(`${model}: ${String(cause?.message ?? cause).slice(0, 160)}`);
          if (P.isQuotaError(String(cause?.message ?? cause))) break;
        }
      }
      throw new Error(failures.join('; '));
    },
  };
}

async function runEngine(label, model) {
  const rows = [];
  for (const item of cases) {
    const logs = [];
    let outcome;
    try {
      outcome = await P.proposeFromTranscript({ transcript: item.text, chart: item.chart ?? [] }, model, (event, data) => logs.push(`${event} ${JSON.stringify(data ?? {}).slice(0, 200)}`), { today: corpus.today, timeoutMs: 90_000 });
    } catch (cause) {
      rows.push({ item, diffs: [{ field: 'error', missing: [], extra: [String(cause?.message ?? cause)] }], engine: 'error' });
      continue;
    }
    const actual = summarize(outcome.proposal, item.text, corpus.patient);
    const diffs = compare(item.expect, actual);
    // Si la IA falló y respondieron las reglas, el caso no cuenta como acierto de la IA.
    if (model && outcome.engine === 'reglas-locales') diffs.push({ field: 'engine', missing: ['ia+reglas'], extra: [`${outcome.engine}: ${outcome.notice}`] });
    rows.push({ item, diffs, engine: outcome.engine, model: outcome.model, ms: outcome.aiMs, actual, logs });
    process.stderr.write(`${label} ${item.id} ${diffs.length ? 'FALLA' : 'ok'}\n`);
  }
  return { label, rows, passed: rows.filter((row) => !row.diffs.length).length };
}

function section(result) {
  const lines = [`## ${result.label}: ${result.passed}/${result.rows.length} casos correctos`, ''];
  lines.push('| Caso | Resultado | Motor |', '|---|---|---|');
  for (const row of result.rows) lines.push(`| ${row.item.id} | ${row.diffs.length ? `**falla** (${row.diffs.map((d) => d.field).join(', ')})` : 'ok'} | ${row.model ?? row.engine}${row.ms ? ` · ${row.ms} ms` : ''} |`);
  const failing = result.rows.filter((row) => row.diffs.length);
  if (failing.length) lines.push('', '### Diferencias por campo', '');
  for (const row of failing) {
    lines.push(`**${row.item.id}** — «${row.item.text}»`, '');
    for (const diff of row.diffs) {
      lines.push(`- \`${diff.field}\`${diff.missing.length ? ` falta: ${diff.missing.map((v) => `\`${v}\``).join(', ')}` : ''}${diff.extra.length ? ` sobra: ${diff.extra.map((v) => `\`${String(v).slice(0, 220)}\``).join(', ')}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

const results = [await runEngine('Reglas locales', null)];
if (flag('--ai')) {
  const { getPlatformProxy } = await import(join(root, 'node_modules/wrangler/wrangler-dist/cli.js'));
  const proxy = await getPlatformProxy({ configPath: join(root, 'scripts/eval-wrangler.jsonc'), persist: false });
  try {
    const usage = [];
    results.push(await runEngine('IA (Workers AI) + validación', aiModel(proxy.env, usage)));
  } finally {
    await proxy.dispose();
  }
}

let openAiCostLine = '';
if (flag('--openai')) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('Falta OPENAI_API_KEY en el entorno.');
  const usages = [];
  const model = createWorkersAiModel(null, { totalMs: 60_000, openAi: { apiKey, model: value('--openai-model', ''), onUsage: (usage) => usages.push(usage) } });
  results.push(await runEngine('IA (OpenAI gpt-4o-mini) + validación', model));
  if (usages.length) {
    const prompt = usages.reduce((sum, u) => sum + u.prompt_tokens, 0) / usages.length;
    const completion = usages.reduce((sum, u) => sum + u.completion_tokens, 0) / usages.length;
    const total = usages.reduce((sum, u) => sum + openAiCostUsd(u), 0);
    openAiCostLine = `OpenAI: ${usages.length} llamadas, promedio ${Math.round(prompt)} tokens de entrada y ${Math.round(completion)} de salida; costo estimado ${(total / usages.length).toFixed(5)} USD por dictado (total ${total.toFixed(4)} USD).`;
  }
}

const identify = runPatientIdentifyEval();
const identifySection = [`## Identificación de paciente (nuevo vs existente, solo código): ${identify.passed}/${identify.rows.length}`, '', '| Caso | Resultado | Decisión |', '|---|---|---|',
  ...identify.rows.map((row) => `| ${row.item.id} | ${row.diffs.length ? `**falla** ${row.diffs.map((d) => `${d.field}: esperado ${JSON.stringify(d.expected)}, salió ${JSON.stringify(d.actual)}`).join('; ')}` : 'ok'} | ${row.result.decision}${row.result.suggestedPatientId ? ` → ${row.result.suggestedPatientId}` : ''} |`)].join('\n');

const day = santiagoToday();
const header = [
  `# Evaluación del dictado — ${day}`,
  '',
  `Corpus: tests/fixtures/dictation-corpus.json (${cases.length} casos, datos ficticios; fecha de referencia ${corpus.today}). Hora de Chile (America/Santiago).`,
  '',
  results.map((r) => `- ${r.label}: **${r.passed}/${r.rows.length}**`).join('\n'),
  ...(openAiCostLine ? ['', openAiCostLine] : []),
  '',
].join('\n');
const report = `${header}\n${results.map(section).join('\n\n')}\n\n${identifySection}\n`;
mkdirSync(outDir, { recursive: true });
const file = join(outDir, `report-${day}.md`);
writeFileSync(file, report);
console.log(results.map((r) => `${r.label}: ${r.passed}/${r.rows.length}`).join('\n'));
if (openAiCostLine) console.log(openAiCostLine);
console.log(`Identificación de paciente: ${identify.passed}/${identify.rows.length}`);
console.log(`Reporte: ${file}`);
if (flag('--strict') && (results.some((r) => r.passed < r.rows.length) || identify.passed < identify.rows.length)) process.exitCode = 1;
