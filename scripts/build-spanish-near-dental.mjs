// Genera lib/dictation/spanish-near-dental.ts: palabras españolas reales que se parecen a un término
// dental y que la búsqueda fonética NUNCA debe cambiar («traje», «gingival», «molestar»…).
// Uso: npm pack an-array-of-spanish-words && tar xzf an-array-of-spanish-words-*.tgz
//      node --experimental-strip-types scripts/build-spanish-near-dental.mjs package/index.json
// (lista MIT de ~636.000 palabras; no se incluye en el repo, solo el resultado filtrado).
import { readFileSync, writeFileSync } from 'node:fs';

const listPath = process.argv[2];
if (!listPath) { console.error('Falta la ruta a la lista de palabras (JSON con un arreglo de strings).'); process.exit(1); }
writeFileSync(new URL('../lib/dictation/spanish-near-dental.ts', import.meta.url), 'export const SPANISH_NEAR_DENTAL = new Set<string>([]);\n');
const { DENTAL_WORDS, nearestDentalWord } = await import('../lib/dictation/dental-lexicon.ts');
const fold = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const words = [...new Set(JSON.parse(readFileSync(listPath, 'utf8')).map(fold))].filter((w) => /^[a-zñ]{6,}$/.test(w));
const near = [];
for (const w of words) {
  if (DENTAL_WORDS.has(w)) continue;
  const hit = nearestDentalWord(w);
  if (hit && fold(hit.written) !== w) near.push(w);
}
near.sort();
const body = `// Generado por scripts/build-spanish-near-dental.mjs: ${near.length} palabras españolas reales (plegadas, sin tildes)\n// que suenan parecido a un término dental. La búsqueda fonética no las cambia nunca.\nexport const SPANISH_NEAR_DENTAL = new Set<string>(${JSON.stringify(near).replace(/","/g, '", "')});\n`;
writeFileSync(new URL('../lib/dictation/spanish-near-dental.ts', import.meta.url), body);
console.log(`${words.length} palabras revisadas, ${near.length} protegidas`);
