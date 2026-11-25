import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { CAPTURE_URL, createCaptureLink, newCaptureSession, readStatus } from "../lib/capture-bridge.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = "0123456789abcdef0123456789abcdef", ID2 = "fedcba9876543210fedcba9876543210";
const info = { app: "capturadora-speakdent", version: "0.2", visor: "Blue Sky Plan", tecla: "F8" };
const json = data => new Response(JSON.stringify(data), { status: 200 });

/** Capturadora simulada: entrega las respuestas de /esperar en orden y después deja la espera abierta. */
function fake(waits) {
  const calls = [];
  const fetcher = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    calls.push(`${init.method} ${pathname}${searchParams.get("id") ? " " + searchParams.get("id") : ""}`);
    assert.equal(init.credentials, "omit");
    assert.match(searchParams.get("sesion"), /^[0-9a-f]{32}$/);
    if (pathname === "/escuchar") return json({ ok: true, ...info });
    if (pathname === "/imagen") return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } });
    if (pathname !== "/esperar") return json({ ok: true });
    const next = waits.shift();
    if (next) return json({ ...info, ...next });
    return new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("abort"))));
  };
  return { calls, fetcher };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
function open(waits, save = async () => "saved") {
  const server = fake(waits), states = [], problems = [], saved = [];
  const link = createCaptureLink({
    fetcher: server.fetcher, wait: async () => {}, onState: state => states.push(state.kind), onProblem: message => problems.push(message),
    save: async file => { saved.push(file); return save(saved.length); },
  });
  return { ...server, link, states, problems, saved };
}

test("capturadora: solo habla con este computador y usa una sesión distinta por ficha", () => {
  assert.equal(CAPTURE_URL, "http://127.0.0.1:47821");
  assert.notEqual(newCaptureSession(), newCaptureSession());
  assert.equal(readStatus({ app: "otra-cosa" }), null);
  assert.equal(readStatus(null), null);
  assert.deepEqual(readStatus({ ...info, activa: true, capturas: [{ id: ID, visor: "Blue Sky Plan" }, { id: "../x" }, null] }).captures, [{ id: ID, viewer: "Blue Sky Plan" }]);
});

test("capturadora: una captura se guarda una vez y se confirma después de guardarla", async () => {
  const run = open([{ activa: true, capturas: [{ id: ID }] }, { activa: true, capturas: [{ id: ID }] }]);
  assert.equal(await run.link.connect(), true);
  await settle();
  assert.equal(run.saved.length, 1);
  assert.equal(run.saved[0].type, "image/png");
  assert.ok(run.calls.indexOf(`GET /imagen ${ID}`) < run.calls.indexOf(`POST /recibida ${ID}`));
  assert.equal(run.states.at(-1), "receiving");
  run.link.stop();
});

test("capturadora: si la ficha está guardando otra imagen, se reintenta sin perderla", async () => {
  const pending = { activa: true, capturas: [{ id: ID }] };
  const run = open([pending, pending], async attempt => attempt === 1 ? "busy" : "saved");
  await run.link.connect(); await settle();
  assert.equal(run.saved.length, 2);
  assert.equal(run.calls.filter(call => call.startsWith("POST /recibida")).length, 1);
  run.link.stop();
});

test("capturadora: si no se puede guardar, avisa dónde quedó la imagen y no insiste", async () => {
  const pending = { activa: true, capturas: [{ id: ID }, { id: ID2 }] };
  const run = open([pending, pending], async attempt => attempt === 1 ? "failed" : "saved");
  await run.link.connect(); await settle();
  assert.equal(run.saved.length, 2);
  assert.equal(run.problems.length, 1);
  assert.match(run.problems[0], /Imágenes\\SpeakDent/);
  run.link.stop();
});

test("capturadora: al cerrar la ficha suelta el turno y ya no guarda nada", async () => {
  let release;
  const run = open([{ activa: true, capturas: [{ id: ID }] }]);
  const original = run.fetcher;
  const link = createCaptureLink({
    onState: () => {}, onProblem: () => {}, save: async () => { throw new Error("no debía guardar"); },
    fetcher: async (url, init) => { if (url.includes("/imagen")) await new Promise(resolve => { release = resolve; }); return original(url, init); },
  });
  await link.connect(); await settle();
  link.stop(); release?.(); await settle();
  assert.ok(run.calls.some(call => call === "POST /soltar"));
  assert.equal(await link.connect(), false);
  run.link.stop();
});

test("capturadora: otra pestaña toma el turno y la ficha lo muestra; si no responde, lo dice", async () => {
  const run = open([{ activa: false, capturas: [] }]);
  await run.link.connect(); await settle();
  assert.equal(run.states.at(-1), "other");
  run.link.stop();
  const states = [], problems = [];
  const off = createCaptureLink({ save: async () => "saved", onState: state => states.push(state.kind), onProblem: message => problems.push(message), fetcher: async () => { throw new TypeError("Failed to fetch"); } });
  assert.equal(await off.connect(), false);
  await off.capture();
  assert.deepEqual(states, ["missing"]);
  assert.match(problems[0], /no respondió/);
  off.stop();
});

test("capturadora: programa, sitio y ficha usan el mismo puerto y las mismas direcciones", () => {
  const bridge = read("tools/capturadora/Puente.cs");
  assert.match(bridge, /Puerto = 47821/);
  assert.match(bridge, /"https:\/\/speakdent\.cl", "https:\/\/www\.speakdent\.cl"/);
  assert.match(bridge, /IPAddress\.Loopback/);
  assert.doesNotMatch(bridge, /IPAddress\.Any|\.Abrir\(0\)/);
  const panel = read("components/implantology.tsx");
  assert.match(panel, /showCapturer && windows && <CaptureLink key=\{current\.id\}/);
  assert.match(read("tools/capturadora/compilar.sh"), /4\.8-api/);
  assert.ok(existsSync(new URL("../public/descargas/capturadora-speakdent-prueba.zip", import.meta.url)));
});
