import test from 'node:test';
import assert from 'node:assert/strict';
import { ICD11, ICD11_CATALOG, diagnosisMatches, icd11FromText, searchDiagnoses, isStorableIcd11, icd11Title, cariesIcd11, officialTitle } from '../lib/icd11.ts';
import { validateAiExtraction, finalizeEvolution, mergeDiagnoses, cariesDiagnoses, DIAGNOSES_HEADER } from '../lib/dictation/proposal.ts';

const codes = (text) => diagnosisMatches(text).map((m) => m.code || `sin código: ${m.title}`);

test('el catálogo verificado es la fuente de códigos, títulos e ids', () => {
  assert.equal(ICD11_CATALOG.length > 300, true);
  for (const code of ['DA09.6Z', 'DA09.7Z', 'NA0D.04', 'NA0D.05', 'NA0D.10', 'NA0D.15', 'DA09.3', 'DA09.60', 'DA06.1', 'DA07.7', 'DA07.8', '1C1H.Z', 'DA0E.8', '7A83', 'XA4KC7']) assert.ok(ICD11[code], code);
  assert.equal(isStorableIcd11('DA09.6'), false, 'una categoría con subcódigos no se guarda');
  assert.equal(isStorableIcd11('1C1H'), false);
  assert.equal(isStorableIcd11('DA09.6Z'), true);
  assert.equal(isStorableIcd11('DA08.0&XA4KC7'), true);
  assert.equal(icd11Title('XA4KC7'), '');
});

test('DA08.10 se muestra como atrición (el título oficial en español se conserva aparte)', () => {
  assert.match(ICD11['DA08.10'].title, /^Atrición/);
  assert.equal(officialTitle('DA08.10'), 'Erosión excesiva de los dientes');
  assert.deepEqual(codes('atrición marcada en incisivos'), ['DA08.10']);
});

test('sin especificar usa los residuales DA09.6Z / DA09.7Z', () => {
  assert.deepEqual(codes('pieza 3.6 absceso periapical'), ['DA09.6Z']);
  assert.deepEqual(codes('pieza 3.6 periodontitis apical'), ['DA09.7Z']);
  assert.deepEqual(codes('periodontitis apical aguda'), ['DA09.70']);
  assert.deepEqual(codes('absceso periapical con fístula'), ['DA09.61']);
  assert.deepEqual(codes('periodontitis apical crónica reagudizada'), ['DA09.3']);
  assert.deepEqual(codes('absceso periapical con compromiso facial'), ['DA09.60']);
});

test('términos AAE quedan como equivalencias sugeridas, no directas', () => {
  const cases = { 'pulpitis irreversible sintomática': 'DA09.0', 'periodontitis apical sintomática': 'DA09.70', 'periodontitis apical asintomática': 'DA09.71', 'absceso apical agudo': 'DA09.62', 'absceso apical crónico': 'DA09.61' };
  for (const [term, code] of Object.entries(cases)) {
    const [match] = diagnosisMatches(`pieza 2.6 ${term}`);
    assert.equal(match.code, code, term);
    assert.equal(match.suggested?.from, 'AAE', term);
    assert.equal(match.suggested?.term, term);
  }
  assert.equal(diagnosisMatches('periodontitis apical aguda')[0].suggested, undefined);
});

test('erosión o abrasión de mucosa no se codifican como desgaste dentario', () => {
  assert.deepEqual(codes('erosión en la mucosa yugal'), []);
  assert.deepEqual(codes('liquen plano erosivo en mucosa'), []);
  assert.deepEqual(codes('abrasión en el labio inferior'), []);
  assert.deepEqual(codes('erosión dental en incisivos superiores'), ['DA08.12']);
  assert.deepEqual(codes('pieza 1.4 abrasión cervical'), ['DA08.11']);
});

test('nuevos diagnósticos del catálogo', () => {
  assert.deepEqual(codes('pieza 1.1 concusión'), ['NA0D.10']);
  assert.deepEqual(codes('luxación lateral de la 2.1'), ['NA0D.13']);
  assert.deepEqual(codes('luxación intrusiva'), ['NA0D.14']);
  assert.deepEqual(codes('avulsión de la 1.1'), ['NA0D.15']);
  assert.deepEqual(codes('fractura corono radicular no complicada'), ['NA0D.04']);
  assert.deepEqual(codes('alveolitis en la 3.8'), ['DA06.1']);
  assert.deepEqual(codes('pieza 4.8 semiincluida'), ['DA07.8']);
  assert.deepEqual(codes('canino incluido'), ['DA07.7']);
  assert.deepEqual(codes('GUNA'), ['1C1H.Z']);
  assert.deepEqual(codes('disfunción temporomandibular'), ['DA0E.8']);
  assert.deepEqual(codes('bruxismo nocturno'), ['7A83']);
});

test('conceptos sin código verificado quedan como etiquetas sin código', () => {
  assert.deepEqual(codes('gingivitis inducida por placa'), ['sin código: Gingivitis inducida por placa (biofilm)']);
  assert.deepEqual(codes('periodontitis estadio 3 grado b'), ['sin código: Periodontitis estadio III grado B (clasificación 2017)']);
  assert.deepEqual(codes('HIM en primeros molares'), ['sin código: Hipomineralización incisivo-molar (HIM)']);
  assert.deepEqual(codes('clase II división 1'), ['sin código: Maloclusión clase II división 1']);
  assert.deepEqual(codes('clase III esqueletal'), ['sin código: Maloclusión clase III']);
  assert.deepEqual(codes('caries clase III de Black'), []);
  assert.deepEqual(icd11FromText('gingivitis inducida por placa'), []);
});

test('caries radicular usa cemento y la caries pulpar sugiere un diagnóstico pulpar', () => {
  assert.equal(cariesIcd11('dentina_superficial', true).code, 'DA08.0&XA4KC7');
  assert.equal(cariesIcd11('pulpar', true).code, 'DA08.0&XA5B71');
  const dx = cariesDiagnoses([{ kind: 'surface', tooth: 46, surface: 'O', finding: { condition: 'caries', depth: 'pulpar' }, sourceText: 'caries oclusal penetrante en la 4.6' }]);
  assert.deepEqual(dx.map((d) => [d.tooth, d.code, d.suggested?.from ?? '']), [[46, 'DA08.0&XA5B71', ''], [46, 'DA09.Z', 'caries-pulpar']]);
  const merged = mergeDiagnoses(dx, [{ id: 'x', tooth: 46, code: 'DA09.1', title: ICD11['DA09.1'].title, label: '', evidence: 'necrosis pulpar 4.6' }]);
  assert.deepEqual(merged.map((d) => d.code), ['DA08.0&XA5B71', 'DA09.1']);
});

test('búsqueda por sinónimos chilenos, sin tildes', () => {
  assert.equal(searchDiagnoses('alveolo seco')[0].code, 'DA06.1');
  assert.equal(searchDiagnoses('atricion')[0].code, 'DA08.10');
  assert.equal(searchDiagnoses('absceso apical agudo')[0].code, 'DA09.62');
  assert.equal(searchDiagnoses('DA09.6')[0].code, 'DA09.6Z');
  assert.equal(searchDiagnoses('gingivitis placa')[0].code, '');
  assert.ok(searchDiagnoses('pulpitis').every((r) => r.code === '' || isStorableIcd11(r.code)));
});

test('la IA elige diagnósticos con cita; el código lo pone el catálogo', () => {
  const transcript = 'pieza 2.6 pulpitis irreversible sintomática. el paciente dice que tiene gingivitis. probable absceso periapical en la 3.6. gingivitis inducida por placa.';
  const ai = validateAiExtraction({
    nota: {},
    diagnosticos: [
      { termino: 'pulpitis irreversible sintomática', pieza: '2.6', evidencia: 'pieza 2.6 pulpitis irreversible sintomática' },
      { termino: 'gingivitis', pieza: '', evidencia: 'el paciente dice que tiene gingivitis' },
      { termino: 'absceso periapical', pieza: '3.6', evidencia: 'probable absceso periapical en la 3.6' },
      { termino: 'gingivitis inducida por placa', pieza: '', evidencia: 'gingivitis inducida por placa' },
      { termino: 'periodontitis crónica', pieza: '1.6', evidencia: 'periodontitis crónica en la 1.6' },
      { termino: 'DA09.1 necrosis', pieza: '2.6', evidencia: 'pieza 2.6 pulpitis irreversible sintomática' },
    ],
  }, transcript, { today: '2026-11-01' });
  assert.deepEqual(ai.diagnoses.map((d) => [d.tooth ?? null, d.code, d.suggested?.from ?? '']), [[26, 'DA09.0', 'AAE'], [null, '', '']]);
});

test('al guardar, la sección CIE-11 refleja solo las etiquetas confirmadas', () => {
  const body = `Examen\nPieza 2.6 pulpitis.\n\n${DIAGNOSES_HEADER}\nFDI 2.6: Pulpitis (CIE-11 DA09.0)`;
  assert.equal(finalizeEvolution(body, [], '').includes(DIAGNOSES_HEADER), true, 'sin lista se respeta la nota');
  assert.equal(finalizeEvolution(body, [], '', []).includes(DIAGNOSES_HEADER), false, 'lista vacía: el profesional quitó todo');
  const kept = finalizeEvolution(body, [], '', [{ id: 'a', tooth: 26, code: '', title: 'Gingivitis inducida por placa (biofilm)', label: '', evidence: '' }]);
  assert.match(kept, /FDI 2\.6: Gingivitis inducida por placa \(biofilm\) \(sin código CIE-11\)/);
});
