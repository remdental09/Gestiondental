import { spawnSync } from "node:child_process";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const exportPath = process.argv[2];
if (!exportPath) throw new Error("Provide the absolute path to the downloaded clinical export.");

const projectRoot = process.cwd();
const configPath = resolve(projectRoot, "dist/server/wrangler.json");
const wranglerPath = resolve(projectRoot, "node_modules/wrangler/bin/wrangler.js");
const exportData = JSON.parse(readFileSync(exportPath, "utf8"));
if (exportData.format !== "gestion-dental-clinical-export" || exportData.version !== 1) {
  throw new Error("Unsupported clinical export format.");
}

const images = exportData.tables?.clinicalImages;
if (!Array.isArray(images)) throw new Error("Export is missing image metadata.");
const downloadedPaths = [];
try {
  for (const image of images) {
    if (!image.contentAvailable || typeof image.contentBase64 !== "string" || !image.objectKey) {
      throw new Error("An image record is missing its exported binary or object key.");
    }
    const path = join(tmpdir(), `gestion-dental-verify-${randomUUID()}.bin`);
    downloadedPaths.push(path);
    const result = spawnSync(process.execPath, [
      wranglerPath,
      "r2", "object", "get", `gestion-dental-clinical-images/${image.objectKey}`,
      "--remote", "--file", path, "--config", configPath,
    ], {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) {
      throw new Error("Cloudflare could not return the migrated image object.");
    }
    const expected = Buffer.from(image.contentBase64, "base64");
    const actual = readFileSync(path);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new Error("A migrated image differs from the source export.");
    }
  }
  console.log(JSON.stringify({ imagesVerified: images.length, contentMatchesSource: true }));
} finally {
  for (const path of downloadedPaths) rmSync(path, { force: true });
}
