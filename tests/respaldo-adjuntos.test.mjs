import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attachmentFileName } from "../lib/attachment-name.ts";
import { fichaMarkdown } from "../lib/backup-markdown.ts";

const drive = readFileSync(new URL("../app/drive-oauth.ts", import.meta.url), "utf8");

test("nombre del adjunto en Drive es seguro y conserva la extensión", () => {
  assert.equal(attachmentFileName(7, "rx/molar:46.jpg", "image/jpeg"), "Adjunto 7 - rx molar 46.jpg");
  assert.equal(attachmentFileName(8, "", "application/pdf"), "Adjunto 8 - Adjunto.pdf");
  assert.equal(attachmentFileName(9, "cbct.PNG", "image/png"), "Adjunto 9 - cbct.png");
});

test("el respaldo copia los adjuntos en la cuenta principal y en las copias, antes de confirmar", () => {
  assert.match(drive, /backupAttachments\(accessToken, user\.userId, "principal"[\s\S]*confirmDriveSnapshot\(/);
  assert.match(drive, /backupAttachments\(accessToken, user\.userId, "copia:" \+ mirror\.google_sub[\s\S]*INSERT INTO drive_mirror_backups/);
});

test("un adjunto solo cuenta como respaldado si Drive lo confirma", () => {
  assert.match(drive, /attachmentIsInDrive[\s\S]*trashed[\s\S]*Number\(file\.size\) === size/);
  assert.match(drive, /No se pudo verificar el adjunto/);
  assert.match(drive, /no está en el almacenamiento; no se puede respaldar/);
});

test("la ficha ya no dice que los archivos quedan solo en la aplicación", () => {
  const md = fichaMarkdown({
    patient: { id: 1, name: "Ana" }, evolutions: [], budgets: [], appointments: [], periodontalExams: [], odontogram: null, anamnesis: null, address: null,
    imageMetadata: [{ name: "rx.jpg", driveFile: "Adjunto 3 - rx.jpg", kind: "Radiografía" }],
  });
  assert.match(md, /Adjunto 3 - rx\.jpg/);
  assert.doesNotMatch(md, /solo su lista/);
});

test("tope de subidas por corrida y tratamiento de adjuntos borrados", () => {
  assert.match(drive, /MAX_ATTACHMENT_UPLOADS_PER_RUN = 3/);
  assert.match(drive, /response\.status === 404 \|\| response\.status === 403\) return false/);
});
