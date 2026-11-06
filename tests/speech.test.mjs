import test from "node:test";
import assert from "node:assert/strict";
import { pickLatinVoice } from "../lib/dictation/speech.ts";

test("la voz de los avisos prefiere español de Chile o Latinoamérica y evita España", () => {
  const es = { lang: "es-ES", name: "España" }, mx = { lang: "es-MX", name: "México" }, cl = { lang: "es_CL", name: "Chile" }, en = { lang: "en-US" };
  assert.equal(pickLatinVoice([en, es, mx, cl]), cl);
  assert.equal(pickLatinVoice([en, es, mx]), mx);
  assert.equal(pickLatinVoice([en, es]), null);
  assert.equal(pickLatinVoice([{ lang: "es" }, es]).lang, "es");
});
