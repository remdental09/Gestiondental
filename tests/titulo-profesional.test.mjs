import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_TITLE, PROFESSIONAL_TITLES, asProfessionalTitle, checkProfile, displayName, withTitle } from "../lib/clinician-profile.ts";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const base = { firstName: "Luis", lastName: "Rodríguez", rut: "12.345.678-5", specialty: "Implantología oral" };

test("título: Dr., Dra. o Dr(a). (por defecto); cualquier otro valor vuelve al defecto", () => {
  assert.deepEqual([...PROFESSIONAL_TITLES], ["Dr.", "Dra.", "Dr(a)."]);
  assert.equal(DEFAULT_TITLE, "Dr(a).");
  assert.equal(checkProfile(base).profile.title, "Dr(a).");
  assert.equal(checkProfile({ ...base, title: "Dr." }).profile.title, "Dr.");
  assert.equal(checkProfile({ ...base, title: "Dra." }).profile.title, "Dra.");
  assert.equal(checkProfile({ ...base, title: "Sr." }).profile.title, "Dr(a).");
  assert.equal(asProfessionalTitle(undefined), "Dr(a).");
});

test("título: se usa en el nombre visible y reemplaza el de un nombre ya guardado", () => {
  assert.equal(displayName({ ...base, title: "Dr." }), "Dr. Luis Rodríguez");
  assert.equal(displayName({ ...base, title: "Dra." }), "Dra. Luis Rodríguez");
  assert.equal(displayName(base), "Dr(a). Luis Rodríguez");
  assert.equal(withTitle("Dr(a). Luis Rodríguez", "Dr."), "Dr. Luis Rodríguez");
  assert.equal(withTitle("Dra. Ana Soto", "Dr(a)."), "Dr(a). Ana Soto");
  assert.equal(withTitle("Luis Rodríguez", "Dr."), "Dr. Luis Rodríguez");
});

test("título: columna aditiva con defecto Dr(a).; se guarda y se lee por profesional", () => {
  const db = read("app/clinician-profile-db.ts");
  assert.match(db, /ALTER TABLE clinician_profiles ADD COLUMN title TEXT NOT NULL DEFAULT 'Dr\(a\)\.'/);
  assert.match(db, /title = excluded\.title/);
  assert.match(db, /UPDATE clinician_profiles SET title = \?, updated_at = \? WHERE owner_id = \?/);
  const route = read("app/api/profile/route.ts");
  assert.match(route, /export async function PATCH/);
  assert.match(route, /saveProfileTitle\(personalIdOf\(user\)/, "solo el propio perfil");
});

test("título: selector en Mi perfil, registro y Configuración → Profesionales; documentos lo usan", () => {
  for (const file of ["components/profile-dialog.tsx", "components/professional-registration.tsx"]) {
    const src = read(file);
    assert.match(src, /<TitleSelect className=\{field\} value=\{form\.title\}/, file);
    assert.match(src, /displayName\(form\) : `\$\{form\.title\} Nombre Apellido`/, file);
  }
  assert.match(read("components/professionals-panel.tsx"), /<ProfessionalTitleSetting\/>/);
  const panel = read("components/documentation-panel.tsx");
  assert.match(panel, /const doctorName = reg\?\.fullName \? `\$\{doctorTitle\(doc\)\} \$\{reg\.fullName\}` : authorName\(doc\)/);
  assert.match(read("app/api/documentos/route.ts"), /authorTitle: titles\.get\(row\.document\.createdBy\) \?\? null/);
  assert.match(read("app/api/documentos/emitir/route.ts"), /authorTitle: \(await loadProfileTitles\(\[row\.createdBy\]\)/);
});
