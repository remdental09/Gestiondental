import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { nameFromEmail, parseClinicOwners, resolveOwner, viewerInitials } from '../app/access-owners.ts';

const LUIS = 'remdental09@gmail.com';
const LUIS_ID = 'luis-owner-id-de-prueba-0001';
const COLEGA = 'aleretamal@gmail.com';
const COLEGA_ID = '6f1c2d9e-0000-4000-8000-colega000001';
const owners = JSON.stringify({
  [LUIS]: { ownerId: LUIS_ID, name: 'Dr. Luis Rodríguez' },
  [COLEGA]: { ownerId: COLEGA_ID, name: 'Dr(a). aleretamal' },
});
const full = { CLINIC_OWNERS: owners, ACCESS_ALLOWED_EMAIL: LUIS, CLINIC_OWNER_ID: LUIS_ID };

test('Luis conserva exactamente su owner_id y su nombre desde CLINIC_OWNERS', () => {
  assert.deepEqual(resolveOwner(LUIS, full), { ok: true, owner: { ownerId: LUIS_ID, name: 'Dr. Luis Rodríguez' } });
  assert.deepEqual(resolveOwner('  RemDental09@Gmail.com ', full), { ok: true, owner: { ownerId: LUIS_ID, name: 'Dr. Luis Rodríguez' } });
});

test('sin CLINIC_OWNERS, el respaldo ACCESS_ALLOWED_EMAIL/CLINIC_OWNER_ID sigue sirviendo solo a Luis', () => {
  const legacy = { ACCESS_ALLOWED_EMAIL: LUIS, CLINIC_OWNER_ID: LUIS_ID };
  const r = resolveOwner(LUIS, legacy);
  assert.equal(r.ok, true);
  assert.equal(r.owner.ownerId, LUIS_ID);
  assert.deepEqual(resolveOwner(COLEGA, legacy), { ok: false, status: 401 });
});

test('la colega obtiene su propio owner_id, distinto del de Luis', () => {
  const r = resolveOwner(COLEGA, full);
  assert.deepEqual(r, { ok: true, owner: { ownerId: COLEGA_ID, name: 'Dr(a). aleretamal' } });
  assert.notEqual(r.owner.ownerId, LUIS_ID);
});

test('un correo desconocido recibe 401 y nunca el owner_id de Luis', () => {
  for (const email of ['intruso@gmail.com', 'remdental09@gmail.co', 'remdental09+x@gmail.com', '', '   ']) {
    const r = resolveOwner(email, full);
    assert.deepEqual(r, { ok: false, status: 401 }, email);
    assert.ok(!JSON.stringify(r).includes(LUIS_ID));
  }
});

test('CLINIC_OWNERS malformado o con owner_id compartido deja la app no lista (503), sin abrirla a nadie', () => {
  const bad = [
    '{no es json',
    '[]',
    '{}',
    JSON.stringify({ [LUIS]: { ownerId: LUIS_ID }, [COLEGA]: { ownerId: LUIS_ID } }),
    JSON.stringify({ [LUIS]: { ownerId: 'corto' } }),
    JSON.stringify({ 'sin-arroba': { ownerId: COLEGA_ID } }),
    JSON.stringify({ [LUIS]: 42 }),
  ];
  for (const raw of bad) {
    for (const email of [LUIS, COLEGA]) assert.deepEqual(resolveOwner(email, { ...full, CLINIC_OWNERS: raw }), { ok: false, status: 503 }, raw);
  }
});

test('el owner_id antiguo de Luis no puede asignarse a otro correo', () => {
  const stolen = JSON.stringify({ [COLEGA]: { ownerId: LUIS_ID } });
  assert.equal(parseClinicOwners(stolen, { email: LUIS, ownerId: LUIS_ID }), 'invalid');
  assert.deepEqual(resolveOwner(COLEGA, { ...full, CLINIC_OWNERS: stolen }), { ok: false, status: 503 });
});

test('sin ninguna configuración no entra nadie (503)', () => {
  assert.deepEqual(resolveOwner(LUIS, {}), { ok: false, status: 503 });
  assert.deepEqual(resolveOwner(LUIS, { ACCESS_ALLOWED_EMAIL: LUIS }), { ok: false, status: 503 });
});

test('formato corto correo → ownerId y nombre derivado del correo', () => {
  const r = resolveOwner(COLEGA, { CLINIC_OWNERS: JSON.stringify({ [COLEGA]: COLEGA_ID }) });
  assert.deepEqual(r, { ok: true, owner: { ownerId: COLEGA_ID, name: 'Dr(a). aleretamal' } });
  assert.equal(nameFromEmail('ana.perez@clinica.cl'), 'Dr(a). ana.perez');
});

test('iniciales del botón de inicio a partir del nombre visible', () => {
  assert.equal(viewerInitials('Dr. Luis Rodríguez'), 'LR');
  assert.equal(viewerInitials('Dr(a). aleretamal'), 'A');
  assert.equal(viewerInitials('Dra. Ana María Pérez'), 'AM');
  assert.equal(viewerInitials(''), 'GD');
});

test('el nombre viaja codificado en la cabecera y se decodifica con tildes', () => {
  assert.equal(decodeURIComponent(encodeURIComponent('Dr. Luis Rodríguez')), 'Dr. Luis Rodríguez');
  assert.match(encodeURIComponent('Dr. Luis Rodríguez'), /^[\x20-\x7e]+$/);
});

test('worker y pantalla usan la cuenta por correo, sin nombre ni correo del titular fijos', () => {
  const worker = readFileSync(new URL('../worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /resolveOwner\(email, ownerConfig\)/);
  assert.match(worker, /headers\.delete\(ACCESS_NAME_HEADER\)/);
  assert.doesNotMatch(worker, /email !== allowedEmail/);
  assert.doesNotMatch(worker, /headers\.set\(ACCESS_OWNER_ID_HEADER, ownerId\)/);
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /Dr\. Luis Rodríguez/);
  assert.doesNotMatch(layout, /Dr\. Luis Rodríguez/);
  const auth = readFileSync(new URL('../app/chatgpt-auth.ts', import.meta.url), 'utf8');
  assert.match(auth, /x-clinic-access-name/);
});
