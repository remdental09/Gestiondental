import test from "node:test";
import assert from "node:assert/strict";
import { pickLatinVoice, speakTextNow } from "../lib/dictation/speech.ts";

test("la voz de los avisos prefiere español de Chile o Latinoamérica y evita España", () => {
  const es = { lang: "es-ES", name: "España" }, mx = { lang: "es-MX", name: "México" }, cl = { lang: "es_CL", name: "Chile" }, en = { lang: "en-US" };
  assert.equal(pickLatinVoice([en, es, mx, cl]), cl);
  assert.equal(pickLatinVoice([en, es, mx]), mx);
  assert.equal(pickLatinVoice([en, es]), null);
  assert.equal(pickLatinVoice([{ lang: "es" }, es]).lang, "es");
});

test("la pregunta guiada se encola de inmediato y expone bloqueo de reproducción", () => {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const priorUtterance = Object.getOwnPropertyDescriptor(globalThis, "SpeechSynthesisUtterance");
  const calls = [];
  const utterances = [];
  class FakeUtterance {
    constructor(text) { this.text = text; }
  }
  const synthesis = {
    paused: false,
    cancel() { calls.push("cancel"); },
    getVoices() { return [{ lang: "es-CL" }]; },
    speak(utterance) { calls.push("speak"); utterances.push(utterance); },
    resume() { calls.push("resume"); },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: { speechSynthesis: synthesis } });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", { configurable: true, value: FakeUtterance });
  try {
    const errors = [];
    assert.equal(speakTextNow("¿Cuál es el diagnóstico de esta pieza?", { onError: error => errors.push(error) }), true);
    assert.deepEqual(calls, ["cancel", "speak"]);
    assert.equal(utterances[0].text, "¿Cuál es el diagnóstico de esta pieza?");
    assert.equal(utterances[0].lang, "es-CL");
    utterances[0].onerror({ error: "not-allowed" });
    assert.deepEqual(errors, ["not-allowed"]);
  } finally {
    if (priorWindow) Object.defineProperty(globalThis, "window", priorWindow);
    else delete globalThis.window;
    if (priorUtterance) Object.defineProperty(globalThis, "SpeechSynthesisUtterance", priorUtterance);
    else delete globalThis.SpeechSynthesisUtterance;
  }
});
