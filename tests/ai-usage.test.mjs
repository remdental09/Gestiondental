import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aiAllowed, chileDay, limitsFrom, limitsFor, overLimit, recordAiUsage, usageCollector, approxAudioSeconds, DEFAULT_AI_LIMITS, AI_LIMIT_MESSAGE } from "../lib/ai-usage.ts";

function fakeDb() {
  const rows = new Map();
  const calls = [];
  return {
    rows, calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async first() { return rows.get(`${values[0]}|${values[1]}`) ?? null; },
            async run() {
              const [owner, day, c, i, o, a] = values;
              const prev = rows.get(`${owner}|${day}`) ?? { calls: 0, input_tokens: 0, output_tokens: 0, audio_seconds: 0 };
              rows.set(`${owner}|${day}`, { calls: prev.calls + c, input_tokens: prev.input_tokens + i, output_tokens: prev.output_tokens + o, audio_seconds: prev.audio_seconds + a });
            },
          };
        },
      };
    },
  };
}

test("el día se cuenta en hora de Chile", () => {
  // 02:30 UTC del 22 = 23:30 del 21 en Santiago (UTC-3).
  assert.equal(chileDay(new Date("2026-11-22T02:30:00Z")), "2026-11-21");
  assert.equal(chileDay(new Date("2026-11-22T03:30:00Z")), "2026-11-22");
});

test("topes desde el entorno, con valores de fábrica si faltan o son inválidos", () => {
  assert.deepEqual(limitsFrom(undefined), DEFAULT_AI_LIMITS);
  assert.deepEqual(limitsFrom({ AI_DAILY_CALLS: "50", AI_DAILY_TOKENS: "abc", AI_DAILY_AUDIO_MINUTES: "30" }), { calls: 50, tokens: DEFAULT_AI_LIMITS.tokens, audioSeconds: 1800 });
});

test("overLimit por llamadas, tokens o audio", () => {
  const limits = { calls: 3, tokens: 100, audioSeconds: 60 };
  assert.equal(overLimit(null, limits), false);
  assert.equal(overLimit({ calls: 3, input_tokens: 0, output_tokens: 0, audio_seconds: 0 }, limits), true);
  assert.equal(overLimit({ calls: 1, input_tokens: 60, output_tokens: 40, audio_seconds: 0 }, limits), true);
  assert.equal(overLimit({ calls: 1, input_tokens: 0, output_tokens: 0, audio_seconds: 90 }, limits, "text"), false);
  assert.equal(overLimit({ calls: 1, input_tokens: 0, output_tokens: 0, audio_seconds: 90 }, limits, "audio"), true);
});

test("registra por cuenta y día y corta al llegar al tope; cada cuenta por separado", async () => {
  const db = fakeDb();
  const now = new Date("2026-11-21T15:00:00Z");
  const limits = { calls: 2, tokens: 1_000_000, audioSeconds: 600 };
  assert.equal(await aiAllowed(db, "ana", limits, "text", now), true);
  await recordAiUsage(db, "ana", { inputTokens: 1000, outputTokens: 200 }, now);
  await recordAiUsage(db, "ana", { calls: 1 }, now);
  assert.equal(await aiAllowed(db, "ana", limits, "text", now), false);
  assert.equal(await aiAllowed(db, "beto", limits, "text", now), true);
  assert.equal(await aiAllowed(db, "ana", limits, "text", new Date("2026-11-22T15:00:00Z")), true);
  assert.deepEqual(db.rows.get("ana|2026-11-21"), { calls: 2, input_tokens: 1000, output_tokens: 200, audio_seconds: 0 });
  for (const { sql } of db.calls) assert.match(sql, /owner_id/);
});

test("si D1 falla, se permite usar IA y el registro no lanza", async () => {
  const broken = { prepare() { throw new Error("no such table: ai_usage"); } };
  assert.equal(await aiAllowed(broken, "ana", DEFAULT_AI_LIMITS), true);
  await recordAiUsage(broken, "ana", { calls: 1 });
  assert.equal(await aiAllowed(null, "ana", DEFAULT_AI_LIMITS), true);
});

test("acumulador de tokens y audio aproximado", () => {
  const usage = usageCollector();
  usage.onUsage({ prompt_tokens: 100, completion_tokens: 20 });
  usage.onUsage({ prompt_tokens: 50 });
  assert.deepEqual(usage.total, { inputTokens: 150, outputTokens: 20, calls: 2 });
  assert.equal(approxAudioSeconds(80_000), 10);
  assert.equal(approxAudioSeconds(10), 1);
});

test("mensaje amable en español y migración aditiva", () => {
  assert.match(AI_LIMIT_MESSAGE, /límite diario/);
  assert.match(AI_LIMIT_MESSAGE, /a mano/);
  const sql = readFileSync(new URL("../drizzle/0015_ai_usage.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /\b(DROP|ALTER|DELETE|UPDATE)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS `ai_usage`/);
});

test("las rutas de IA consultan el tope antes de llamar al modelo", () => {
  for (const route of ["dictation/structure", "audio-transcription", "text-correction", "dictation/tooth-answer", "anamnesis", "auditoria"]) {
    const src = readFileSync(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(src, /aiLimitResponse|aiWithinLimit/, route);
    assert.match(src, /trackAi/, route);
  }
});

test("la corrección deja el prefijo fijo primero y el contexto variable al final", () => {
  const src = readFileSync(new URL("../lib/dictation/openai-correction.ts", import.meta.url), "utf8");
  const content = src.slice(src.indexOf('role: "system"'));
  assert.ok(content.indexOf("${dentalDictionaryHints()}") < content.indexOf("${specialtyContext"));
  assert.ok(content.indexOf("${TOOTH_NUMBERING_PROMPT}") < content.indexOf("${specialtyContext"));
});

test("limitsFor: solo los correos de AI_DEVELOPER_EMAILS tienen más cupo; el resto queda con el tope de siempre", () => {
  const env = { AI_DEVELOPER_EMAILS: " Dev@Ejemplo.cl, otro@ejemplo.cl " };
  const dev = limitsFor(env, "dev@ejemplo.cl");
  assert.equal(dev.calls, 1000);
  assert.equal(dev.tokens, 15_000_000);
  assert.deepEqual(limitsFor(env, "alguien@ejemplo.cl"), limitsFrom(env));
  assert.deepEqual(limitsFor(env, null), limitsFrom(env));
  assert.deepEqual(limitsFor({}, "dev@ejemplo.cl"), limitsFrom({}));
});

test("limitsFor: el cupo de desarrollo se puede cambiar y nunca baja del tope normal", () => {
  const env = { AI_DEVELOPER_EMAILS: "dev@ejemplo.cl", AI_DEVELOPER_DAILY_CALLS: "1500", AI_DAILY_CALLS: "2000" };
  assert.equal(limitsFor(env, "dev@ejemplo.cl").calls, 2000);
  assert.equal(limitsFor({ ...env, AI_DAILY_CALLS: "400" }, "dev@ejemplo.cl").calls, 1500);
});

test("la pantalla de evaluación por pieza titula el límite de IA como tal y no como un problema del micrófono", () => {
  const source = readFileSync(new URL("../components/tooth-dictation.tsx", import.meta.url), "utf8");
  assert.match(source, /l\[ií\]mite diario de IA\/i\.test\(speechError\)/);
  assert.match(source, /"Llegaste al límite diario de IA" : "Revisa el micrófono"/);
});
