import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { voiceValues, perioCommand, spokenToothCommand, perioSuspicious } from '../lib/dictation/perio-voice.ts';
import { guideAuthorize, guideHear, guideStart } from '../lib/dictation/perio-guide.ts';

const v = text => voiceValues(text)?.values ?? null;

test('voz perio: números en dígitos y palabras, con mm y relleno', () => {
  assert.deepEqual(v('3'), [3]);
  assert.deepEqual(v('tres'), [3]);
  assert.deepEqual(v('3 mm'), [3]);
  assert.deepEqual(v('tres milímetros'), [3]);
  assert.deepEqual(v('cero'), [0]);
  assert.deepEqual(v('doce'), [12]);
  assert.deepEqual(v('once'), [11]);
  assert.deepEqual(v('sondaje cuatro'), [4]);
});

test('voz perio: errores típicos del reconocimiento cuando la palabra va sola', () => {
  const cases = { tren: 3, 'Sí': 6, si: 6, los: 2, un: 1, sero: 0, diete: 7, hecho: 8, mueve: 9, zinco: 5, cuarto: 4, dies: 10, es: 10, onse: 11, dose: 12, uno: 1, seis: 6, nueve: 9, ocho: 8, siete: 7 };
  for (const [heard, value] of Object.entries(cases)) assert.deepEqual(v(heard), [value], heard);
  const h = voiceValues('tren');
  assert.equal(h.homophone, true);
  assert.equal(voiceValues('tres').homophone, false);
});

test('voz perio: un homófono dentro de una frase no se convierte en número', () => {
  assert.equal(v('sí tren'), null);           // dos homófonos/palabras sueltas: no es una medida
  assert.deepEqual(v('sí tres'), null);       // «sí» acompañado no es 6
  assert.equal(v('los dientes'), null);
  assert.equal(v('es que'), null);
  assert.equal(v('hola'), null);
  assert.equal(v(''), null);
});

test('voz perio: negativos y positivos del margen', () => {
  assert.deepEqual(v('menos uno'), [-1]);
  assert.deepEqual(v('menos 2'), [-2]);
  assert.deepEqual(v('-1'), [-1]);
  assert.deepEqual(v('más dos'), [2]);
  assert.deepEqual(v('menos los'), [-2]);
  assert.deepEqual(v('negativo tres'), [-3]);
  assert.deepEqual(v('margen menos uno'), [-1]);
});

test('voz perio: órdenes', () => {
  assert.equal(perioCommand('corrige'), 'corrige');
  assert.equal(perioCommand('me equivoqué'), 'corrige');
  assert.equal(perioCommand('repite'), 'repite');
  assert.equal(perioCommand('atrás'), 'atras');
  assert.equal(perioCommand('salta'), 'salta');
  assert.equal(perioCommand('pausa'), 'pausa');
  assert.equal(perioCommand('sigue'), 'sigue');
  assert.equal(perioCommand('continuar'), 'sigue');
  assert.equal(perioCommand('sangra'), 'sangra');
  assert.equal(perioCommand('supura'), 'supura');
  assert.equal(perioCommand('no sangra'), null);
  assert.equal(perioCommand('tres sangra'), null); // con número lo resuelve el sitio (valor + sangrado)
  assert.equal(perioCommand('terminar'), 'terminar');
  assert.equal(perioCommand('tres'), null);
});

test('voz perio: «pieza N» con la convención de la aplicación', () => {
  assert.equal(spokenToothCommand('pieza 2.6'), 26);          // FDI con punto
  assert.equal(spokenToothCommand('pieza dos punto seis'), 26);
  assert.equal(spokenToothCommand('pieza dos seis'), 26);     // dos dígitos: FDI
  assert.equal(spokenToothCommand('pieza 2 6'), 26);
  assert.equal(spokenToothCommand('pieza 14'), 26);           // 1–32 sin punto: numeración chilena (14 = FDI 2.6)
  assert.equal(spokenToothCommand('pieza 30'), 36);           // Chile 30 = FDI 3.6
  assert.equal(spokenToothCommand('pieza 46'), 46);           // 33–48 válido: FDI
  assert.equal(spokenToothCommand('pieza 49'), null);
  assert.equal(spokenToothCommand('tres'), null);
});

test('voz perio: valores sospechosos', () => {
  assert.equal(perioSuspicious('depth', 15, 'MV', {}), 'range');
  assert.equal(perioSuspicious('depth', 13, 'MV', {}), 'range');
  assert.equal(perioSuspicious('depth', 12, 'MV', {}), null);
  assert.equal(perioSuspicious('depth', -1, 'MV', {}), 'range');
  assert.equal(perioSuspicious('depth', 8, 'V', { MV: 3 }), 'jump');   // salto de 5 con el vecino
  assert.equal(perioSuspicious('depth', 7, 'V', { MV: 3 }), null);     // salto de 4: se acepta
  assert.equal(perioSuspicious('depth', 8, 'DL', { MV: 3 }), null);    // MV no es vecino de DL
  assert.equal(perioSuspicious('depth', 2, 'ML', { MV: 7 }), 'jump');  // interproximal del mismo lado
  assert.equal(perioSuspicious('margin', -1, 'MV', {}), null);
  assert.equal(perioSuspicious('margin', 13, 'MV', {}), 'range');
  assert.equal(perioSuspicious('margin', -13, 'MV', {}), 'range');
});

const authorized = () => { const s = guideStart({}, 'Luis').state; return guideAuthorize(s, s.order[s.index], 'Luis').state; };

test('guía: fuera de rango no se anota y pide repetir en grande', () => {
  const out = guideHear(authorized(), 'quince');
  assert.equal(out.apply, undefined);
  assert.equal(out.alert, '¿Repite? Oí 15');
  assert.match(out.spoken, /^¿Repite\? Oí 15\.$/);
  assert.equal(out.state.pos, 0);
  // Fuera de rango no se acepta aunque se repita.
  assert.equal(guideHear(out.state, 'quince').apply, undefined);
});

test('guía: salto sospechoso se pregunta y se acepta si el clínico lo repite igual', () => {
  let s = guideHear(authorized(), 'tres').state;   // MV 3
  s = guideHear(s, 'cero').state;                   // margen MV 0
  const jump = guideHear(s, 'nueve');               // V 9: salto de 6
  assert.equal(jump.apply, undefined);
  assert.equal(jump.alert, '¿Repite? Oí 9');
  const again = guideHear(jump.state, 'nueve');
  assert.deepEqual(again.apply.sites, { V: { depth: 9 } });
  // Otro valor distinto tras el aviso se evalúa de nuevo.
  const other = guideHear(jump.state, 'cuatro');
  assert.deepEqual(other.apply.sites, { V: { depth: 4 } });
});

test('guía: mishearings sueltos se anotan, con confirmación breve y etiqueta del parámetro', () => {
  const s = authorized();
  const depth = guideHear(s, 'tren');
  assert.deepEqual(depth.apply.sites, { MV: { depth: 3 } });
  assert.deepEqual(depth.records, [{ tooth: 18, site: 'MV', field: 'depth', value: 3 }]);
  assert.equal(depth.spoken, 'Sondaje 3.\nMargen.');
  const margin = guideHear(depth.state, 'menos uno');
  assert.deepEqual(margin.apply.sites, { MV: { margin: -1 } });
  assert.equal(margin.records[0].field, 'margin');
  assert.equal(margin.spoken, 'Margen menos 1.\nSondaje central vestibular.');
  assert.equal(guideHear(s, 'blabla').miss, true);
});

test('guía: corrige rehace el último valor; sangra marca el sitio recién medido', () => {
  let s = guideHear(authorized(), 'tres').state;
  const fix = guideHear(s, 'corrige');
  assert.equal(fix.state.pos, 0);
  assert.match(fix.say, /^Corrige\. [\s\S]*sondaje de mesial vestibular/);
  const bleed = guideHear(s, 'sangra');
  assert.deepEqual(bleed.apply.sites, { MV: { bleeding: true } });
  assert.equal(bleed.records[0].field, 'bleeding');
  assert.equal(bleed.state.pos, 1);
});

test('guía: «sigue» o «pieza N» autorizan por voz mientras se espera', () => {
  const start = guideStart({}, 'Luis').state;
  const go = guideHear(start, 'sigue');
  assert.equal(go.state.step, 'site');
  assert.equal(go.state.order[go.state.index], 18);
  const other = guideHear(start, 'pieza 14');      // Chile 14 = FDI 2.6
  assert.equal(other.state.order[other.state.index], 26);
  assert.equal(other.state.step, 'site');
  // A mitad de una pieza, «pieza N» no cambia de pieza.
  const mid = guideHear(go.state, 'pieza 2.6');
  assert.equal(mid.state.order[mid.state.index], 18);
  // Un número suelto sin autorizar no se anota.
  assert.equal(guideHear(start, 'tres').apply, undefined);
});

test('la vista ampliada se abre sola con el dictado y respeta reducir movimiento', () => {
  const host = readFileSync(new URL('../components/periodontogram.tsx', import.meta.url), 'utf8');
  const readout = readFileSync(new URL('../components/perio-live-readout.tsx', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('../components/perio-guide.tsx', import.meta.url), 'utf8');
  assert.match(host, /onLive=\{setLive\}/);
  assert.match(host, /live=\{<PerioLiveReadout/);
  assert.match(readout, /prefers-reduced-motion:reduce/);
  assert.match(guide, /dropClip\(\);\s*try \{ recognizer\.current\?\.abort\(\)/); // mientras habla no escucha ni graba
  assert.match(guide, /form\.append\("purpose", "perio"\)/);
});

test('respaldo OpenAI: la respuesta corta del periodontograma se transcribe con sesgo a números y órdenes', async () => {
  const { transcribeDentalAudio } = await import('../lib/dictation/openai-transcription.ts');
  let body;
  await transcribeDentalAudio(new Blob([new Uint8Array(500)], { type: 'audio/webm' }), 'k', { purpose: 'perio', fetcher: async (_u, init) => { body = init.body; return Response.json({ text: '3' }); } });
  assert.match(body.get('prompt'), /un solo número de 0 a 12/);
  assert.ok(body.getAll('keywords[]').includes('corrige'));
  assert.ok(!body.getAll('keywords[]').includes('destartraje subgingival'));
});
