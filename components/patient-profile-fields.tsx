"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  EDUCATION_LEVELS, GENDERS, INSURANCES, MARITAL_STATUS, MAX_CONTACTS, PATIENT_TYPES, REFERRALS,
  validExtraPhone, type PatientContact, type PatientProfile,
} from "@/lib/patient-profile";

type Change = (patch: Partial<PatientProfile>) => void;

const selectClass = "block h-10 w-full rounded-md border border-input bg-white px-3 text-sm";
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5 text-[13px] font-medium">{label}{children}</label>;
}
function Select({ value, options, onChange, testId }: { value: string; options: readonly string[]; onChange: (value: string) => void; testId: string }) {
  return <select value={value} onChange={event => onChange(event.target.value)} className={selectClass} data-testid={testId}>
    <option value="">Seleccione…</option>
    {options.map(option => <option key={option} value={option}>{option}</option>)}
  </select>;
}
function PhoneInput({ label, value, onChange, testId }: { label: string; value: string; onChange: (value: string) => void; testId: string }) {
  return <Field label={label}><Input type="tel" inputMode="tel" value={value} maxLength={24} onChange={event => onChange(event.target.value)} aria-invalid={!validExtraPhone(value)} data-testid={testId} placeholder="+56 2 2345 6789" /></Field>;
}

/** Nombre social, género, estado civil, nivel educacional e identificador tributario. */
export function IdentityExtras({ profile, onChange }: { profile: PatientProfile; onChange: Change }) {
  return <>
    <Field label="Nombre social"><Input value={profile.socialName} maxLength={160} onChange={event => onChange({ socialName: event.target.value })} placeholder="Nombre con el que prefiere ser llamado/a" data-testid="patient-social-name" /></Field>
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Género"><Select value={profile.gender} options={GENDERS} onChange={gender => onChange({ gender })} testId="patient-gender" /></Field>
      <Field label="Estado civil"><Select value={profile.maritalStatus} options={MARITAL_STATUS} onChange={maritalStatus => onChange({ maritalStatus })} testId="patient-marital-status" /></Field>
      <Field label="Nivel educacional"><Select value={profile.education} options={EDUCATION_LEVELS} onChange={education => onChange({ education })} testId="patient-education" /></Field>
      <Field label="Identificador tributario"><Input value={profile.taxId} maxLength={30} onChange={event => onChange({ taxId: event.target.value })} placeholder="Si factura a otro RUT" data-testid="patient-tax-id" /></Field>
    </div>
  </>;
}

/** Otro teléfono, teléfono de casa y de oficina (el celular sigue siendo el campo principal de la ficha). */
export function ContactExtras({ profile, onChange }: { profile: PatientProfile; onChange: Change }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <PhoneInput label="Otro teléfono" value={profile.otherPhone} onChange={otherPhone => onChange({ otherPhone })} testId="patient-other-phone" />
    <PhoneInput label="Teléfono casa" value={profile.homePhone} onChange={homePhone => onChange({ homePhone })} testId="patient-home-phone" />
    <PhoneInput label="Teléfono oficina" value={profile.officePhone} onChange={officePhone => onChange({ officePhone })} testId="patient-office-phone" />
  </div>;
}

/** Dirección 2 y ciudad (calle, comuna y país están en la dirección principal). */
export function AddressExtras({ profile, onChange }: { profile: PatientProfile; onChange: Change }) {
  return <div className="grid gap-3 sm:grid-cols-2">
    <Field label="Dirección 2"><Input value={profile.address2} maxLength={160} onChange={event => onChange({ address2: event.target.value })} placeholder="Más datos de dirección" data-testid="patient-address2" /></Field>
    <Field label="Ciudad"><Input value={profile.city} maxLength={80} onChange={event => onChange({ city: event.target.value })} placeholder="Santiago" data-testid="patient-city" /></Field>
  </div>;
}

function ContactsEditor({ title, items, onChange, testId }: { title: string; items: PatientContact[]; onChange: (items: PatientContact[]) => void; testId: string }) {
  const update = (index: number, patch: Partial<PatientContact>) => onChange(items.map((item, i) => i === index ? { ...item, ...patch } : item));
  return <div className="space-y-2 rounded-lg border border-[#dddbe6] bg-[#faf9fd] p-3" data-testid={testId}>
    <p className="text-xs font-semibold uppercase tracking-wide text-[#473a6d]">{title}</p>
    {items.map((item, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1.4fr_1fr_1fr_auto]">
      <Input value={item.name} maxLength={160} onChange={event => update(index, { name: event.target.value })} placeholder="Nombre" aria-label={`${title}: nombre`} />
      <Input value={item.relationship} maxLength={80} onChange={event => update(index, { relationship: event.target.value })} placeholder="Parentesco" aria-label={`${title}: parentesco`} />
      <Input type="tel" inputMode="tel" value={item.phone} maxLength={24} onChange={event => update(index, { phone: event.target.value })} placeholder="Teléfono" aria-label={`${title}: teléfono`} aria-invalid={!validExtraPhone(item.phone)} />
      <Button type="button" variant="outline" size="icon" aria-label={`Quitar de ${title}`} onClick={() => { if (window.confirm(`¿Desea quitar a ${item.name || "esta persona"} de la lista?`)) onChange(items.filter((_, i) => i !== index)); }}><Trash2 className="size-4" /></Button>
    </div>)}
    {items.length < MAX_CONTACTS && <Button type="button" variant="outline" size="sm" onClick={() => onChange([...items, { name: "", relationship: "", phone: "" }])}><Plus className="mr-1.5 size-4" />Agregar</Button>}
  </div>;
}

/** Panel lateral: titular/carga, tipo, institución, convenio, previsión, aseguradora, sucursal, tratante, referencia y personas vinculadas. */
export function CarePanel({ profile, onChange }: { profile: PatientProfile; onChange: Change }) {
  const [open, setOpen] = useState<"companions" | "responsibles" | null>(null);
  const toggle = (key: "companions" | "responsibles") => setOpen(current => current === key ? null : key);
  const pill = "rounded-full bg-[#473a6d] px-4 py-2 text-sm font-medium text-white hover:bg-[#3a2f5a]";
  return <div className="space-y-3">
    <fieldset className="flex items-center justify-center gap-4 text-sm font-semibold text-[#473a6d]">
      <legend className="sr-only">Titular o carga</legend>
      <label className="flex items-center gap-1.5"><input type="radio" name="holder-type" checked={profile.holderType === "titular"} onChange={() => onChange({ holderType: "titular" })} data-testid="patient-holder" />Titular</label>
      <span aria-hidden="true">/</span>
      <label className="flex items-center gap-1.5"><input type="radio" name="holder-type" checked={profile.holderType === "carga"} onChange={() => onChange({ holderType: "carga" })} data-testid="patient-dependent" />Carga</label>
    </fieldset>
    <Field label="Tipo de paciente"><Select value={profile.patientType} options={PATIENT_TYPES} onChange={patientType => onChange({ patientType })} testId="patient-type" /></Field>
    <Field label="Institución"><Input value={profile.institution} maxLength={160} onChange={event => onChange({ institution: event.target.value })} placeholder="Empresa o institución" data-testid="patient-institution" /></Field>
    <Field label="Convenio"><Input value={profile.agreement} maxLength={160} onChange={event => onChange({ agreement: event.target.value })} placeholder="Convenio vigente" data-testid="patient-agreement" /></Field>
    <Field label="Previsión"><Select value={profile.insurance} options={INSURANCES} onChange={insurance => onChange({ insurance })} testId="patient-insurance" /></Field>
    <Field label="Aseguradora"><Input value={profile.insurer} maxLength={160} onChange={event => onChange({ insurer: event.target.value })} placeholder="Seguro complementario" data-testid="patient-insurer" /></Field>
    <Field label="Sucursal"><Input value={profile.branch} maxLength={160} onChange={event => onChange({ branch: event.target.value })} placeholder="Sucursal" data-testid="patient-branch" /></Field>
    <Field label="Tratante"><Input value={profile.attendingDentist} maxLength={160} onChange={event => onChange({ attendingDentist: event.target.value })} placeholder="Profesional tratante" data-testid="patient-attending" /></Field>
    <fieldset className="space-y-1.5">
      <legend className="text-[13px] font-semibold text-[#35343f]">Referencia</legend>
      {REFERRALS.map(option => <label key={option} className="flex items-center gap-2 text-[13px]"><input type="radio" name="patient-referral" checked={profile.referral === option} onChange={() => onChange({ referral: option })} data-testid={`patient-referral-${option}`} />{option}</label>)}
      {profile.referral && <button type="button" className="text-xs text-[#473a6d] underline" onClick={() => onChange({ referral: "" })}>Quitar referencia</button>}
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={pill} onClick={() => toggle("companions")} aria-expanded={open === "companions"} data-testid="patient-companions-toggle">Acompañantes Paciente{profile.companions.length ? ` (${profile.companions.length})` : ""}</button>
      <button type="button" className={pill} onClick={() => toggle("responsibles")} aria-expanded={open === "responsibles"} data-testid="patient-responsibles-toggle">Responsables Paciente{profile.responsibles.length ? ` (${profile.responsibles.length})` : ""}</button>
    </div>
    {open === "companions" && <ContactsEditor title="Acompañantes" items={profile.companions} onChange={companions => onChange({ companions })} testId="patient-companions" />}
    {open === "responsibles" && <ContactsEditor title="Responsables" items={profile.responsibles} onChange={responsibles => onChange({ responsibles })} testId="patient-responsibles" />}
  </div>;
}
