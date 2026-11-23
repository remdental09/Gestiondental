import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { AUTH_SESSIONS_DDL, AUTH_RATE_DDL, createSession, readSession, revokeSession, allowLogin, crossSiteWrite, sameSiteNavigation, forgetCachedSessions, OWN_IDLE_MS, revokeAllSessions, setLoginCode, verifyLoginCode, newLoginCode, PENDING_MS, CODE_TTL_MS, SHARED_IDLE_MS, SHARED_MAX_MS, SESSION_TTL_MS, SLIDE_EVERY_MS, isStoredToken } from '../lib/session-store.ts';

const sqliteDb = () => {
  const raw = new DatabaseSync(':memory:');
  raw.exec(AUTH_SESSIONS_DDL); raw.exec(AUTH_RATE_DDL);
  let writes = 0, reads = 0;
  return { raw, stats: () => ({ writes, reads }), prepare: sql => ({ bind: (...v) => ({ first: async () => { reads++; return raw.prepare(sql).get(...v) ?? null; }, run: async () => { writes++; return raw.prepare(sql).run(...v); } }) }) };
};

test('equipo propio: se anota la actividad cada 5 min, la cookie se renueva una vez al día y a las 2 h sin uso se cierra', async () => {
  forgetCachedSessions();
  const db = sqliteDb();
  const t0 = Date.UTC(2026, 10, 21, 12);
  const token = await createSession(db, { email: 'A@Example.test', name: 'A' }, t0);
  assert.ok(isStoredToken(token));
  assert.deepEqual(await readSession(db, token, t0 + 1000), { session: { email: 'a@example.test', name: 'A' }, refresh: false, shared: false, pending: false });
  const w = db.stats().writes;
  await readSession(db, token, t0 + 2000);
  assert.equal(db.stats().writes, w, 'en menos de 5 min: sin escrituras');
  // Uso cada hora durante más de un día: nunca pasa 2 h sin actividad, así que sigue abierta y la cookie se renueva al pasar un día.
  let t = t0, refreshed = 0;
  for (let i = 0; i < 26; i++) {
    t += 3_600_000;
    forgetCachedSessions();
    const read = await readSession(db, token, t);
    assert.ok(read, 'con actividad cada hora sigue abierta');
    if (read.refresh) refreshed++;
  }
  assert.equal(refreshed, 0, 'con uso cada hora no pasa un día entero entre dos anotaciones');
  assert.equal(db.raw.prepare('SELECT expires_at FROM auth_sessions').get().expires_at, t + SESSION_TTL_MS);
  forgetCachedSessions();
  assert.ok(await readSession(db, token, t + OWN_IDLE_MS), 'a las 2 h exactas aún vale');
  const idle = await createSession(db, { email: 'a@example.test', name: 'A' }, t0);
  forgetCachedSessions();
  assert.equal(await readSession(db, idle, t0 + OWN_IDLE_MS + 1), null, 'más de 2 h sin uso: hay que entrar de nuevo');
  const old = await createSession(db, { email: 'a@example.test', name: 'A' }, t0);
  forgetCachedSessions();
  assert.equal(await readSession(db, old, t0 + SESSION_TTL_MS + 1), null, '30 días sin uso → vence');
});

test('caché de 60 s: no lee D1 en cada solicitud; revocar borra la caché local', async () => {
  forgetCachedSessions();
  const db = sqliteDb();
  const t0 = Date.UTC(2026, 10, 21, 12);
  const token = await createSession(db, { email: 'b@example.test', name: '' }, t0);
  await readSession(db, token, t0 + 1);
  const r = db.stats().reads;
  await readSession(db, token, t0 + 30_000);
  assert.equal(db.stats().reads, r);
  await revokeSession(db, token, t0 + 31_000);
  assert.equal(await readSession(db, token, t0 + 32_000), null);
});

test('tokens inválidos o inventados no consultan nada útil', async () => {
  const db = sqliteDb();
  assert.equal(await readSession(db, 'v2.' + 'x'.repeat(43)), null);
  assert.equal(await readSession(db, 'firmado.antiguo'), null);
  assert.equal(isStoredToken('v2.corto'), false);
});

test('límite de inicio de sesión por IP con ventana fija', async () => {
  const db = sqliteDb();
  const t = Date.UTC(2026, 10, 21, 12, 0, 0);
  for (let i = 0; i < 3; i++) assert.equal(await allowLogin(db, '198.51.100.1', t + i, 3), true);
  assert.equal(await allowLogin(db, '198.51.100.1', t + 10, 3), false);
  assert.equal(await allowLogin(db, '198.51.100.2', t + 10, 3), true);
  assert.equal(await allowLogin(db, '198.51.100.1', t + 11 * 60_000, 3), true, 'nueva ventana');
  const broken = { prepare: () => { throw new Error('D1 caído'); } };
  assert.equal(await allowLogin(broken, '198.51.100.1'), true, 'si D1 falla no se deja a nadie fuera');
});

test('CSRF: escrituras de otro sitio u otro origen; navegación propia para salir', () => {
  const req = (method, headers) => new Request('https://speakdent.cl/api/clinical', { method, headers, ...(method === 'POST' ? { body: '{}' } : {}) });
  assert.equal(crossSiteWrite(req('GET', { 'Sec-Fetch-Site': 'cross-site' })), false);
  assert.equal(crossSiteWrite(req('POST', { 'Sec-Fetch-Site': 'cross-site' })), true);
  assert.equal(crossSiteWrite(req('POST', { Origin: 'https://evil.example' })), true);
  assert.equal(crossSiteWrite(req('POST', { Origin: 'https://speakdent.cl', 'Sec-Fetch-Site': 'same-origin' })), false);
  assert.equal(crossSiteWrite(req('POST', {})), false, 'Safari antiguo sin cabeceras: lo cubre SameSite=Lax');
  assert.equal(sameSiteNavigation(req('GET', { 'Sec-Fetch-Site': 'same-origin' })), true);
  assert.equal(sameSiteNavigation(req('GET', { 'Sec-Fetch-Site': 'cross-site' })), false);
  assert.equal(sameSiteNavigation(req('GET', {})), true);
});

test('equipo compartido: 15 min sin uso lo cierra, el uso no lo desliza más allá de 2 horas y no renueva la cookie', async () => {
  forgetCachedSessions();
  const db = sqliteDb();
  const t0 = Date.UTC(2026, 10, 23, 12);
  const token = await createSession(db, { email: 'c@example.test', name: '' }, t0, true);
  assert.equal(db.raw.prepare('SELECT shared, expires_at FROM auth_sessions').get().shared, 1);
  assert.equal(db.raw.prepare('SELECT expires_at FROM auth_sessions').get().expires_at, t0 + SHARED_MAX_MS);
  let t = t0;
  // Uso cada 10 minutos: nunca llega a 15 min sin actividad, pero a las 2 horas se corta igual.
  for (let i = 0; i < 12; i++) {
    t += 10 * 60_000 - 1;
    forgetCachedSessions();
    const read = await readSession(db, token, t);
    assert.equal(read?.shared, true);
    assert.equal(read?.refresh, false, 'no se reenvía la cookie ni se corre el vencimiento');
  }
  forgetCachedSessions();
  assert.equal(await readSession(db, token, t0 + SHARED_MAX_MS + 1), null, 'tope absoluto de 2 horas');
  const justInTime = await createSession(db, { email: 'c@example.test', name: '' }, t0, true);
  forgetCachedSessions();
  assert.ok(await readSession(db, justInTime, t0 + SHARED_IDLE_MS), 'a los 15 min exactos aún vale');
  const idle = await createSession(db, { email: 'c@example.test', name: '' }, t0, true);
  forgetCachedSessions();
  assert.equal(await readSession(db, idle, t0 + SHARED_IDLE_MS + 1), null, 'más de 15 min sin uso');
});

test('revokeSession indica si era de equipo compartido; revokeAllSessions corta todas las del correo', async () => {
  forgetCachedSessions();
  const db = sqliteDb();
  const t0 = Date.UTC(2026, 10, 23, 12);
  const own = await createSession(db, { email: 'd@example.test', name: '' }, t0);
  const shared = await createSession(db, { email: 'D@example.test', name: '' }, t0, true);
  const other = await createSession(db, { email: 'e@example.test', name: '' }, t0);
  await revokeAllSessions(db, 'd@example.test', t0 + 5);
  assert.equal(await readSession(db, own, t0 + 10), null);
  assert.equal(await readSession(db, shared, t0 + 10), null);
  assert.ok(await readSession(db, other, t0 + 10), 'la sesión de otra persona no se toca');
  const again = await createSession(db, { email: 'f@example.test', name: '' }, t0, true);
  assert.equal(await revokeSession(db, again, t0 + 1), true);
  assert.equal(await revokeSession(db, other, t0 + 1), false);
});

test('sesión pendiente de código: no da acceso hasta el código correcto; vence a los 15 min; el código vence a los 10', async () => {
  forgetCachedSessions();
  const db = sqliteDb();
  const t0 = Date.UTC(2026, 10, 23, 15);
  const token = await createSession(db, { email: 'g@example.test', name: '' }, t0, false, true);
  assert.equal((await readSession(db, token, t0 + 1)).pending, true);
  assert.equal(await setLoginCode(db, token, '012345', t0), true);
  assert.equal(await setLoginCode(db, token, '999999', t0 + 5_000), false, 'espera de 30 s entre envíos');
  assert.equal(db.raw.prepare('SELECT count(*) n FROM auth_sessions WHERE code_hash LIKE ?').get('%012345%').n, 0, 'solo se guarda el hash');
  assert.equal(await verifyLoginCode(db, token, '012346', t0 + 10), 'wrong');
  assert.equal(await verifyLoginCode(db, token, '012 345', t0 + 20), 'ok');
  const read = await readSession(db, token, t0 + 30);
  assert.equal(read.pending, false);
  assert.equal(db.raw.prepare('SELECT expires_at FROM auth_sessions').get().expires_at, t0 + 20 + SESSION_TTL_MS);
  const late = await createSession(db, { email: 'g@example.test', name: '' }, t0, false, true);
  await setLoginCode(db, late, '111111', t0);
  assert.equal(await verifyLoginCode(db, late, '111111', t0 + CODE_TTL_MS + 1), 'expired');
  forgetCachedSessions();
  assert.equal(await readSession(db, late, t0 + PENDING_MS + 1), null, 'la sesión pendiente muere a los 15 min');
  for (let i = 0; i < 50; i++) assert.match(newLoginCode(), /^\d{6}$/);
});
