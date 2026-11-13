"use client";
import { Input } from "@/components/ui/input";
import { DOCUMENT_LABEL, documentInvalidMessage, displayDocument, isValidDocument, type DocumentType } from "@/lib/patient-document";

/** Tipo de documento + número. Chile: RUN/RUT con dígito verificador. Otros países: cualquier documento de identidad. */
export function PatientDocumentField({ value, docType, onChange, inputRef, testId = "patient-document" }: { value: string; docType: DocumentType; onChange: (value: string, docType: DocumentType) => void; inputRef?: React.Ref<HTMLInputElement>; testId?: string }) {
  const invalid = Boolean(value.trim()) && !isValidDocument(value, docType);
  return <div className="space-y-2">
    <label className="block space-y-1.5 text-sm font-medium">Tipo de documento
      <select value={docType} onChange={(event) => onChange(value, event.target.value === "extranjero" ? "extranjero" : "rut")} className="block h-12 w-full rounded-md border border-input bg-white px-3 text-base" data-testid={`${testId}-type`}>
        <option value="rut">{DOCUMENT_LABEL.rut}</option>
        <option value="extranjero">{DOCUMENT_LABEL.extranjero}</option>
      </select>
    </label>
    <label className="block space-y-1.5 text-sm font-medium">{docType === "extranjero" ? "Número de documento" : "RUN / RUT"}
      <Input ref={inputRef} inputMode="text" autoCapitalize="characters" autoComplete="off" value={value} maxLength={docType === "extranjero" ? 30 : 14} onChange={(event) => onChange(event.target.value, docType)} onBlur={() => { if (value.trim() && isValidDocument(value, docType)) { const next = displayDocument(value, docType); if (next !== value) onChange(next, docType); } }} placeholder={docType === "extranjero" ? "Ej. 1-0234-0567 (Costa Rica), 8-123-456 (Panamá), pasaporte…" : "12.345.678-5"} aria-invalid={invalid} data-testid={testId} />
    </label>
    {invalid && <p className="text-sm text-[#a43542]" role="alert">{documentInvalidMessage(docType)}</p>}
  </div>;
}
