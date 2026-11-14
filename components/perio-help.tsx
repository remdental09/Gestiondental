"use client";
import { useRef, useState, type ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PERIO_HELP, type PerioHelpTopic } from "@/lib/perio-help";

// Título con instrucciones: al pasar el cursor (ordenador) o al tocar (celular) muestra cómo se hace el índice.
export function PerioHelp({ topic, children }: { topic: PerioHelpTopic; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pointer = useRef("mouse");
  const help = PERIO_HELP[topic];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label={`Cómo se realiza: ${help.title}`}
          data-testid={`perio-help-${topic}`}
          onPointerEnter={event => { if (event.pointerType === "mouse") setOpen(true); }}
          onPointerLeave={event => { if (event.pointerType === "mouse") setOpen(false); }}
          onPointerDown={event => { pointer.current = event.pointerType; }}
          onClick={event => { event.preventDefault(); setOpen(old => pointer.current === "mouse" ? true : !old); }}
          onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setOpen(old => !old); } }}
          className="inline-flex cursor-help items-center gap-1 underline decoration-dotted decoration-[#8b86a3] underline-offset-4"
        >
          {children}
          <Info aria-hidden className="size-3.5 shrink-0 text-[#6a5a9c]" />
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" onOpenAutoFocus={event => event.preventDefault()} className="max-h-[70vh] w-96 max-w-[92vw] overflow-y-auto border-[#cfc9e3] bg-white p-4 text-sm font-normal normal-case text-[#35343f]">
        <p className="mb-2 font-semibold text-[#3b3355]">{help.title}</p>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-5">{help.how.map(line => <li key={line}>{line}</li>)}</ul>
        {help.scale && <ul className="mt-2 space-y-0.5 rounded-lg bg-[#f7f6fa] p-2 text-xs leading-5">{help.scale.map(line => <li key={line}>{line}</li>)}</ul>}
        {help.note && <p className="mt-2 text-xs font-medium text-[#8f1a27]">{help.note}</p>}
      </PopoverContent>
    </Popover>
  );
}
