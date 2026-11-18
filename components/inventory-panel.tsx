"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  Boxes,
  CalendarClock,
  ClipboardList,
  Package,
  Plus,
  Search,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type MaterialCategory = "Bioseguridad" | "Anestesia" | "Restauración" | "Endodoncia" | "Impresión" | "Ortodoncia" | "Instrumental";
type CategoryFilter = "Todos" | MaterialCategory;
type InventoryItem = {
  id: number;
  name: string;
  detail: string;
  category: MaterialCategory;
  quantity: number;
  unit: string;
  minimum: number;
  location: string;
  expiration?: string;
};
type Movement = {
  id: number;
  itemId: number;
  itemName: string;
  type: "Entrada" | "Consumo";
  quantity: number;
  unit: string;
  location: string;
  when: string;
};
type DialogMode = "new" | "movement" | null;

const categories: CategoryFilter[] = ["Todos", "Bioseguridad", "Anestesia", "Restauración", "Endodoncia", "Impresión", "Ortodoncia", "Instrumental"];
const demoItems: InventoryItem[] = [
  { id: 1, name: "Guantes de nitrilo", detail: "Talla M · sin polvo", category: "Bioseguridad", quantity: 12, unit: "cajas", minimum: 6, location: "Bodega · Repisa A" },
  { id: 2, name: "Mascarillas quirúrgicas", detail: "3 pliegues · tipo IIR", category: "Bioseguridad", quantity: 8, unit: "cajas", minimum: 5, location: "Bodega · Repisa A" },
  { id: 3, name: "Anestésico lidocaína 2%", detail: "Con epinefrina · 1:100.000", category: "Anestesia", quantity: 18, unit: "carpules", minimum: 20, location: "Box 1", expiration: "2026-12-08" },
  { id: 4, name: "Resina compuesta A2", detail: "Fotopolimerizable · jeringa", category: "Restauración", quantity: 2, unit: "jeringas", minimum: 4, location: "Box 1" },
  { id: 5, name: "Agujas cortas 30G", detail: "Desechables · caja de 100", category: "Anestesia", quantity: 30, unit: "unidades", minimum: 20, location: "Box 2" },
  { id: 6, name: "Ácido fosfórico 37%", detail: "Gel grabador · jeringa", category: "Restauración", quantity: 3, unit: "jeringas", minimum: 3, location: "Box 1", expiration: "2026-11-25" },
  { id: 7, name: "Hipoclorito de sodio 5,25%", detail: "Irrigación endodóntica · frasco", category: "Endodoncia", quantity: 1, unit: "frascos", minimum: 2, location: "Box Endodoncia" },
  { id: 8, name: "Alginato", detail: "Fraguado rápido · bolsa", category: "Impresión", quantity: 4, unit: "bolsas", minimum: 2, location: "Bodega · Repisa B" },
];
const demoMovements: Movement[] = [
  { id: 1, itemId: 4, itemName: "Resina compuesta A2", type: "Consumo", quantity: 1, unit: "jeringa", location: "Box 1", when: "Hoy · 10:42" },
  { id: 2, itemId: 1, itemName: "Guantes de nitrilo talla M", type: "Consumo", quantity: 2, unit: "cajas", location: "Box 2", when: "Hoy · 09:15" },
  { id: 3, itemId: 3, itemName: "Anestésico lidocaína 2%", type: "Entrada", quantity: 10, unit: "carpules", location: "Bodega", when: "Ayer · 16:30" },
];

function daysUntil(expiration: string) {
  const [year, month, day] = expiration.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target - today) / 86_400_000);
}

function expirationLabel(expiration?: string) {
  if (!expiration) return "Sin fecha";
  const [year, month, day] = expiration.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

function itemStatus(item: InventoryItem) {
  if (item.expiration && daysUntil(item.expiration) < 0) return { label: "Vencido", className: "bg-rose-50 text-rose-700" };
  if (item.expiration && daysUntil(item.expiration) <= 30) return { label: "Por vencer", className: "bg-amber-50 text-amber-800" };
  if (item.quantity <= item.minimum) return { label: "Stock bajo", className: "bg-rose-50 text-rose-700" };
  return { label: "Disponible", className: "bg-emerald-50 text-emerald-800" };
}

export function InventoryPanel() {
  const [items, setItems] = useState(demoItems);
  const [movements, setMovements] = useState(demoMovements);
  const [category, setCategory] = useState<CategoryFilter>("Todos");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<DialogMode>(null);
  const [movementType, setMovementType] = useState<Movement["type"]>("Consumo");
  const [movementItemId, setMovementItemId] = useState(1);
  const [formError, setFormError] = useState("");
  const [notice, setNotice] = useState("");

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("es-CL");
    return items.filter(item => {
      const matchesCategory = category === "Todos" || item.category === category;
      const matchesQuery = !normalizedQuery || `${item.name} ${item.detail} ${item.location} ${item.category}`.toLocaleLowerCase("es-CL").includes(normalizedQuery);
      return matchesCategory && matchesQuery;
    });
  }, [category, items, query]);

  const lowStockCount = items.filter(item => item.quantity <= item.minimum).length;
  const expiringCount = items.filter(item => item.expiration && daysUntil(item.expiration) >= 0 && daysUntil(item.expiration) <= 30).length;
  const selectedMovementItem = items.find(item => item.id === movementItemId) ?? items[0];

  function openMovement(itemId?: number, type: Movement["type"] = "Consumo") {
    if (itemId) setMovementItemId(itemId);
    else if (items[0]) setMovementItemId(items[0].id);
    setMovementType(type);
    setFormError("");
    setDialog("movement");
  }

  function saveNewItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const quantity = Number(form.get("quantity"));
    const minimum = Number(form.get("minimum"));
    if (!name || quantity < 0 || minimum < 0) {
      setFormError("Completa el nombre y cantidades válidas para continuar.");
      return;
    }
    const newItem: InventoryItem = {
      id: Date.now(),
      name,
      detail: String(form.get("detail") ?? "").trim() || "Sin detalle adicional",
      category: String(form.get("category") ?? "Restauración") as MaterialCategory,
      quantity,
      unit: String(form.get("unit") ?? "unidades").trim() || "unidades",
      minimum,
      location: String(form.get("location") ?? "Bodega").trim() || "Bodega",
      expiration: String(form.get("expiration") ?? "") || undefined,
    };
    setItems(current => [newItem, ...current]);
    setMovementItemId(newItem.id);
    setNotice("Material agregado a esta vista de demostración.");
    setFormError("");
    setDialog(null);
  }

  function saveMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const itemId = Number(form.get("item"));
    const quantity = Number(form.get("quantity"));
    const item = items.find(candidate => candidate.id === itemId);
    if (!item || !Number.isFinite(quantity) || quantity <= 0) {
      setFormError("Indica un material y una cantidad mayor que cero.");
      return;
    }
    if (movementType === "Consumo" && quantity > item.quantity) {
      setFormError(`Solo hay ${item.quantity} ${item.unit} en esta vista.`);
      return;
    }
    const location = String(form.get("location") ?? "").trim() || item.location;
    setItems(current => current.map(candidate => candidate.id === itemId
      ? { ...candidate, quantity: candidate.quantity + (movementType === "Entrada" ? quantity : -quantity) }
      : candidate));
    setMovements(current => [{
      id: Date.now(),
      itemId,
      itemName: item.name,
      type: movementType,
      quantity,
      unit: item.unit,
      location,
      when: "Ahora",
    }, ...current]);
    setNotice(`${movementType} agregada a esta vista de demostración.`);
    setFormError("");
    setDialog(null);
  }

  return (
    <div className="space-y-6" data-testid="inventory-panel">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.12em] text-[#786b97]">Gestión de clínica</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#2b2540]">Inventario</h1>
          <p className="mt-2 max-w-2xl text-base text-[#6b6a7c]">Controla materiales, existencias, vencimientos y consumo por box.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="border-[#cfc9dc] bg-white text-[#473a6d]" onClick={() => { setFormError(""); setDialog("new"); }}>
            <Plus aria-hidden="true"/> Nuevo material
          </Button>
          <Button type="button" className="bg-[#473a6d] text-white hover:bg-[#392f59]" onClick={() => openMovement()}>
            <ArrowLeftRight aria-hidden="true"/> Registrar movimiento
          </Button>
        </div>
      </header>

      <div className="flex items-start gap-3 rounded-xl border border-[#d9d2ec] bg-[#f4f1fb] p-4 text-sm text-[#49396b]" role="note">
        <Boxes className="mt-0.5 size-5 shrink-0" aria-hidden="true"/>
        <p><strong>Diseño interactivo · datos de ejemplo.</strong> Los materiales y cantidades son demostrativos; lo que agregues o consumas solo cambia esta vista y se reinicia al recargar. Aún no hay inventario real conectado.</p>
      </div>
      {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">{notice}</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Resumen de inventario">
        <SummaryCard icon={Package} label="Materiales en catálogo" value={items.length.toLocaleString("es-CL")} detail="Materiales registrados en el ejemplo" tone="purple"/>
        <SummaryCard icon={AlertTriangle} label="Bajo el mínimo" value={lowStockCount.toLocaleString("es-CL")} detail="Revisar reposición" tone="red"/>
        <SummaryCard icon={CalendarClock} label="Vencen en 30 días" value={expiringCount.toLocaleString("es-CL")} detail="Revisar fechas y lotes" tone="amber"/>
      </section>

      <section className="overflow-hidden rounded-2xl border border-[#e2dfea] bg-white shadow-sm" aria-labelledby="materiales-heading">
        <div className="flex flex-col gap-4 border-b border-[#eeeaf4] p-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 id="materiales-heading" className="text-xl font-semibold text-[#2b2540]">Materiales</h2>
            <p className="mt-1 text-sm text-[#6b6a7c]">Existencia actual, stock mínimo y ubicación en la clínica.</p>
          </div>
          <label className="relative block w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#777287]" aria-hidden="true"/>
            <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar material o ubicación" className="pl-9" aria-label="Buscar materiales"/>
          </label>
        </div>

        <div className="flex gap-2 overflow-x-auto border-b border-[#eeeaf4] px-5 py-3" role="group" aria-label="Filtrar por categoría">
          {categories.map(option => (
            <button key={option} type="button" aria-pressed={category === option} onClick={() => setCategory(option)} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition ${category === option ? "bg-[#473a6d] text-white" : "bg-[#f5f4f8] text-[#555268] hover:bg-[#ece9f3]"}`}>
              {option}
            </button>
          ))}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-[#faf9fc] text-xs font-semibold uppercase tracking-wide text-[#716b80]">
              <tr><th className="px-5 py-3">Material</th><th className="px-4 py-3">Categoría</th><th className="px-4 py-3">Existencia</th><th className="px-4 py-3">Mínimo</th><th className="px-4 py-3">Vencimiento</th><th className="px-4 py-3">Estado</th><th className="px-5 py-3"><span className="sr-only">Acción</span></th></tr>
            </thead>
            <tbody className="divide-y divide-[#f0edf4]">
              {filteredItems.map(item => <InventoryRow key={item.id} item={item} onMovement={() => openMovement(item.id)}/>)}
            </tbody>
          </table>
        </div>

        <div className="divide-y divide-[#f0edf4] md:hidden">
          {filteredItems.map(item => <InventoryMobileCard key={item.id} item={item} onMovement={() => openMovement(item.id)}/>)}
        </div>
        {!filteredItems.length && <div className="p-10 text-center" role="status"><p className="font-semibold text-[#353244]">No encontramos materiales</p><p className="mt-1 text-sm text-[#6b6a7c]">Prueba otra búsqueda o categoría.</p></div>}
      </section>

      <section className="rounded-2xl border border-[#e2dfea] bg-white p-5 shadow-sm" aria-labelledby="movimientos-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#f0edf6] text-[#55437e]"><ClipboardList className="size-5" aria-hidden="true"/></span>
            <div><h2 id="movimientos-heading" className="text-lg font-semibold text-[#2b2540]">Movimientos recientes</h2><p className="text-sm text-[#6b6a7c]">Entradas y consumo de materiales.</p></div>
          </div>
          <span className="rounded-full bg-[#f4f1fb] px-3 py-1 text-xs font-semibold text-[#594682]">{movements.length} ejemplos</span>
        </div>
        <div className="mt-4 divide-y divide-[#f0edf4]">
          {movements.slice(0, 5).map(movement => <MovementRow key={movement.id} movement={movement}/>) }
        </div>
      </section>

      <Dialog open={dialog !== null} onOpenChange={open => { if (!open) { setDialog(null); setFormError(""); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{dialog === "new" ? "Agregar material" : "Registrar movimiento"}</DialogTitle>
            <DialogDescription>{dialog === "new" ? "Define el material y dónde se guarda." : "Registra una entrada de stock o el consumo de un box."} Este cambio solo vive en la vista de demostración.</DialogDescription>
          </DialogHeader>
          {dialog === "new" ? (
            <form className="space-y-4" onSubmit={saveNewItem}>
              <FormField label="Nombre del material" id="inventory-name"><Input autoFocus id="inventory-name" name="name" placeholder="Ej. Cemento de ionómero" required/></FormField>
              <FormField label="Detalle o presentación" id="inventory-detail"><Input id="inventory-detail" name="detail" placeholder="Marca, formato, tamaño…"/></FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Categoría" id="inventory-category"><select id="inventory-category" name="category" defaultValue="Restauración" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><CategoryOptions/></select></FormField>
                <FormField label="Unidad de control" id="inventory-unit"><Input id="inventory-unit" name="unit" placeholder="unidades, cajas…" defaultValue="unidades" required/></FormField>
                <FormField label="Cantidad disponible" id="inventory-quantity"><Input id="inventory-quantity" name="quantity" type="number" min="0" step="any" defaultValue="0" required/></FormField>
                <FormField label="Avisarme al llegar a" id="inventory-minimum"><Input id="inventory-minimum" name="minimum" type="number" min="0" step="any" defaultValue="1" required/></FormField>
              </div>
              <FormField label="Vencimiento del lote (opcional)" id="inventory-expiration"><Input id="inventory-expiration" name="expiration" type="date"/></FormField>
              <FormField label="Ubicación" id="inventory-location"><Input id="inventory-location" name="location" placeholder="Bodega, box o repisa" defaultValue="Bodega"/></FormField>
              {formError && <p role="alert" className="text-sm text-rose-700">{formError}</p>}
              <DialogFooter><Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" className="bg-[#473a6d] hover:bg-[#392f59]">Agregar a la vista</Button></DialogFooter>
            </form>
          ) : dialog === "movement" ? (
            <form className="space-y-4" onSubmit={saveMovement}>
              <div className="grid grid-cols-2 gap-2 rounded-xl bg-[#f6f5f9] p-1" role="group" aria-label="Tipo de movimiento">
                {(["Consumo", "Entrada"] as const).map(type => <button key={type} type="button" aria-pressed={movementType === type} onClick={() => { setMovementType(type); setFormError(""); }} className={`flex min-h-11 items-center justify-center gap-2 rounded-lg text-sm font-semibold ${movementType === type ? "bg-white text-[#473a6d] shadow-sm" : "text-[#686579]"}`}>{type === "Consumo" ? <ArrowUpFromLine className="size-4" aria-hidden="true"/> : <ArrowDownToLine className="size-4" aria-hidden="true"/>}{type}</button>)}
              </div>
              <FormField label="Material" id="movement-item"><select id="movement-item" name="item" value={selectedMovementItem?.id ?? ""} onChange={event => setMovementItemId(Number(event.target.value))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">{items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.quantity} {item.unit}</option>)}</select></FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={`Cantidad ${selectedMovementItem ? `(${selectedMovementItem.unit})` : ""}`} id="movement-quantity"><Input autoFocus id="movement-quantity" name="quantity" type="number" min="0.01" step="any" defaultValue="1" required/></FormField>
                <FormField label={movementType === "Consumo" ? "Box que lo utiliza" : "Dónde se almacena"} id="movement-location"><Input id="movement-location" name="location" defaultValue={movementType === "Consumo" ? "Box 1" : "Bodega"}/></FormField>
              </div>
              {selectedMovementItem && <p className="rounded-lg bg-[#f6f5f9] p-3 text-sm text-[#5b586d]">Existencia en este ejemplo: <strong>{selectedMovementItem.quantity} {selectedMovementItem.unit}</strong>. El consumo no puede superar la cantidad disponible.</p>}
              {formError && <p role="alert" className="text-sm text-rose-700">{formError}</p>}
              <DialogFooter><Button type="button" variant="outline" onClick={() => setDialog(null)}>Cancelar</Button><Button type="submit" className="bg-[#473a6d] hover:bg-[#392f59]">Registrar {movementType.toLocaleLowerCase("es-CL")}</Button></DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: "purple" | "red" | "amber" }) {
  const tones = {
    purple: "bg-[#f0edf6] text-[#56427e]",
    red: "bg-rose-50 text-rose-700",
    amber: "bg-amber-50 text-amber-800",
  };
  return <article className="rounded-2xl border border-[#e2dfea] bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-[#6b6a7c]">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-[#2b2540]">{value}</p><p className="mt-1 text-sm text-[#777488]">{detail}</p></div><span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="size-5" aria-hidden="true"/></span></div>
  </article>;
}

function InventoryRow({ item, onMovement }: { item: InventoryItem; onMovement: () => void }) {
  const status = itemStatus(item);
  return <tr className="hover:bg-[#fcfbfd]">
    <td className="px-5 py-4"><p className="font-semibold text-[#353244]">{item.name}</p><p className="mt-0.5 text-xs text-[#777488]">{item.detail} · {item.location}</p></td>
    <td className="px-4 py-4 text-[#5e5a6f]">{item.category}</td>
    <td className="px-4 py-4"><span className="font-semibold text-[#353244]">{item.quantity}</span> <span className="text-[#6b6a7c]">{item.unit}</span></td>
    <td className="px-4 py-4 text-[#6b6a7c]">{item.minimum} {item.unit}</td>
    <td className="px-4 py-4 text-[#6b6a7c]">{expirationLabel(item.expiration)}</td>
    <td className="px-4 py-4"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span></td>
    <td className="px-5 py-4"><Button type="button" size="sm" variant="outline" className="border-[#d8d2e4] text-[#473a6d]" onClick={onMovement}>Mover</Button></td>
  </tr>;
}

function InventoryMobileCard({ item, onMovement }: { item: InventoryItem; onMovement: () => void }) {
  const status = itemStatus(item);
  return <article className="space-y-3 p-4">
    <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-[#353244]">{item.name}</p><p className="mt-0.5 text-sm text-[#777488]">{item.detail}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${status.className}`}>{status.label}</span></div>
    <div className="grid grid-cols-2 gap-2 text-sm"><p className="text-[#6b6a7c]">Existencia <strong className="text-[#353244]">{item.quantity} {item.unit}</strong></p><p className="text-[#6b6a7c]">Mínimo <strong className="text-[#353244]">{item.minimum} {item.unit}</strong></p><p className="text-[#6b6a7c]">Categoría <strong className="text-[#353244]">{item.category}</strong></p><p className="text-[#6b6a7c]">Vence <strong className="text-[#353244]">{expirationLabel(item.expiration)}</strong></p></div>
    <div className="flex items-center justify-between gap-3"><span className="truncate text-sm text-[#777488]">{item.location}</span><Button type="button" size="sm" variant="outline" className="border-[#d8d2e4] text-[#473a6d]" onClick={onMovement}>Registrar uso / entrada</Button></div>
  </article>;
}

function MovementRow({ movement }: { movement: Movement }) {
  const isEntry = movement.type === "Entrada";
  return <div className="flex items-center gap-3 py-3 first:pt-4 last:pb-0">
    <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${isEntry ? "bg-emerald-50 text-emerald-700" : "bg-[#f0edf6] text-[#55437e]"}`}>{isEntry ? <ArrowDownToLine className="size-4" aria-hidden="true"/> : <ArrowUpFromLine className="size-4" aria-hidden="true"/>}</span>
    <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-[#353244]">{movement.itemName}</p><p className="mt-0.5 text-sm text-[#777488]">{movement.type} · {movement.location} · {movement.when}</p></div>
    <p className={`shrink-0 text-sm font-semibold ${isEntry ? "text-emerald-700" : "text-[#555268]"}`}>{isEntry ? "+" : "−"}{movement.quantity} {movement.unit}</p>
  </div>;
}

function FormField({ label, id, children }: { label: string; id: string; children: ReactNode }) {
  return <label htmlFor={id} className="block space-y-1.5 text-sm font-medium text-[#4e4a60]">{label}{children}</label>;
}

function CategoryOptions() {
  return <>{categories.filter(category => category !== "Todos").map(category => <option key={category} value={category}>{category}</option>)}</>;
}
