import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../components/budget-plan.tsx", import.meta.url), "utf8");
// arancelFor es una función pura dentro del componente cliente: se evalúa aislada.
const body = src.slice(src.indexOf("export function arancelFor"), src.indexOf("export function BudgetItemsEditor"));
const arancelFor = new Function(`${body.replace("export function", "function").replace(/: Pick<[^>]+>/, "").replace(/: Record<string, number>/, "").replace(/: Array<\{[^}]+\}>/, "").replace(/\): number \| null \{/, ") {")}; return arancelFor;`)();

test("el valor del presupuesto toma el arancel por código o por prestación propia", () => {
  assert.equal(arancelFor({ code: "2304006", label: "Tratamiento conductos premolares" }, { "2304006": 230000 }, []), 230000);
  assert.equal(arancelFor({ label: "  Carilla Emax  " }, {}, [{ name: "carilla emax", price: 450000 }]), 450000);
  assert.equal(arancelFor({ label: "Otra" }, {}, [{ name: "Otra", price: null }]), null);
  assert.equal(arancelFor({ code: "999", label: "" }, {}, []), null);
});

test("el valor vacío se completa solo, una vez por prestación", () => {
  assert.match(src, /autofilled\.current\.has\(key\)/);
  assert.match(src, /if \(item\.amount > 0\) return item;/);
});
