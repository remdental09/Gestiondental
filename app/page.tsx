"use client";
import { appointmentsAsEvents, chileLocalToIso } from "@/lib/appointment-events";
import { CalendarSources } from "@/components/calendar-sources";
import { TodayPanel } from "@/components/today-panel";
import { patientForEvent } from "@/lib/today-agenda";
import { AppointmentMailSettings } from "@/components/appointment-mail-settings";
import { AgendaDigestSettings } from "@/components/agenda-digest-settings";
import "@/lib/window-origin";
import { endoMilestones, evolutionMilestones } from "@/lib/tooth-evolution-milestones";
import { toothTreatments, treatmentAlerts } from "@/lib/tooth-treatments";
import { procedureSessions } from "@/lib/tooth-evolution-milestones";
import { chileTodayIso } from "@/lib/dictation/voice-command";
import { OdontogramDateBar } from "@/components/odontogram-date-bar";
import { chartAt, chartDates } from "@/lib/odontogram-timeline";
import { AnamnesisButton } from "@/components/anamnesis-dialog";
import { emptyAddress, formatAddress, type PatientAddress } from "@/lib/patient-address";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { viewerInitials } from "@/app/access-owners";
import { ProfessionalRegistration } from "@/components/professional-registration";
import { ProfileDialog } from "@/components/profile-dialog";
import { displayName as clinicianDisplayName } from "@/lib/clinician-profile";
import { Activity, ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Download, Home as HomeIcon, FilePlus2, LayoutDashboard, LogOut, Menu, Mail, Mic, Pencil, Plus, Search, Stethoscope, Trash2, Receipt, UserRound, Users, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClinicalDictation } from "@/components/clinical-dictation";
import { AnnulEvolutionDialog, type AnnulReplacement, type RemovalMode } from "@/components/evolution-annul";
import { EvolutionHistory } from "@/components/evolution-history";
import { GlobalDictation, type NewPatientFields } from "@/components/global-dictation";
import { ImprovementPanel } from "@/components/improvement-panel";
import { AuditNotice, AuditPanel } from "@/components/audit-panel";
import { GoogleDriveBackup } from "@/components/google-drive-backup";
import { BudgetCard, BudgetItemsEditor, type BudgetPlan } from "@/components/budget-plan";
import { BudgetPaymentDialog, type ManualPaymentInput } from "@/components/budget-payment-dialog";
import { BudgetPrintDialog } from "@/components/budget-print-dialog";
import { PatientPaymentSummary } from "@/components/patient-payment-summary";
import { budgetTotals, normalizeBudgetItems, plannedByTooth } from "@/lib/budget-plans";
import { buildAppUrl, parseAppUrl, resolveAppUrl, type ParsedAppUrl } from "@/lib/app-url";
const Periodontogram = lazy(() => import("@/components/periodontogram").then(module => ({ default: module.Periodontogram })));
const Odontogram = lazy(() => import("@/components/odontogram").then(module => ({ default: module.Odontogram })));
const ArancelesPanel = lazy(() => import("@/components/aranceles").then(module => ({ default: module.ArancelesPanel })));
import type { CartItem } from "@/components/aranceles";
const EndodonticsPanel = lazy(() => import("@/components/endodontics").then(module => ({ default: module.EndodonticsPanel })));
/** Cada pestaña clínica tiene su propio tono lila para reconocerla de un vistazo; la activa va con fondo sólido y letra blanca. */
const PATIENT_TABS=[
  {value:"evoluciones",label:"Evoluciones",style:"border-[#dfdbe8]! bg-[#f3f2f6]! text-[#594682]! hover:bg-[#eae7f0]! data-[state=active]:border-[#9a8db6]! data-[state=active]:bg-[#9a8db6]! data-[state=active]:text-white!"},
  {value:"odontograma",label:"Odontograma",style:"border-[#d2ccde]! bg-[#eae8f0]! text-[#514076]! hover:bg-[#e1ddea]! data-[state=active]:border-[#8772b3]! data-[state=active]:bg-[#8772b3]! data-[state=active]:text-white!"},
  {value:"periodontograma",label:"Periodontograma",style:"border-[#d7d2e2]! bg-[#eeebf3]! text-[#503f75]! hover:bg-[#e4e0ec]! data-[state=active]:border-[#7d66ad]! data-[state=active]:bg-[#7d66ad]! data-[state=active]:text-white!"},
  {value:"imagenes",label:"Imágenes",style:"border-[#c4c9f2]! bg-[#e4e7fb]! text-[#33408f]! hover:bg-[#d8dcf8]! data-[state=active]:border-[#5b6bd6]! data-[state=active]:bg-[#5b6bd6]! data-[state=active]:text-white!"},
  {value:"endodoncia",label:"Endodoncia",style:"border-[#c7c0d6]! bg-[#e0dce9]! text-[#49396b]! hover:bg-[#d5d0e1]! data-[state=active]:border-[#473a6d]! data-[state=active]:bg-[#473a6d]! data-[state=active]:text-white!"},
  {value:"ortodoncia",label:"Ortodoncia",style:"border-[#d0cadd]! bg-[#edebf2]! text-[#4d3c70]! hover:bg-[#e3dfeb]! data-[state=active]:border-[#765ea9]! data-[state=active]:bg-[#765ea9]! data-[state=active]:text-white!"},
  {value:"presupuestos",label:"Presupuestos",style:"border-[#c0b8d2]! bg-[#d9d4e4]! text-[#423360]! hover:bg-[#cfc9dc]! data-[state=active]:border-[#473a6d]! data-[state=active]:bg-[#473a6d]! data-[state=active]:text-white!"},
  {value:"aranceles",label:"Aranceles",style:"border-[#bdb4cf]! bg-[#e1dde9]! text-[#443663]! hover:bg-[#d5d0e1]! data-[state=active]:border-[#5c4886]! data-[state=active]:bg-[#5c4886]! data-[state=active]:text-white!"},
] as const;
const OrthodonticsPanel = lazy(() => import("@/components/orthodontics").then(module => ({ default: module.OrthodonticsPanel })));
const PatientImages = lazy(() => import("@/components/patient-images").then(module => ({ default: module.PatientImages })));
import { emptyOdontogram, formatFdi, summarizePerio, type ClinicalImage, type OdontogramData, type OdontogramSurface, type PerioExam, type PerioTooth, type SurfaceFinding, type ToothHistoryEvent } from "@/app/clinical-data";
import { installedImplantTeeth } from "@/app/implant-evidence";
import { cariesDetail } from "@/lib/caries";
import { cementedCrownFromEvolution } from "@/app/crown-evidence";
import { bestStoredNameMatches, hasFourNameParts, normalizePatientName } from "@/app/patient-identity";
import { nameSimilarity, type DictatedIdentity } from "@/lib/dictation/patient-identify";
import { endoMarksByTooth, priorCase, type EndoData } from "@/lib/endodontics";
import { agendaWeekDays, agendaWeekRangeLabel, mondayOfAgendaWeek, santiagoDateISO, shiftAgendaWeek } from "@/app/agenda-week";

type Patient = { id:number; name:string; birthDate:string; rut:string; phone:string; email:string; reason:string; status:string; allergies:string; history:string; address?:PatientAddress };
type NoteDiagnosis = { id?:number; code:string; title:string; tooth:number|null; findings:string; suggestedFrom?:string|null };
type Note = { id:number; patientId:number; date:string; title:string; body:string; backupStatus?:string; sourceDocumentId?:string|null; recordedAt?:string; clinicalDate?:string; diagnoses?:NoteDiagnosis[]; status?:string; annulledAt?:string|null; annulledBy?:string|null; annulReason?:string|null; replacesId?:number|null };
type Budget = BudgetPlan;
type Payment = { id:number; patientId:number; budgetId:number|null; amount:number; method:string; concept:string; paidOn:string; date:string };
type Appointment = { id:number; patientId:number; day:string; time:string; reason:string };
type CalendarEvent = { id:number; title:string; startAt:string; endAt:string; sourceTimeZone:string; htmlLink:string|null; status:string; allDay:boolean; patientId:number|null };
type WeekDay = { key:string; label:string; date:number };
type Modal = "patient"|"editPatient"|"note"|"budget"|"editBudget"|"appointment"|"editAppointment"|null;
type PatientDraft = { name:string; birthDate:string; rut:string; phone:string; email:string; reason:string };
type PatientDraftValidation = { missingFields:string[]; invalidFields:string[]; valid:boolean };
type ClinicalLoadResponse = { error?:string; viewer?:{name?:string;email?:string;registered?:boolean;clinicName?:string;developer?:boolean}; patients:Patient[]; notes:Note[]; budgets:Budget[]; payments?:Payment[]; appointments:Appointment[]; calendarEvents:CalendarEvent[]; calendarSnapshotAt?:string|null; calendarSyncedAt?:string|null; periodontalExams:Record<number,PerioExam[]>; toothStatuses:Record<number,OdontogramData>; clinicalImages:ClinicalImage[] };
type ClinicalMutationResponse = { error?:string; calendar?:string; odontogram:OdontogramData; exam:PerioExam; deleted?:boolean; patient:Patient; note:Note; budget:Budget; budgets?:Budget[]; payment?:Payment; appointment:Appointment; image:ClinicalImage; chart?:{odontogram?:OdontogramData;updatedTeeth?:number[];warning?:string} };
type ClinicalReview = { patientId:number; heading:string; details:string[]; body?:string };
type WebMcpRegistry = { registerTool(tool:{name:string;title?:string;description:string;inputSchema:object;execute:(input:unknown)=>unknown|Promise<unknown>},options?:{signal?:AbortSignal}):void|Promise<void> };
const initialPatients:Patient[] = [];
const initialNotes:Note[] = [];
const initialBudgets:Budget[] = [];
const initialAppointments:Appointment[] = [];
const initialCalendarEvents:CalendarEvent[] = [];
const money=(n:number)=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n);
const initials=(s:string)=>s.trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()).join("");
/** Celular chileno legible: +56 9 8265 9271 (solo para mostrar; no cambia el dato guardado). */
const displayPhone=(value:string)=>{const d=value.replace(/\D/g,"");const n=d.startsWith("56")&&d.length===11?d.slice(2):d;return /^9\d{8}$/.test(n)?`+56 9 ${n.slice(1,5)} ${n.slice(5)}`:value};
const sentLabel=(iso:string)=>new Intl.DateTimeFormat("es-CL",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"America/Santiago"}).format(new Date(iso)).replace(",","");
const chileDate=(value:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
const chileToday=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const get=(type:string)=>Number(parts.find(p=>p.type===type)?.value);return {year:get("year"),month:get("month"),day:get("day")}};
const ageFromBirthDate=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const [year,month,day]=value.split("-").map(Number),date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;const now=chileToday();const age=now.year-year-((now.month<month||(now.month===month&&now.day<day))?1:0);return age>=0&&age<=125?age:null};
const rutParts=(value:string)=>value.toUpperCase().replace(/[^0-9K]/g,"");
const validRut=(value:string)=>{const clean=rutParts(value),body=clean.slice(0,-1),dv=clean.slice(-1);if(!/^\d{1,9}$/.test(body)||!/[0-9K]/.test(dv))return false;let sum=0,multiplier=2;for(let i=body.length-1;i>=0;i--){sum+=Number(body[i])*multiplier;multiplier=multiplier===7?2:multiplier+1}const result=11-sum%11;return (result===11?"0":result===10?"K":String(result))===dv};
const formatRut=(value:string)=>{const clean=rutParts(value),body=clean.slice(0,-1),dv=clean.slice(-1);return body?`${Number(body).toLocaleString("es-CL")}-${dv}`:value};
const validPhone=(value:string)=>!value||(/^[+\d()\s.-]{7,24}$/.test(value)&&value.replace(/\D/g,"").length>=8);
const validEmail=(value:string)=>!value||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validExistingPatientName=(value:string,stored:string)=>{const clean=value.trim(),normalized=normalizePatientName(clean);return Boolean(normalized)&&clean.length<=180&&(normalized===normalizePatientName(stored)||normalized.split(/\s+/).filter(Boolean).length>=2)};
const validatePatientDraft=(draft:PatientDraft):PatientDraftValidation=>{const missingFields:string[]=[],invalidFields:string[]=[];if(!hasFourNameParts(draft.name))missingFields.push("Nombre y dos apellidos");if(!draft.birthDate.trim())missingFields.push("Fecha de nacimiento");else if(ageFromBirthDate(draft.birthDate)===null)invalidFields.push("Fecha de nacimiento");if(draft.rut.trim()&&!validRut(draft.rut))invalidFields.push("RUN / RUT");if(!validPhone(draft.phone.trim()))invalidFields.push("Teléfono");if(!validEmail(draft.email.trim()))invalidFields.push("Correo electrónico");return {missingFields,invalidFields,valid:missingFields.length===0&&invalidFields.length===0}};
const patientValidationMessage=(validation:PatientDraftValidation)=>[validation.missingFields.length?"Falta completar: "+validation.missingFields.join(", ")+".":"",validation.invalidFields.length?"Revisa: "+validation.invalidFields.join(", ")+".":""].filter(Boolean).join(" ");
function Info({label,value}:{label:string;value:string}){return <div><p className="text-xs font-medium uppercase tracking-wide text-[#8b8ca3]">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block space-y-1.5 text-sm font-medium">{label}{children}</label>}
function Empty({text}:{text:string}){return <p className="rounded-xl border border-dashed border-[#dddbe6] p-6 text-center text-sm text-[#6b6a7c]">{text}</p>}
function requestDriveBackup(patientId:number){
  if(!Number.isSafeInteger(patientId)||patientId<=0)return;
  void fetch("/api/drive/sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({patientId}),keepalive:true})
    .then(async response=>{const result=await response.json() as Record<string,unknown>;window.dispatchEvent(new CustomEvent("gestion-dental:drive-backup",{detail:result}))})
    .catch(()=>window.dispatchEvent(new CustomEvent("gestion-dental:drive-backup",{detail:{configured:true,connected:true,results:[{saved:false}]}})));
}
function AgendaWeekControls({weekStart,onPrevious,onNext,onCurrent}:{weekStart:string;onPrevious:()=>void;onNext:()=>void;onCurrent:()=>void}) {
  return <div className="flex flex-wrap items-center gap-2">
    <Button type="button" variant="outline" size="sm" onClick={onPrevious} aria-label="Semana anterior"><ChevronLeft className="mr-1 size-4"/>Anterior</Button>
    <Button type="button" variant="outline" size="sm" onClick={onCurrent}>Esta semana</Button>
    <Button type="button" variant="outline" size="sm" onClick={onNext} aria-label="Semana siguiente">Siguiente<ChevronRight className="ml-1 size-4"/></Button>
    <span className="text-xs font-medium text-[#6b6a7c]">{agendaWeekRangeLabel(weekStart)}</span>
  </div>;
}
/** Aviso cuando la agenda importada de Google Calendar lleva más de 36 horas sin actualizarse (la sincronización automática puede haberse detenido). */
function CalendarFreshness({syncedAt}:{syncedAt:string|null|undefined}) {
  const [now]=useState(()=>Date.now());
  if(!syncedAt) return <p role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">La agenda aún no está conectada: usa «Conectar con Google» aquí abajo.</p>;
  const when=new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(syncedAt));
  const stale=now-Date.parse(syncedAt)>36*3600*1000;
  return stale
    ? <p role="alert" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">La agenda no se actualiza desde el {when}. Las citas nuevas pueden no aparecer: conecta tu Google Calendar con el botón de abajo.</p>
    : <p className="mt-2 text-xs text-[#6b6a7c]">Agenda sincronizada con Google Calendar el {when}.</p>;
}
function WeeklyAgendaMosaic({days,events,onEdit,onDelete,onMail,marks}:{days:WeekDay[];events:CalendarEvent[];onEdit?:(event:CalendarEvent)=>void;onDelete?:(event:CalendarEvent)=>void;onMail?:(event:CalendarEvent)=>void;marks?:{confirmed:Record<number,string>;declined:number[];sent:Record<number,string>}}) {
  const timedAppointments=events.filter(event=>event.status==="confirmed"&&!event.allDay);
  const time=(value:string)=>new Intl.DateTimeFormat("es-CL",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"America/Santiago"}).format(new Date(value));
  return <div className="overflow-x-auto"><div className="grid min-w-[900px] grid-cols-7 gap-2">{days.map(day=><section key={day.key} className="min-h-36 rounded-xl border border-[#e6e4ee] bg-white"><header className="border-b border-[#ebeaf1] px-2 py-3 text-center"><p className="text-xs font-semibold uppercase text-[#6b6a7c]">{day.label}</p><p className="mt-1 text-lg font-semibold text-[#35343f]">{day.date}</p></header><div className="min-h-24 space-y-2 p-2">{timedAppointments.filter(event=>chileDate(new Date(event.startAt))===day.key).map(event=><article key={event.id} className="rounded-lg bg-[#edeaf2] px-2 py-2 text-[#3b3355]"><p className="break-words text-sm font-semibold leading-5">{event.title}</p><p className="mt-1 text-xs font-medium">{time(event.startAt)}–{time(event.endAt)}</p>{marks?.declined.includes(event.id)?<p className="mt-1 text-xs font-semibold text-[#a43542]">✗ Avisó que no asistirá</p>:marks?.confirmed[event.id]?<p className="mt-1 text-xs font-semibold text-emerald-800">✓ Confirmada</p>:null}{marks?.sent[event.id]&&!marks?.confirmed[event.id]&&!marks?.declined.includes(event.id)&&<p className="mt-1 text-[11px] font-medium text-[#473a6d]">✉ Correo enviado {sentLabel(marks.sent[event.id])}</p>}{(onEdit||onDelete||onMail)&&<div className="mt-1 flex flex-wrap items-center gap-1">{onMail&&event.id>0&&new Date(event.endAt).getTime()>Date.now()&&<button type="button" onClick={()=>onMail(event)} aria-label={`Enviar correo de confirmación de ${event.title}`} title="Enviar correo de confirmación" className="inline-flex items-center gap-1 rounded border border-[#d9d5e4] bg-white/70 px-1.5 py-0.5 text-[11px] font-medium hover:bg-white"><Mail className="size-3"/>{marks?.sent[event.id]?"Reenviar":"Enviar confirmación"}</button>}{onEdit&&<button type="button" onClick={()=>onEdit(event)} aria-label={`Editar cita ${event.title}`} title="Editar" className="rounded p-1 hover:bg-white/70"><Pencil className="size-3.5"/></button>}{onDelete&&<button type="button" onClick={()=>onDelete(event)} aria-label={`Borrar cita ${event.title}`} title="Borrar" className="rounded p-1 text-[#a43542] hover:bg-white/70"><Trash2 className="size-3.5"/></button>}</div>}</article>)}</div></section>)}</div>{timedAppointments.length===0&&<p className="mt-3 text-center text-sm text-[#6b6a7c]">No hay citas importadas para esta semana.</p>}</div>;
}
export default function Home(){
  const [apptNote,setApptNote]=useState("");
  const [patients,setPatients]=useState(initialPatients),[notes,setNotes]=useState(initialNotes),[budgets,setBudgets]=useState(initialBudgets),[payments,setPayments]=useState<Payment[]>([]),[appointments,setAppointments]=useState(initialAppointments),[calendarEvents,setCalendarEvents]=useState(initialCalendarEvents);
  const [calendarSnapshotAt,setCalendarSnapshotAt]=useState<string|null>(null),[calendarSyncedAt,setCalendarSyncedAt]=useState<string|null>(null);
  const [viewerName,setViewerName]=useState(""),[viewerEmail,setViewerEmail]=useState(""),[clinicName,setClinicName]=useState(""),[needsRegistration,setNeedsRegistration]=useState(false),[isDeveloper,setIsDeveloper]=useState(false),[profileOpen,setProfileOpen]=useState(false);
  const [periodontalExams,setPeriodontalExams]=useState<Record<number,PerioExam[]>>({}),[clinicalImages,setClinicalImages]=useState<ClinicalImage[]>([]);
  const [weekStart,setWeekStart]=useState(()=>mondayOfAgendaWeek(santiagoDateISO(new Date())));
  const weekEnd=shiftAgendaWeek(weekStart,1);
  const weekDays:WeekDay[]=agendaWeekDays(weekStart);
  const showCurrentAgendaWeek=()=>setWeekStart(mondayOfAgendaWeek(santiagoDateISO(new Date())));
  const agendaEvents=[...calendarEvents,...appointmentsAsEvents(appointments,id=>patients.find(p=>p.id===id)?.name||"Paciente",calendarEvents)];
  const weekCalendarEvents=agendaEvents.filter(event=>{const day=chileDate(new Date(event.startAt));return day>=weekStart&&day<weekEnd}).sort((a,b)=>a.startAt.localeCompare(b.startAt));

  const [selectedId,setSelectedId]=useState(0),[section,setSection]=useState("Inicio"),[modal,setModal]=useState<Modal>(null),[search,setSearch]=useState(""),[mobileNav,setMobileNav]=useState(false);
  useEffect(()=>{setApptNote("")},[selectedId]);
  const [navigationHistory,setNavigationHistory]=useState<Array<{section:string;patientId:number;tab:string}>>([]);
  const modalRef=useRef<Modal>(null);
  useEffect(()=>{modalRef.current=modal},[modal]);
  const [activeTab,setActiveTab]=useState("evoluciones");
  const [arancelCart,setArancelCart]=useState<{patientId:number;items:CartItem[]}>({patientId:0,items:[]});
  const [endoByPatient,setEndoByPatient]=useState<Record<number,EndoData>>({}),[endoFocus,setEndoFocus]=useState<number|null>(null),[endoError,setEndoError]=useState("");
  useEffect(()=>{
    if(!selectedId||endoByPatient[selectedId])return;
    let active=true;const patientId=selectedId;setEndoError("");
    void fetch(`/api/endodontics?patientId=${patientId}`,{cache:"no-store"}).then(async response=>{const result=await response.json() as {data?:EndoData;error?:string};if(!response.ok||!result.data)throw new Error(result.error||"No se pudo leer el endograma.");if(active)setEndoByPatient(previous=>({...previous,[patientId]:result.data!}));}).catch(e=>{if(active)setEndoError(e instanceof Error?e.message:"No se pudo leer el endograma.")});
    return()=>{active=false};
  },[selectedId,endoByPatient]);
  const [toothStatuses,setToothStatuses]=useState<Record<number,OdontogramData>>({});
  const [name,setName]=useState(""),[birthDate,setBirthDate]=useState(""),[rut,setRut]=useState(""),[phone,setPhone]=useState(""),[email,setEmail]=useState(""),[reason,setReason]=useState(""),[allergies,setAllergies]=useState(""),[history,setHistory]=useState(""),[patientError,setPatientError]=useState(""),[address,setAddress]=useState<PatientAddress>(emptyAddress());
  const addressRef=useRef<PatientAddress>(emptyAddress());
  const changeAddress=(patch:Partial<PatientAddress>)=>{const next={...addressRef.current,...patch};addressRef.current=next;setAddress(next)};
  const [patientAttemptedSave,setPatientAttemptedSave]=useState(false);
  const nameRef=useRef<HTMLInputElement|null>(null),birthDateRef=useRef<HTMLInputElement|null>(null),rutRef=useRef<HTMLInputElement|null>(null);
  const patientDraftRef=useRef<PatientDraft>({name:"",birthDate:"",rut:"",phone:"",email:"",reason:""});
  const [formError,setFormError]=useState("");
  const [chartMessage,setChartMessage]=useState("");
  const [saving,setSaving]=useState(false),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState("");
  const [exporting,setExporting]=useState(false),[exportError,setExportError]=useState("");
  const savingRef=useRef(false);
  const requestIdRef=useRef("");
  const [clinicalReview,setClinicalReview]=useState<ClinicalReview|null>(null);
  const reviewResolver=useRef<((confirmed:boolean)=>void)|null>(null);
  const finishReview=(confirmed:boolean)=>{reviewResolver.current?.(confirmed);reviewResolver.current=null;setClinicalReview(null)};
  const reviewChange=(review:ClinicalReview)=>new Promise<boolean>(resolve=>{
    if(reviewResolver.current){resolve(false);return}
    reviewResolver.current=resolve;setClinicalReview(review);
  });
  useEffect(()=>()=>{reviewResolver.current?.(false);reviewResolver.current=null},[]);
  useEffect(()=>{
    let active=true,requestRunning=false;
    const refresh=async()=>{
      if(requestRunning)return;
      requestRunning=true;
      try{
        // Si la respuesta no llega en 15 s, se avisa con «Reintentar» en vez de quedarse en «Cargando fichas…».
        const response=await fetch("/api/clinical",{cache:"no-store",signal:AbortSignal.timeout(15000)});
        const data=await response.json().catch(()=>({error:"La sesión pudo haber expirado: recarga la página."})) as ClinicalLoadResponse;
        if(!response.ok)throw new Error(data.error||"No se pudo abrir la base de datos.");
        if(!active)return;
        setPatients(data.patients);setNotes(data.notes);setBudgets(data.budgets);setPayments(data.payments??[]);setAppointments(data.appointments);setCalendarEvents(data.calendarEvents||[]);setCalendarSnapshotAt(data.calendarSnapshotAt||null);setCalendarSyncedAt(data.calendarSyncedAt||null);setViewerName(data.viewer?.name||"");setClinicName(data.viewer?.clinicName||"");setViewerEmail(data.viewer?.email||"");setNeedsRegistration(data.viewer?.registered===false);setIsDeveloper(data.viewer?.developer===true);
        setPeriodontalExams(data.periodontalExams);setToothStatuses(data.toothStatuses);setClinicalImages(data.clinicalImages);setLoadError("");
      }catch(e){if(active)setLoadError(e instanceof DOMException&&(e.name==="TimeoutError"||e.name==="AbortError")?"La carga de fichas está tardando demasiado (conexión lenta o sin señal). Tus fichas están a salvo.":e instanceof Error&&e.message!=="Failed to fetch"&&e.message!=="Load failed"?e.message:(typeof navigator!=="undefined"&&navigator.onLine?"La sesión pudo haber vencido (se renueva cada cierto tiempo). Pulsa «Reintentar» para volver a entrar. Tus fichas están a salvo.":"No se pudo conectar con la aplicación. Revisa la conexión. Tus fichas están a salvo."));}
      finally{requestRunning=false;if(active)setLoading(false)}
    };
    (window as unknown as {__gdReady?:boolean}).__gdReady=true;
    const onFocus=()=>{void refresh()};
    const onVisibility=()=>{if(document.visibilityState==="visible")void refresh()};
    void refresh();
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisibility);
    return ()=>{active=false;window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisibility)};
  },[]);
  const persist=useCallback(async(input:Record<string,unknown>)=>{
    const response=await fetch("/api/clinical",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)});
    const data=await response.json() as ClinicalMutationResponse;
    if(!response.ok)throw new Error(data.error||"No se pudo guardar.");
    const patientId=Number(input.patientId||((data as {patient?:{id?:number}}).patient?.id)||0);
    requestDriveBackup(patientId);
    return data;
  },[]);
  const [agendaMarks,setAgendaMarks]=useState<{confirmed:Record<number,string>;declined:number[];sent:Record<number,string>}>({confirmed:{},declined:[],sent:{}}),[marksNonce,setMarksNonce]=useState(0);
  useEffect(()=>{let alive=true;void fetch("/api/appointment-confirmations",{cache:"no-store"}).then(async response=>{if(alive&&response.ok){const data=await response.json() as {confirmed?:Record<number,string>;declined?:number[];sent?:Record<number,string>};setAgendaMarks({confirmed:data.confirmed??{},declined:data.declined??[],sent:data.sent??{}})}}).catch(()=>{});return()=>{alive=false}},[calendarEvents,marksNonce]);
  type MailPreview={patientName:string;email:string;day:string;time:string;from:string;previousSentAt:string|null;previousResponse:string|null};
  const [mailDialog,setMailDialog]=useState<{event:CalendarEvent;loading:boolean;preview?:MailPreview;error?:string;sent?:string}|null>(null);
  /** Evento de la agenda que corresponde a una cita de la ficha (mismo paciente y misma hora). */
  const agendaEventFor=(a:Appointment)=>{const iso=chileLocalToIso(a.day,a.time)?.slice(0,16);const name=patients.find(p=>p.id===a.patientId)?.name||"";return iso?agendaEvents.find(e=>e.startAt.slice(0,16)===iso&&(e.patientId===a.patientId||(!!name&&e.title.startsWith(name)))):undefined};
  /** Citas de Google Calendar que se reconocen como de este paciente (por nombre, celular o correo) y aún no ocurren; así la ficha las muestra aunque se hayan agendado directo en Calendar. */
  const calendarUpcomingFor=(patientId:number)=>{const own=new Set(appointments.filter(a=>a.patientId===patientId).map(a=>agendaEventFor(a)?.id).filter((id):id is number=>id!==undefined));return calendarEvents.filter(e=>e.status==="confirmed"&&!e.allDay&&new Date(e.endAt).getTime()>Date.now()&&!own.has(e.id)&&patientForEvent(e,patients)?.id===patientId).sort((a,b)=>a.startAt.localeCompare(b.startAt))};
  const mailAgendaEvent=async(event:CalendarEvent)=>{setMailDialog({event,loading:true});try{const response=await fetch(`/api/appointment-mail?eventId=${event.id}`,{cache:"no-store"});const data=await response.json().catch(()=>({})) as {preview?:MailPreview;error?:string};setMailDialog({event,loading:false,...(response.ok&&data.preview?{preview:data.preview}:{error:data.error||"No se pudo preparar el correo."})})}catch{setMailDialog({event,loading:false,error:"No se pudo preparar el correo."})}};
  const sendMailDialog=async()=>{if(!mailDialog?.preview)return;const current=mailDialog;setMailDialog({...current,loading:true});try{const response=await fetch("/api/appointment-mail",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({eventId:current.event.id})});const data=await response.json().catch(()=>({})) as {detail?:string;error?:string};setMailDialog({...current,loading:false,...(response.ok?{sent:data.detail||"Correo enviado"}:{error:data.error||"No se pudo enviar el correo."})});if(response.ok)setMarksNonce(n=>n+1)}catch{setMailDialog({...current,loading:false,error:"No se pudo enviar el correo."})}};
  const [agendaEdit,setAgendaEdit]=useState<{event:CalendarEvent;title:string;day:string;time:string}|null>(null),[agendaError,setAgendaError]=useState(""),[agendaBusy,setAgendaBusy]=useState(false);
  const reloadAgenda=async()=>{const response=await fetch("/api/clinical",{cache:"no-store"});if(response.ok)applyClinicalLoad(await response.json() as ClinicalLoadResponse)};
  const callAgenda=async(body:Record<string,unknown>)=>{setAgendaBusy(true);setAgendaError("");try{const response=await fetch("/api/calendar",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await response.json().catch(()=>({})) as {error?:string};if(!response.ok)throw new Error(data.error||"No se pudo completar la acción.");await reloadAgenda();return ""}catch(cause){const message=cause instanceof Error?cause.message:"No se pudo completar la acción.";setAgendaError(message);return message}finally{setAgendaBusy(false)}};
  const deleteAgendaEvent=async(event:CalendarEvent)=>{if(!window.confirm(`¿Borrar la cita «${event.title}»? También se borra de tu Google Calendar y no se puede deshacer.`))return;const failure=await callAgenda({action:"deleteEvent",eventId:event.id});if(failure)window.alert(failure)};
  const startEditAgendaEvent=(event:CalendarEvent)=>{const start=new Date(event.startAt);const day=chileDate(start);const time=new Intl.DateTimeFormat("es-CL",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"America/Santiago"}).format(start);setAgendaError("");setAgendaEdit({event,title:event.title,day,time})};
  const [newAppt,setNewAppt]=useState<{name:string;phone:string;reason:string;day:string;time:string;minutes:number}|null>(null);
  const openNewAppt=()=>{setAgendaError("");setNewAppt({name:"",phone:"",reason:"",day:chileTodayIso(),time:"",minutes:30})};
  const saveNewAppt=async()=>{if(!newAppt)return;const title=[(newAppt.name.trim()||"Paciente nuevo")+(newAppt.phone.trim()?` ${newAppt.phone.trim()}`:""),newAppt.reason.trim()].filter(Boolean).join(" · ");if(!await callAgenda({action:"createEvent",title,day:newAppt.day,time:newAppt.time,minutes:newAppt.minutes}))setNewAppt(null)};
  const saveAgendaEdit=async()=>{if(!agendaEdit)return;if(!await callAgenda({action:"updateEvent",eventId:agendaEdit.event.id,title:agendaEdit.title,day:agendaEdit.day,time:agendaEdit.time}))setAgendaEdit(null)};
  const applyClinicalLoad=useCallback((data:ClinicalLoadResponse)=>{
    setPatients(data.patients);setNotes(data.notes);setBudgets(data.budgets);setPayments(data.payments??[]);setAppointments(data.appointments);setCalendarEvents(data.calendarEvents||[]);setCalendarSnapshotAt(data.calendarSnapshotAt||null);setCalendarSyncedAt(data.calendarSyncedAt||null);
    setPeriodontalExams(data.periodontalExams);setToothStatuses(data.toothStatuses);setClinicalImages(data.clinicalImages);setLoadError("");
  },[]);
  const downloadClinicalRecords=useCallback(async(format:"json"|"md"="json")=>{
    setExporting(true);setExportError("");
    try{
      const response=await fetch(format==="md"?"/api/clinical/export?format=md":"/api/clinical/export",{cache:"no-store"});
      if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error||"No se pudieron descargar las fichas.")}
      const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");
      link.href=url;link.download=`gestion-dental-pacientes-${chileToday().year}-${String(chileToday().month).padStart(2,"0")}-${String(chileToday().day).padStart(2,"0")}.${format}`;
      document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){setExportError(error instanceof Error?error.message:"No se pudieron descargar las fichas.")}
    finally{setExporting(false)}
  },[]);
  const [noteTitle,setNoteTitle]=useState(""),[noteBody,setNoteBody]=useState("");
  const [dictationRequest,setDictationRequest]=useState<{nonce:number;text:string;patientId:number;ignoreCommand?:boolean;incorporate?:boolean}|null>(null);
  const [showAnnulled,setShowAnnulled]=useState(false),[annulTarget,setAnnulTarget]=useState<Note|null>(null);
  /** Elimina definitivamente o anula (y opcionalmente reemplaza) una evolución tras la confirmación explícita del dentista. */
  const annulEvolution=useCallback(async(patientId:number,evolutionId:number,mode:RemovalMode,reason:string,replacement:AnnulReplacement|null)=>{
    const extra=replacement?{replacementTitle:replacement.title,replacementBody:replacement.body}:{};
    const result=await persist(mode==="delete"?{action:"deleteEvolution",patientId,evolutionId,confirm:"eliminar",...extra}:{action:"annulEvolution",patientId,evolutionId,reason,...extra}) as {revertedTeeth?:number[]|null;revertedLinks?:string[]|null};
    const response=await fetch("/api/clinical",{cache:"no-store"});
    if(response.ok)applyClinicalLoad(await response.json() as ClinicalLoadResponse);
    const done=mode==="delete"?"Evolución eliminada":"Evolución anulada (visible con «Ver anuladas»)";
    const teeth=result?.revertedTeeth;
    const chartNote=teeth===null?" No se pudo verificar el odontograma: revísalo.":teeth?.length?` Se deshicieron sus cambios en el odontograma (${teeth.map(formatFdi).join(", ")}).`:"";
    const links=(result as {revertedLinks?:string[]|null})?.revertedLinks;
    const linkNote=links===null?" No se pudo verificar el endograma ni el periodontograma: revísalos.":links?.length?` También se deshizo lo que registró en: ${links.join(", ")}.`:"";
    setChartMessage(`${done}${replacement?" y nueva evolución guardada":""}.${chartNote}${linkNote} Los pagos no cambian solos.`);
    if(links?.some(item=>item.startsWith("endograma")))setEndoByPatient(previous=>{const next={...previous};delete next[patientId];return next});
  },[persist,applyClinicalLoad]);
  // Fecha para ver el odontograma «al día X» (null = hoy, editable). Se vuelve a hoy al cambiar de paciente.
  const [chartDate,setChartDate]=useState<string|null>(null);
  const [perioDate,setPerioDate]=useState<string|null>(null);
  const [endoDate,setEndoDate]=useState<string|null>(null),[endoDays,setEndoDays]=useState<string[]>([]),[endoPast,setEndoPast]=useState<EndoData|null>(null);
  useEffect(()=>{setChartDate(null);setPerioDate(null);setEndoDate(null);setEndoPast(null);setEndoDays([])},[selectedId]);
  useEffect(()=>{
    if(activeTab!=="endodoncia"||!selectedId)return;
    let live=true;
    fetch(`/api/endodontics?patientId=${selectedId}&versions=1`,{cache:"no-store"}).then(r=>r.ok?r.json() as Promise<{days?:string[]}>:null).then(r=>{if(live&&r?.days)setEndoDays(r.days)}).catch(()=>{});
    return()=>{live=false};
  },[activeTab,selectedId,endoByPatient]);
  useEffect(()=>{
    if(!endoDate||!selectedId){setEndoPast(null);return}
    let live=true;setEndoPast(null);
    fetch(`/api/endodontics?patientId=${selectedId}&at=${endoDate}`,{cache:"no-store"}).then(r=>r.ok?r.json() as Promise<{data?:EndoData}>:null).then(r=>{if(live&&r?.data)setEndoPast(r.data)}).catch(()=>{});
    return()=>{live=false};
  },[endoDate,selectedId]);
  const perioDay=(exam:PerioExam)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(exam.recordedAt));
  const readOnlyChart=useCallback(async()=>{throw new Error("Estás viendo una fecha pasada. Vuelve a «Hoy» para editar el odontograma.")},[]);
  const [voiceToolsReady,setVoiceToolsReady]=useState(false);
  const [budgetTitle,setBudgetTitle]=useState(""),[budgetItems,setBudgetItems]=useState<BudgetPlan["items"]>([{label:"",amount:0,phase:"Fase 1",discountPercent:0}]);
  const [editingBudgetId,setEditingBudgetId]=useState<number|null>(null);
  const [alternativeParentBudgetId,setAlternativeParentBudgetId]=useState<number|null>(null);
  const [printingBudgetId,setPrintingBudgetId]=useState<number|null>(null);
  const [paymentBudgetId,setPaymentBudgetId]=useState<number|null>(null);
  const [editingAppointmentId,setEditingAppointmentId]=useState<number|null>(null);
  const [apptDate,setApptDate]=useState(""),[apptTime,setApptTime]=useState(""),[apptReason,setApptReason]=useState("");
  const apptDateRef=useRef<HTMLInputElement|null>(null),apptTimeRef=useRef<HTMLInputElement|null>(null);
  const patient=patients.find(p=>p.id===selectedId)??null;
  const patientValidation=validatePatientDraft({name,birthDate,rut,phone,email,reason});
  const selectedPerio=summarizePerio(periodontalExams[selectedId]?.[0]);
  const patientImages=clinicalImages.filter(item=>item.patientId===selectedId&&!item.kind.endsWith("ortodoncia")&&item.kind!=="RX endodoncia");
  const orthoImages=clinicalImages.filter(item=>item.patientId===selectedId&&item.kind.endsWith("ortodoncia"));
  const endoImages=clinicalImages.filter(item=>item.patientId===selectedId&&item.kind==="RX endodoncia");
  const endoData=endoByPatient[selectedId];
  const endoMarks=useMemo(()=>endoData?endoMarksByTooth(endoData):{},[endoData]);
  const perioAlerts=patients.map(p=>({patient:p,summary:summarizePerio(periodontalExams[p.id]?.[0]),date:periodontalExams[p.id]?.[0]?.recordedAt})).filter(item=>item.summary.attention>0);
  const filteredPatients=useMemo(()=>{
    const query=search.trim();
    const nameQuery=query.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es");
    const rutQuery=/\d/.test(query)?rutParts(query):"";
    const bestNameMatches=bestStoredNameMatches(query,patients);
    if(!rutQuery&&bestNameMatches.length)return bestNameMatches;
    return patients.filter(p=>p.name.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es").includes(nameQuery)||(rutQuery!==""&&p.rut!==""&&rutParts(p.rut).includes(rutQuery)));
  },[patients,search]);
  // Las anuladas (error clínico) se ocultan y se ven tachadas con «Ver anuladas»; las eliminadas por error del sistema ya no existen.
  const liveNotes=notes.filter(n=>n.status!=="anulada");
  const patientNotesAll=notes.filter(n=>n.patientId===selectedId),annulledCount=patientNotesAll.length-patientNotesAll.filter(n=>n.status!=="anulada").length;
  const patientNotes=patientNotesAll.filter(n=>n.status!=="anulada"),patientBudgets=budgets.filter(b=>b.patientId===selectedId),patientPayments=payments.filter(p=>p.patientId===selectedId);
  const printingBudget=patientBudgets.find(b=>b.id===printingBudgetId)??null;
  // Pendientes por tiempo de todos los pacientes (provisorio sin definitiva, endodoncia a medias o sin rehabilitar…), para Inicio.
  const pendingAcrossPatients=patients.flatMap(p=>{
    const sessions=notes.filter(n=>n.patientId===p.id&&n.status!=="anulada").flatMap(n=>procedureSessions(n.body,n.clinicalDate,n.id));
    if(!sessions.length)return[];
    const plan=Object.entries(plannedByTooth(budgets.filter(b=>b.patientId===p.id))).flatMap(([tooth,items])=>items.map(item=>({...item,tooth:Number(tooth)})));
    return treatmentAlerts(toothTreatments(sessions,plan),chileTodayIso()).map(alert=>({...alert,patientId:p.id,patientName:p.name}));
  }).sort((a,b)=>b.days-a.days);
  const plannedTeeth=plannedByTooth(patientBudgets);
  // Tratamientos por pieza con estado (planificado / en curso / realizado), derivados del plan y de los procedimientos de las evoluciones.
  const toothTreatmentMap=toothTreatments(evolutionMilestones(patientNotes).filter(e=>/:proc\d+$/.test(e.id)).map(e=>({tooth:e.tooth,date:e.clinicalDate,text:e.detail??e.title??"",noteId:e.sourceEvolutionId})),Object.entries(plannedTeeth).flatMap(([tooth,items])=>items.map(item=>({...item,tooth:Number(tooth)}))));
  const paymentTargetBudget=patientBudgets.find(b=>b.id===paymentBudgetId)??null;
  const paymentTargetPaid=paymentTargetBudget?patientPayments.filter(p=>p.budgetId===paymentTargetBudget.id).reduce((sum,p)=>sum+p.amount,0):0;
  const toothEvolutionHistory:ToothHistoryEvent[]=(patientNotes.flatMap(note=>(note.diagnoses??[]).filter(diagnosis=>diagnosis.tooth!==null).map((diagnosis,index)=>({
    id:`diagnosis:${note.id}:${diagnosis.id??index}`,
    tooth:diagnosis.tooth as number,
    recordedAt:note.recordedAt??(note.clinicalDate?`${note.clinicalDate}T12:00:00.000Z`:""),
    clinicalDate:note.clinicalDate,
    eventType:"diagnosis" as const,
    source:"evolution" as const,
    sourceEvolutionId:note.id,
    title:diagnosis.title,
    detail:[diagnosis.code?`CIE-11 ${diagnosis.code}`:"",diagnosis.findings].filter(Boolean).join(" · "),
  }))) as ToothHistoryEvent[]).concat(evolutionMilestones(patientNotes),endoMilestones(endoByPatient[selectedId]?.cases??[],patientNotes));
  const nav=[{name:"Inicio",icon:HomeIcon},{name:"Resumen",icon:LayoutDashboard},{name:"Pacientes",icon:Users},{name:"Ficha clínica",icon:Stethoscope},{name:"Agenda",icon:CalendarDays},{name:"Presupuestos",icon:Wallet},{name:"Aranceles",icon:Receipt}];
  const goHome=()=>{setSection("Inicio");setNavigationHistory([]);setMobileNav(false)};
  const navigateTo=(destination:string,id=selectedId,tab=activeTab)=>{
    setLinkNotice("");
    const next=destination==="Ficha clínica"&&!patients.some(item=>item.id===id)?"Pacientes":destination;
    if(section!==next||next==="Ficha clínica"&&(selectedId!==id||activeTab!==tab))setNavigationHistory(previous=>[...previous.slice(-19),{section,patientId:selectedId,tab:activeTab}]);
    setSelectedId(id);setActiveTab(tab);setSection(next);setMobileNav(false);
  };
  const openSection=(destination:string)=>destination==="Inicio"?goHome():navigateTo(destination);
  const openPatient=(id:number,tab="evoluciones")=>navigateTo("Ficha clínica",id,tab);
  // Dictado desde Inicio: la ficha ya fue elegida (o creada) y confirmada; se abre y la IA corrige el texto allí.
  const openDictatedPatient=async(id:number,text:string,options?:{ignoreCommand?:boolean;incorporate?:boolean;identity?:DictatedIdentity})=>{
    const identity=options?.identity;
    const selected=patients.find(item=>item.id===id);
    const notices:string[]=[];
    if(identity&&selected){
      const nameMatches=!identity.name||nameSimilarity(identity.name,selected.name)>=0.5;
      if(!nameMatches)notices.push("El nombre dictado no coincide con la ficha. No se completaron datos personales.");
      else{
        const updates:Record<string,string>={};
        const cleanRutValue=(value:string)=>value.toUpperCase().replace(/[^0-9K]/g,"");
        const dictatedRut=identity.rut;
        if(dictatedRut&&identity.rutValid&&validRut(dictatedRut)){
          if(selected.rut&&cleanRutValue(selected.rut)!==cleanRutValue(dictatedRut))notices.push("El RUT dictado difiere del RUT registrado; no se sobrescribió.");
          else if(!selected.rut&&!patients.some(item=>item.id!==id&&cleanRutValue(item.rut||"")===cleanRutValue(dictatedRut)))updates.rut=dictatedRut;
          else if(!selected.rut)notices.push("Ese RUT ya está asociado a otra ficha; no se guardó.");
        }
        if(identity.birthDate&&ageFromBirthDate(identity.birthDate)!==null){
          if(selected.birthDate&&selected.birthDate!==identity.birthDate)notices.push("La fecha de nacimiento dictada difiere de la registrada; no se sobrescribió.");
          else if(!selected.birthDate)updates.birthDate=identity.birthDate;
        }
        if(identity.phone&&validPhone(identity.phone)){
          const same=selected.phone.replace(/\D/g,"")===identity.phone.replace(/\D/g,"");
          if(selected.phone&&!same)notices.push("El teléfono dictado difiere del registrado; no se sobrescribió.");
          else if(!selected.phone)updates.phone=identity.phone;
        }
        if(identity.email&&validEmail(identity.email)){
          const same=selected.email.trim().toLowerCase()===identity.email.trim().toLowerCase();
          if(selected.email&&!same)notices.push("El correo dictado difiere del registrado; no se sobrescribió.");
          else if(!selected.email)updates.email=identity.email;
        }
        if(Object.keys(updates).length){
          try{
            const saved=await persist({action:"updatePatient",patientId:id,...updates});
            if(saved.patient)setPatients(previous=>previous.map(item=>item.id===id?saved.patient:item));
          }catch{
            notices.push("No se pudieron completar automáticamente todos los datos personales. La atención seguirá y nada del dictado se pierde.");
          }
        }
      }
    }
    if(notices.length)setChartMessage(notices.join(" "));
    setNavigationHistory(previous=>[...previous.slice(-19),{section,patientId:selectedId,tab:activeTab}]);
    setSelectedId(id);setActiveTab("evoluciones");setSection("Ficha clínica");setMobileNav(false);
    if(text.trim().length>=3)setDictationRequest({nonce:Date.now(),text:text.trim(),patientId:id,...(options?.ignoreCommand?{ignoreCommand:true}:{}),...(options?.incorporate?{incorporate:true}:{})});
  };
  // «Crear paciente» dictado: abre el formulario vacío; los datos sensibles se escriben a mano. Si el dictado traía la atención, se lleva a la ficha nueva al guardar.
  const pendingDictationRef=useRef("");
  const openNewPatientForm=(text:string)=>{resetModal();pendingDictationRef.current=text;patientDraftRef.current={name:"",birthDate:"",rut:"",phone:"",email:"",reason:""};modalRef.current="patient";setPatientAttemptedSave(false);setPatientError("");setModal("patient");setMobileNav(false);window.setTimeout(()=>nameRef.current?.focus(),50)};
  const createDictatedPatient=async(fields:NewPatientFields)=>{
    if(!hasFourNameParts(fields.name))throw new Error("Escribe el nombre y los dos apellidos.");
    const data=await persist({action:"createPatient",name:fields.name.trim(),birthDate:fields.birthDate,rut:fields.rut.trim()&&validRut(fields.rut.trim())?formatRut(fields.rut.trim()):fields.rut.trim(),phone:fields.phone.trim(),email:fields.email.trim()});
    if(!data.patient)throw new Error("No se pudo crear el paciente.");
    const created=data.patient as Patient;
    setPatients(previous=>[created,...previous.filter(item=>item.id!==created.id)]);
    return created.id;
  };
  // URL ⇄ navegación: cada ficha/pestaña/sección queda en el historial del navegador (Atrás de Safari iOS).
  const [linkNotice,setLinkNotice]=useState("");
  const urlReadyRef=useRef(false);
  const applyUrl=useCallback((parsed:ParsedAppUrl)=>{
    const view=resolveAppUrl(parsed,new Set(patients.map(item=>item.id)),selectedId);
    setSelectedId(view.patientId);setActiveTab(view.tab);setSection(view.section);setMobileNav(false);
    setLinkNotice(view.notFound?"No encontramos esa ficha en tu cuenta. Elige un paciente de la lista.":"");
    return view;
  },[patients,selectedId]);
  const applyUrlRef=useRef(applyUrl);
  useEffect(()=>{applyUrlRef.current=applyUrl},[applyUrl]);
  useEffect(()=>{
    if(loading||loadError||urlReadyRef.current)return;
    const parsed=parseAppUrl(window.location.search);
    const view=applyUrlRef.current(parsed);
    // Normaliza la URL de entrada (p. ej. un id que no es de esta cuenta) sin crear una entrada de historial.
    window.history.replaceState({gd:true},"",buildAppUrl(view));
    urlReadyRef.current=true;
  },[loading,loadError]);
  useEffect(()=>{
    if(!urlReadyRef.current)return;
    const url=buildAppUrl({section,patientId:selectedId,tab:activeTab});
    const current=window.location.pathname+window.location.search;
    if(current!==url)window.history.pushState({gd:true},"",url);
  },[section,selectedId,activeTab]);
  useEffect(()=>{
    const onPop=()=>{if(!urlReadyRef.current)return;applyUrlRef.current(parseAppUrl(window.location.search));setNavigationHistory(history=>history.slice(0,-1))};
    window.addEventListener("popstate",onPop);
    return()=>window.removeEventListener("popstate",onPop);
  },[]);
  const tabPatientName=patient?.name;
  useEffect(()=>{const base="Gestión Dental";document.title=section==="Ficha clínica"&&tabPatientName?`${tabPatientName} · ${base}`:base;return ()=>{document.title=base}},[section,tabPatientName]);
  const headerRef=useRef<HTMLElement|null>(null),[headerHeight,setHeaderHeight]=useState(76);
  useEffect(()=>{
    const element=headerRef.current;if(!element)return;
    const update=()=>setHeaderHeight(element.offsetHeight);update();
    const observer=new ResizeObserver(update);observer.observe(element);
    return()=>observer.disconnect();
  },[]);
  const goBack=()=>{
    const previous=navigationHistory.at(-1);
    if(!previous){goHome();return}
    setNavigationHistory(history=>history.slice(0,-1));
    setSelectedId(previous.patientId);setActiveTab(previous.tab);setSection(previous.section);setMobileNav(false);
  };
  const addImages=async(files:File[],kind:ClinicalImage["kind"],note:string)=>{
    for(const file of files){
      const data=new FormData();data.set("file",file);data.set("name",file.name);data.set("patientId",String(selectedId));data.set("kind",kind);data.set("note",note);
      const response=await fetch("/api/images",{method:"POST",body:data});
      const result=await response.json() as {error?:string;image:ClinicalImage};
      if(!response.ok)throw new Error(result.error||"No se pudo guardar la imagen.");
      setClinicalImages(previous=>[result.image,...previous]);
    }
    requestDriveBackup(selectedId);
  };
  const saveEndo=async(next:EndoData)=>{
    const patientId=selectedId;
    const response=await fetch("/api/endodontics",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({patientId,data:next})});
    const result=await response.json() as {data?:EndoData;error?:string};
    if(!response.ok||!result.data)throw new Error(result.error||"No se pudo guardar el endograma.");
    setEndoByPatient(previous=>({...previous,[patientId]:result.data!}));
    return result.data;
  };
  const setPriorEndo=async(tooth:number,on:boolean,year="")=>{
    const base=endoByPatient[selectedId];
    if(!base)throw new Error("El endograma aún no carga; espera un momento.");
    const rest=base.cases.filter(c=>!(c.tooth===tooth&&c.prior));
    const day=new Date().toISOString().slice(0,10);
    await saveEndo({...base,cases:on?[...rest,priorCase(crypto.randomUUID(),tooth,day,year)]:rest});
  };
  const uploadOrthoImage=async(file:File,kind:"Foto ortodoncia"|"RX ortodoncia"|"RX endodoncia",note:string)=>{
    const patientId=selectedId,data=new FormData();data.set("file",file);data.set("name",file.name);data.set("patientId",String(patientId));data.set("kind",kind);data.set("note",note);
    const response=await fetch("/api/images",{method:"POST",body:data});
    const result=await response.json() as {error?:string;image:ClinicalImage};
    if(!response.ok)throw new Error(result.error||"No se pudo guardar la imagen.");
    setClinicalImages(previous=>[result.image,...previous]);
    requestDriveBackup(patientId);
    return result.image;
  };
  const addOrthoNote=async(title:string,body:string,clinicalDate:string,link?:{kind:string;ref:string})=>{
    const patientId=selectedId;
    const noteData=await persist({action:"addNote",patientId,title,body,clinicalDate,requestId:crypto.randomUUID(),...(link?{link}:{})});
    setNotes(previous=>[noteData.note,...previous.filter(n=>n.id!==noteData.note.id)]);
  };
  const removeImage=async(id:number)=>{
    const response=await fetch("/api/images/"+id,{method:"DELETE"});
    const result=await response.json() as {error?:string};
    if(!response.ok)throw new Error(result.error||"No se pudo quitar la imagen.");
    setClinicalImages(previous=>previous.filter(item=>item.id!==id));
    requestDriveBackup(selectedId);
  };
  const updateTooth=async(tooth:number,status:string)=>{
    if(!await reviewChange({patientId:selectedId,heading:"Estado del odontograma",details:[`Pieza FDI ${formatFdi(tooth)}: ${toothStatuses[selectedId]?.teeth[tooth]||"Sin hallazgos"} → ${status}.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"setToothStatus",patientId:selectedId,tooth,status});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const removeToothLesion=async(tooth:number,status:string)=>{
    if(!await reviewChange({patientId:selectedId,heading:"Estado del odontograma",details:[`Pieza FDI ${formatFdi(tooth)}: se quita «${status}».`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"removeToothLesion",patientId:selectedId,tooth,status});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const deleteToothEvent=async(tooth:number,eventId:string,title:string)=>{
    if(!await reviewChange({patientId:selectedId,heading:"Eliminar hito de la pieza",details:[`Pieza FDI ${formatFdi(tooth)}: se quitará «${title}» de su historial. El estado actual de la pieza no cambia.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"deleteToothHistoryEvent",patientId:selectedId,eventId});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const editToothEvent=async(tooth:number,eventId:string,fields:{title:string;detail:string;clinicalDate:string})=>{
    if(!await reviewChange({patientId:selectedId,heading:"Corregir hito de la pieza",details:[`Pieza FDI ${formatFdi(tooth)}: «${fields.title}»${fields.detail?` — ${fields.detail}`:""}${fields.clinicalDate?`, fecha ${fields.clinicalDate.split("-").reverse().join("-")}`:""}.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"updateToothHistoryEvent",patientId:selectedId,eventId,...fields});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const editPerioReading=async(tooth:number,examId:number,reading:PerioTooth,clinicalDate:string)=>{
    if(!await reviewChange({patientId:selectedId,heading:"Corregir medición periodontal",details:[`Pieza FDI ${formatFdi(tooth)}: se reemplaza la medición del examen${clinicalDate?` y su fecha pasa a ${clinicalDate.split("-").reverse().join("-")} (afecta a todo el examen)`:""}.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"updatePerioToothReading",patientId:selectedId,examId,tooth,reading,...(clinicalDate?{clinicalDate}:{})});
    setPeriodontalExams(previous=>({...previous,[selectedId]:(previous[selectedId]??[]).map(exam=>exam.id===examId?data.exam:exam)}));
  };
  const deletePerioReading=async(tooth:number,examId:number,day:string)=>{
    if(!await reviewChange({patientId:selectedId,heading:"Eliminar medición periodontal",details:[`Pieza FDI ${formatFdi(tooth)}: se eliminará la medición del examen del ${day}. Las demás piezas del examen no cambian.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"deletePerioToothReading",patientId:selectedId,examId,tooth});
    setPeriodontalExams(previous=>({...previous,[selectedId]:(previous[selectedId]??[]).flatMap(exam=>exam.id!==examId?[exam]:data.deleted?[]:[data.exam])}));
  };
  const updateCrownDetails=async(tooth:number,material:string,shade:string,foundation?:"tooth"|"implant")=>{
    const support=foundation==="implant"?"sobre implante":"sobre diente natural";
    if(!await reviewChange({patientId:selectedId,heading:"Corregir soporte de corona",details:[`Pieza FDI ${formatFdi(tooth)}: corona de ${material||"material sin consignar"} ${support}${shade?`, color ${shade}`:""}.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"setCrownDetails",patientId:selectedId,tooth,material,shade,foundation});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const updateMissingReason=async(tooth:number,reason:"caries"|"other"|"unknown")=>{
    if(!await reviewChange({patientId:selectedId,heading:"Causa de ausencia",details:[`Pieza FDI ${formatFdi(tooth)}: ${reason==="caries"?"caries":reason==="other"?"otra causa":"causa sin registrar"}.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"setToothMissingReason",patientId:selectedId,tooth,reason});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const updateSurface=async(tooth:number,surface:OdontogramSurface,finding:SurfaceFinding)=>{
    if(!await reviewChange({patientId:selectedId,heading:"Hallazgo por superficie",details:[`Pieza FDI ${formatFdi(tooth)}, cara ${surface}: ${finding.condition}${finding.condition==="caries"?` · ${cariesDetail(finding)}`:""}.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"setToothSurface",patientId:selectedId,tooth,surface,finding});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const savePerio=async(exam:PerioExam)=>{
    const rows=Object.entries(exam.teeth).sort(([a],[b])=>Number(a)-Number(b)).map(([tooth,record])=>{
      const sites=Object.entries(record.sites).filter(([,reading])=>reading&&(reading.depth!==null||reading.margin!==null||reading.bleeding||reading.suppuration)).map(([site,reading])=>`${site}: sondaje ${reading?.depth??"—"} mm, margen ${reading?.margin??"—"} mm${reading?.bleeding?", sangrado":""}${reading?.suppuration?", supuración":""}`);
      const gingival=Object.entries(record.gingivalIndex??{}).map(([site,value])=>`${site} ${value}`);
      return `FDI ${formatFdi(Number(tooth))}: ${[...sites,gingival.length?`índice gingival ${gingival.join(", ")}`:"",record.mobility?`movilidad ${record.mobility}`:"",record.furcation?`furcación ${record.furcation}`:""].filter(Boolean).join("; ")||"sin mediciones"}.`;
    });
    const epb=Object.entries(exam.epb??{}).map(([sextant,code])=>`${sextant}: ${code}`);
    const classification=exam.classification;
    if(!await reviewChange({patientId:selectedId,heading:"Examen periodontal",details:[...(epb.length?[`EPB por sextante: ${epb.join(", ")}.`]:[]),...(classification?.stage?[`Clasificación consignada: estadio ${classification.stage}${classification.grade?`, grado ${classification.grade}`:""}${classification.extent?`, ${classification.extent}`:""}.`]:[]),...rows]}))throw new Error("Examen cancelado; no se guardó.");
    const data=await persist({action:"savePerio",patientId:selectedId,teeth:exam.teeth,epb:exam.epb,classification:exam.classification});
    setPeriodontalExams(previous=>({...previous,[selectedId]:[data.exam,...(previous[selectedId]??[])]}));
  };
  const resetModal=useCallback(()=>{pendingDictationRef.current="";setFormError("");setModal(null);modalRef.current=null;setName("");setBirthDate("");setRut("");setPhone("");setEmail("");setReason("");setAllergies("");setHistory("");addressRef.current=emptyAddress();setAddress(emptyAddress());patientDraftRef.current={name:"",birthDate:"",rut:"",phone:"",email:"",reason:""};setPatientError("");setPatientAttemptedSave(false);setNoteTitle("");setNoteBody("");requestIdRef.current="";setBudgetTitle("");setBudgetItems([{label:"",amount:0,phase:"Fase 1",discountPercent:0}]);setEditingBudgetId(null);setAlternativeParentBudgetId(null);setEditingAppointmentId(null);setApptDate("");setApptTime("");setApptReason("")},[setAllergies,setAlternativeParentBudgetId,setApptDate,setApptReason,setApptTime,setBudgetItems,setBudgetTitle,setEmail,setHistory,setName,setNoteBody,setNoteTitle,setPhone,setRut]);
  const editPatient=()=>{if(!patient)return;setName(patient.name);setRut(patient.rut||"");setPhone(patient.phone||"");setEmail(patient.email||"");setAllergies(patient.allergies==="Sin registrar"?"":patient.allergies);setHistory(patient.history==="Sin registrar"?"":patient.history);{const a={...emptyAddress(),...(patient.address??{})};addressRef.current=a;setAddress(a)}setModal("editPatient")};
  const editBudget=(budget:Budget)=>{if(!patient||budget.patientId!==selectedId)return;setEditingBudgetId(budget.id);setAlternativeParentBudgetId(null);setBudgetTitle(budget.title);setBudgetItems(budget.items.map(item=>({label:item.label,amount:item.amount,phase:item.phase||"Fase 1",discountPercent:item.discountPercent??0})));setModal("editBudget")};
  // Desde la pestaña Aranceles de la ficha: las prestaciones elegidas pasan a un presupuesto nuevo o a uno existente del paciente.
  const sendArancelToBudget=(items:CartItem[],targetId:number|null)=>{
    if(!patient)return;
    const mapped=items.map(item=>({label:item.label,amount:item.amount,phase:"Fase 1",discountPercent:0,...(item.code?{code:item.code}:{})}));
    if(targetId===null){setBudgetTitle("");setBudgetItems(mapped);setEditingBudgetId(null);setAlternativeParentBudgetId(null);setModal("budget")}
    else{
      const budget=patientBudgets.find(entry=>entry.id===targetId);
      if(!budget)return;
      setEditingBudgetId(budget.id);setAlternativeParentBudgetId(null);setBudgetTitle(budget.title);
      setBudgetItems([...budget.items.map(item=>({...item,phase:item.phase||"Fase 1",discountPercent:item.discountPercent??0})),...mapped]);
      setModal("editBudget");
    }
    setArancelCart({patientId:selectedId,items:[]});
  };
  const startNewBudget=()=>{setBudgetTitle("");setBudgetItems([{label:"",amount:0,phase:"Fase 1",discountPercent:0}]);setEditingBudgetId(null);setAlternativeParentBudgetId(null);setModal("budget")};
  const startBudgetAlternative=(budget:Budget)=>{setBudgetTitle(budget.title+" · Alternativa");setBudgetItems(budget.items.map(item=>({label:item.label,amount:item.amount,phase:item.phase||"Fase 1",discountPercent:item.discountPercent??0})));setEditingBudgetId(null);setAlternativeParentBudgetId(budget.id);setModal("budget")};
  const setBudgetItemDone=async(budgetId:number,index:number,doneOn:string|null)=>{
    const data=await persist({action:"setBudgetItemDone",patientId:selectedId,budgetId,index,done:doneOn!==null,...(doneOn?{doneOn}:{})});
    setBudgets(previous=>previous.map(b=>b.id===budgetId?data.budget:b));
  };
  const selectBudgetAlternative=async(budget:Budget)=>{
    if(!patient||budget.patientId!==selectedId||!budget.isAlternative)return;
    if(!window.confirm("¿Establecer «"+budget.title+"» como plan principal? El plan actual pasará a ser una alternativa. No se trasladarán pagos."))return;
    try{
      const data=await persist({action:"selectBudgetAlternative",patientId:selectedId,budgetId:budget.id});
      if(!data.budgets)throw new Error("No se pudo actualizar el grupo de alternativas.");
      setBudgets(previous=>[...previous.filter(item=>item.patientId!==selectedId),...data.budgets!]);
      setChartMessage("La alternativa quedó establecida como plan principal. Los pagos no se trasladaron.");
    }catch(error){setChartMessage(error instanceof Error?error.message:"No se pudo cambiar el plan principal.")}
  };
  const openManualPayment=(budget:Budget)=>{
    if(!patient||budget.patientId!==selectedId||budget.isAlternative)return;
    setPaymentBudgetId(budget.id);
  };
  const saveManualPayment=async(input:ManualPaymentInput)=>{
    const budget=patientBudgets.find(item=>item.id===input.budgetId);
    if(!patient||!budget||budget.patientId!==selectedId||budget.isAlternative)throw new Error("El tratamiento ya no está disponible para registrar pagos.");
    const paid=patientPayments.filter(payment=>payment.budgetId===budget.id).reduce((sum,payment)=>sum+payment.amount,0);
    const balance=Math.max(0,budgetTotals(budget.items).total-paid);
    if(input.amount>balance)throw new Error("El saldo cambió. Revisa el plan y vuelve a ingresar el monto.");
    const data=await persist({action:"addPayment",patientId:selectedId,budgetId:budget.id,amount:input.amount,method:input.method,concept:input.concept,paidOn:input.paidOn,requestId:input.requestId});
    const savedPayment=data.payment;
    if(!savedPayment)throw new Error("El servidor no confirmó el registro del pago.");
    setPayments(previous=>[savedPayment,...previous.filter(payment=>payment.id!==savedPayment.id)]);
    setChartMessage("Pago o abono de $"+input.amount.toLocaleString("es-CL")+" registrado en «"+budget.title+"». Saldo pendiente: $"+Math.max(0,balance-input.amount).toLocaleString("es-CL")+".");
  };
  const deleteFichaAppointment=async(appointment:Appointment)=>{if(!window.confirm(`¿Borrar la cita del ${appointment.day} a las ${appointment.time} (${appointment.reason})? También se borra de tu Google Calendar.`))return;try{const data=await persist({action:"deleteAppointment",patientId:appointment.patientId,appointmentId:appointment.id});setAppointments(previous=>previous.filter(a=>a.id!==appointment.id));setApptNote(JSON.stringify({iso:"",text:data.calendar==="error"?"Cita borrada de la ficha, pero no se pudo borrar en Google Calendar; bórrala allá.":data.calendar==="solo-lectura"?"Cita borrada de la ficha. Tu Google Calendar está solo para lectura: bórrala allá.":"✓ Cita borrada de la ficha y de la agenda."}));await reloadAgenda()}catch(e){window.alert(e instanceof Error?e.message:"No se pudo borrar la cita.")}};
  const editAppointment=(appointment:Appointment)=>{setSelectedId(appointment.patientId);setEditingAppointmentId(appointment.id);setApptReason(appointment.reason);setApptDate(appointment.day.split("-").reverse().join("-"));setApptTime(appointment.time);setModal("editAppointment")};
  const savePatientDraft=useCallback(async(draft:PatientDraft)=>{
    const clean={name:draft.name.trim(),birthDate:draft.birthDate.trim(),rut:draft.rut.trim(),phone:draft.phone.trim(),email:draft.email.trim(),reason:draft.reason.trim()};
    const validation=validatePatientDraft(clean);
    setPatientAttemptedSave(true);
    if(!validation.valid){
      const message=patientValidationMessage(validation);
      setPatientError(message);
      if(validation.missingFields.includes("Nombre completo"))window.setTimeout(()=>nameRef.current?.focus(),0);
      else if(validation.missingFields.includes("Fecha de nacimiento")||validation.invalidFields.includes("Fecha de nacimiento"))window.setTimeout(()=>birthDateRef.current?.focus(),0);
      else if(validation.invalidFields.includes("RUN / RUT"))window.setTimeout(()=>rutRef.current?.focus(),0);
      throw new Error(message);
    }
    const data=await persist({action:"createPatient",name:clean.name,birthDate:clean.birthDate,rut:clean.rut&&validRut(clean.rut)?formatRut(clean.rut):clean.rut,phone:clean.phone,email:clean.email,reason:clean.reason,address:addressRef.current});
    setPatients(previous=>[data.patient,...previous]);setSelectedId(data.patient.id);setNavigationHistory([]);setSection("Ficha clínica");
    return data.patient as Patient;
  },[persist]);
  const save=async()=>{
    if(savingRef.current)return;
    savingRef.current=true;setSaving(true);setFormError("");setPatientError("");
    try{
      if(modal==="patient"){
        const birth=birthDateRef.current?.value||birthDate;
        const patientDraft={name,birthDate:birth,rut,phone,email,reason};
        patientDraftRef.current=patientDraft;
        const created=await savePatientDraft(patientDraft);
        const dictated=pendingDictationRef.current;pendingDictationRef.current="";
        if(created&&dictated.split(/\s+/).filter(Boolean).length>=15)setDictationRequest({nonce:Date.now(),text:dictated,patientId:created.id});
      }
      if(modal==="editPatient"){
        if(!validPhone(phone.trim())||!validEmail(email.trim())||(rut.trim()&&!validRut(rut.trim())))throw new Error("Revisa el RUN / RUT, teléfono y correo electrónico.");
        if(!validExistingPatientName(name,patient?.name||""))throw new Error("Para cambiar el nombre de una ficha existente, ingresa al menos un nombre y un apellido.");
        const data=await persist({action:"updatePatient",patientId:selectedId,name:name.trim(),rut:rut.trim()&&validRut(rut.trim())?formatRut(rut.trim()):rut.trim(),phone:phone.trim(),email:email.trim(),allergies:allergies.trim(),history:history.trim(),address});
        setPatients(previous=>previous.map(p=>p.id===selectedId?data.patient:p));
      }
      if(modal==="note"){
        if(!noteBody.trim())throw new Error("Escribe o dicta el registro clínico antes de guardar.");
        const body=noteBody.trim(),crown=cementedCrownFromEvolution(body),implants=installedImplantTeeth(body);
        const details=[...(implants.length?[`Posible actualización automática del odontograma: implante en FDI ${implants.map(formatFdi).join(", ")}.`]:[]),...(crown?[`Posible actualización automática: corona${crown.onImplant?" sobre implante":""} en FDI ${formatFdi(crown.tooth)}${crown.material?`, material ${crown.material}`:""}${crown.shade?`, color ${crown.shade}`:""}.`]:[])];
        if(!await reviewChange({patientId:selectedId,heading:noteTitle.trim()||"Evolución clínica",details,body}))return;
        requestIdRef.current ||= crypto.randomUUID();
        const data=await persist({action:"addNote",patientId:selectedId,title:noteTitle.trim(),body:noteBody.trim(),requestId:requestIdRef.current});
        setNotes(previous=>[data.note,...previous.filter(n=>n.id!==data.note.id)]);
        const savedOdontogram=data.chart?.odontogram;
        if(savedOdontogram)setToothStatuses(previous=>({...previous,[selectedId]:savedOdontogram}));
        setChartMessage(data.chart?.warning|| (data.chart?.updatedTeeth?.length?`Odontograma actualizado: FDI ${data.chart.updatedTeeth.map(formatFdi).join(", ")}.`:""));
      }
      if(modal==="budget"){
        const items=normalizeBudgetItems(budgetItems);
        if(!budgetTitle.trim()||!items)throw new Error("Completa el nombre del plan y verifica que cada prestación tenga descripción y valor válido.");
        const data=await persist({action:"addBudget",patientId:selectedId,title:budgetTitle.trim(),items,...(alternativeParentBudgetId?{parentBudgetId:alternativeParentBudgetId}:{})});
        setBudgets(previous=>[data.budget,...previous]);
      }
      if(modal==="editBudget"){
        const items=normalizeBudgetItems(budgetItems);
        if(!editingBudgetId||!budgetTitle.trim()||!items)throw new Error("Completa el nombre del plan y verifica que cada prestación tenga descripción y valor válido.");
        const data=await persist({action:"updateBudget",patientId:selectedId,budgetId:editingBudgetId,title:budgetTitle.trim(),items});
        setBudgets(previous=>previous.map(b=>b.id===editingBudgetId?data.budget:b));
      }
      if(modal==="appointment"){
        const day=apptDateRef.current?.value||apptDate,time=apptTimeRef.current?.value||apptTime;
        if(!day||!time||!apptReason.trim())throw new Error("Completa la fecha, la hora y el motivo de la cita.");
        const data=await persist({action:"addAppointment",patientId:selectedId,day,time,reason:apptReason.trim()});
        setAppointments(previous=>[data.appointment,...previous]);
        {const [d,m,y]=String(data.appointment.day).split("-");const iso=`${y}-${m}-${d}`;const label=new Intl.DateTimeFormat("es-CL",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"}).format(new Date(`${iso}T12:00:00Z`)).replace(",","");
        setApptNote(JSON.stringify({iso,text:`✓ Cita agendada para ${patient?.name||"el paciente"}: ${label} a las ${data.appointment.time}. Ya aparece en la agenda de la semana`+(data.calendar==="ok"?" y en tu Google Calendar.":data.calendar==="solo-lectura"?". Tu Google Calendar está solo para lectura: reconéctalo en Agenda para que también se escriba allá.":data.calendar==="error"?", pero no se pudo escribir en Google Calendar.":".")}));}
      }
      if(modal==="editAppointment"){
        if(!editingAppointmentId||!apptReason.trim()||!apptDate||!apptTime)throw new Error("Completa la fecha, la hora y el motivo de la cita.");
        const data=await persist({action:"updateAppointment",patientId:selectedId,appointmentId:editingAppointmentId,day:apptDate,time:apptTime,reason:apptReason.trim()});
        setAppointments(previous=>previous.map(a=>a.id===editingAppointmentId?data.appointment:a));
        {const [d,m,y]=String(data.appointment.day).split("-");const iso=`${y}-${m}-${d}`;const label=new Intl.DateTimeFormat("es-CL",{weekday:"long",day:"numeric",month:"long",timeZone:"UTC"}).format(new Date(`${iso}T12:00:00Z`)).replace(",","");
        setApptNote(JSON.stringify({iso,text:`✓ Cita cambiada: ${label} a las ${data.appointment.time}`+(data.calendar==="ok"?". También quedó cambiada en tu Google Calendar.":data.calendar==="solo-lectura"?". Tu Google Calendar está solo para lectura: cámbiala allá o reconéctalo en Agenda.":data.calendar==="error"?", pero no se pudo cambiar en Google Calendar; revísala allá.":".")}));}
        await reloadAgenda();
      }
      resetModal();
    }catch(e){const message=e instanceof Error?e.message:"No se pudo guardar.";if(modal==="patient")setPatientError(message);else setFormError(message);}
    finally{savingRef.current=false;setSaving(false)}
  };
  useEffect(()=>{
    const registry=typeof document==="undefined"?undefined:(document as Document&{readonly modelContext?:WebMcpRegistry}).modelContext;
    if(typeof registry?.registerTool!=="function")return;
    const lifecycle=new AbortController();
    const parseDraftInput=(input:unknown):Partial<PatientDraft>=>{
      if(!input||typeof input!=="object"||Array.isArray(input))throw new Error("Envía los datos como un objeto.");
      const source=input as Record<string,unknown>,allowed=["name","birthDate","rut","phone","email","reason"];
      if(Object.keys(source).some(key=>!allowed.includes(key)))throw new Error("El borrador contiene un campo no admitido.");
      const patch:Partial<PatientDraft>={};
      for(const key of Object.keys(source)){
        const value=source[key],limit=key==="name"?180:key==="birthDate"?40:key==="rut"?20:key==="phone"?24:key==="email"?254:240;
        if(typeof value!=="string"||value.length>limit)throw new Error("Revisa el dato de "+key+".");
        patch[key as keyof PatientDraft]=value.trim();
      }
      return patch;
    };
    const prepareTool={
      name:"prepare_patient_intake",
      title:"Preparar ficha de paciente",
      description:"Abre o actualiza el borrador de un paciente con datos dictados por el clínico. Normaliza la fecha a AAAA-MM-DD. Nunca guarda. Devuelve los campos obligatorios pendientes para que puedas preguntarlos en voz alta.",
      inputSchema:{type:"object",properties:{name:{type:"string",description:"Nombre completo del paciente"},birthDate:{type:"string",description:"Fecha de nacimiento en formato AAAA-MM-DD"},rut:{type:"string",description:"RUN o RUT chileno, si se proporcionó"},phone:{type:"string",description:"Teléfono de contacto, si se proporcionó"},email:{type:"string",description:"Correo electrónico, si se proporcionó"},reason:{type:"string",description:"Motivo de consulta, si se proporcionó"}},additionalProperties:false},
      execute:(input:unknown)=>{
        try{
          const patch=parseDraftInput(input);
          const startingNew=modalRef.current!=="patient";
          const base=startingNew?{name:"",birthDate:"",rut:"",phone:"",email:"",reason:""}:patientDraftRef.current;
          const draft={...base,...patch};
          patientDraftRef.current=draft;modalRef.current="patient";
          setName(draft.name);setBirthDate(draft.birthDate);setRut(draft.rut);setPhone(draft.phone);setEmail(draft.email);setReason(draft.reason);
          setModal("patient");setPatientAttemptedSave(true);
          const validation=validatePatientDraft(draft),message=patientValidationMessage(validation);
          setPatientError(message);
          return {prepared:true,readyToSave:validation.valid,missingFields:validation.missingFields,invalidFields:validation.invalidFields,nextQuestion:validation.missingFields[0]?"Pregunta por "+validation.missingFields[0].toLowerCase()+".":validation.invalidFields[0]?"Pide que confirme "+validation.invalidFields[0].toLowerCase()+".":null};
        }catch(error){return {prepared:false,error:error instanceof Error?error.message:"No pude leer los datos del borrador."}}
      }
    };
    const saveTool={
      name:"save_patient_intake",
      title:"Guardar ficha de paciente",
      description:"Guarda el borrador solo si el clínico confirmó verbalmente. La aplicación gestiona el respaldo en el Google Drive que autorice este usuario. No bloquees el guardado clínico si Drive no está conectado o falla; informa que la ficha se guardó en Gestión Dental y que el respaldo quedó pendiente.",
      inputSchema:{type:"object",properties:{confirmed:{type:"boolean",description:"Debe ser true solo después de oír al clínico confirmar que guarde la ficha."}},required:["confirmed"],additionalProperties:false},
      async execute(input:unknown){
        if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).some(key=>key!=="confirmed")||!("confirmed" in input)||typeof (input as {confirmed?:unknown}).confirmed!=="boolean")return {saved:false,error:"La confirmación de guardado no tiene un formato válido."};
        if((input as {confirmed?:unknown}).confirmed!==true)return {saved:false,needsVerbalConfirmation:true,message:"Pregunta al clínico si desea guardar la ficha."};
        if(modalRef.current!=="patient")return {saved:false,error:"Primero prepara la ficha del paciente."};
        if(savingRef.current)return {saved:false,error:"La ficha ya se está guardando."};
        savingRef.current=true;setSaving(true);setPatientError("");
        try{
          const saved=await savePatientDraft(patientDraftRef.current);
          resetModal();
          return {saved:true,patient:{id:saved.id,name:saved.name,birthDate:saved.birthDate,rut:saved.rut,reason:saved.reason,status:saved.status,history:saved.history,allergies:saved.allergies},driveBackupManagedByApplication:true,backupStatus:"La aplicación sincroniza el respaldo si este usuario conectó Google Drive."};
        }catch(error){
          const message=error instanceof Error?error.message:"No se pudo guardar.";
          setPatientError(message);
          const validation=validatePatientDraft(patientDraftRef.current);
          return {saved:false,error:message,missingFields:validation.missingFields,invalidFields:validation.invalidFields};
        }finally{savingRef.current=false;setSaving(false)}
      }
    };
    const register=async()=>{
      try{
        await Promise.all([
          registry.registerTool(prepareTool,{signal:lifecycle.signal}),
          registry.registerTool(saveTool,{signal:lifecycle.signal})
        ]);
        if(!lifecycle.signal.aborted)setVoiceToolsReady(true);
      }catch(error){console.error("No se pudieron habilitar las acciones de voz de la ficha.",error)}
    };
    void register();
    return ()=>{lifecycle.abort()};
  },[resetModal,savePatientDraft]);
  const sidebarContent=<><div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6"><button type="button" onClick={goHome} className="flex size-10 items-center justify-center rounded-xl bg-[#ef895f] text-lg font-bold" aria-label="Ir a Inicio">{viewerInitials(viewerName)}</button><span className="leading-tight">{viewerEmail?<button type="button" onClick={()=>setProfileOpen(true)} title="Cambiar el nombre de la clínica" data-testid="clinic-name" className="block max-w-[11rem] truncate text-left text-sm font-bold hover:underline">{clinicName||"Gestión Dental"}</button>:<strong className="block text-sm">{clinicName||"Gestión Dental"}</strong>}<small className="block text-[#c3bbd3]">{viewerName||"\u00a0"}</small>{viewerEmail&&viewerEmail!==viewerName&&<small className="block max-w-[11rem] truncate text-[11px] text-[#c3bbd3]" title={viewerEmail}>{viewerEmail}</small>}</span><button className="ml-auto lg:hidden" aria-label="Cerrar menú" onClick={()=>setMobileNav(false)}><X className="size-5"/></button></div><nav className="flex-1 space-y-1 px-3 py-7" aria-label="Principal">{nav.map(({name,icon:Icon})=><button key={name} type="button" aria-current={section===name?"page":undefined} onClick={()=>openSection(name)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${section===name?"fx-nav-active text-white":"text-[#cec8dc] hover:bg-white/10 hover:text-white"}`}><Icon className="size-[19px]"/>{name}</button>)}</nav></>;
  return <div className="min-h-screen bg-[#f1f0f5] text-[#35343f]">
    <div className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-gradient-to-b from-[#2a2540] via-[#473a6d] to-[#6d4f8f] text-white lg:flex">{sidebarContent}</div>
    {mobileNav&&<div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={()=>setMobileNav(false)}><div className="flex h-full w-[260px] flex-col bg-[#473a6d] text-white" onClick={e=>e.stopPropagation()}>{sidebarContent}</div></div>}
    <div className="lg:pl-[248px]">
      {profileOpen&&!needsRegistration&&<ProfileDialog email={viewerEmail} onClose={()=>setProfileOpen(false)} onSaved={profile=>{setViewerName(clinicianDisplayName(profile));setClinicName(profile.clinicName||"")}}/>}
      {needsRegistration&&<ProfessionalRegistration email={viewerEmail} onSaved={profile=>{setViewerName(clinicianDisplayName(profile));setNeedsRegistration(false);}}/>}
      <header ref={headerRef} className="fx-glass sticky top-0 z-20 border-b border-[#dddbe6]/70">
        <div className="flex h-[76px] items-center justify-between px-5 md:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="lg:hidden" aria-label="Abrir menú" onClick={()=>setMobileNav(true)}><Menu className="size-6"/></button>
            {section!=="Inicio"&&<button type="button" onClick={goBack} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[#473a6d] hover:bg-[#e6e4ee]" aria-label="Volver a la sección anterior"><ArrowLeft className="size-4"/><span className="hidden sm:inline">Volver</span></button>}
            <button type="button" onClick={goHome} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[#473a6d] hover:bg-[#e6e4ee]"><HomeIcon className="size-4"/><span className="hidden sm:inline">Inicio</span></button>
            <span className="min-w-0 truncate text-sm font-semibold text-[#35343f]">{section}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 sm:inline">Ficha privada</span>
            {viewerEmail&&<button type="button" onClick={()=>setProfileOpen(true)} className="flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-[#dddbe6] bg-[#f7f6fa] px-3 text-sm font-semibold text-[#473a6d] hover:border-[#9d93c4] hover:bg-[#e6e4ee]" title={viewerName?`${viewerName} · ${viewerEmail} — editar mi perfil`:`${viewerEmail} — editar mi perfil`} aria-label="Mi perfil: editar mis datos" data-testid="open-profile"><UserRound className="size-4 shrink-0"/><span className="hidden max-w-[16rem] truncate sm:inline">{viewerName||viewerEmail}</span><span className="sm:hidden">Mi perfil</span></button>}
            {isDeveloper&&<a href="/desarrollador" className="flex min-h-10 items-center gap-2 rounded-lg border border-[#c9c2e3] bg-[#efedf7] px-3 text-sm font-semibold text-[#473a6d] hover:border-[#9d93c4] hover:bg-[#e6e4ee]" aria-label="Panel del desarrollador: dentistas registrados"><LayoutDashboard className="size-4"/><span className="hidden md:inline">Desarrollador</span></a>}
            {/* Cloudflare Access cierra la sesión en esta ruta y vuelve a la pantalla de ingreso, para entrar con otra cuenta. */}
            <a href="/auth/salir" className="flex min-h-10 items-center gap-2 rounded-lg border border-[#dddbe6] px-3 text-sm font-medium text-[#57566a] hover:border-[#9d93c4] hover:bg-[#f7f6fa] hover:text-[#473a6d]" aria-label="Cerrar sesión para entrar con otra cuenta"><LogOut className="size-4"/><span className="hidden sm:inline">Cerrar sesión</span></a>
          </div>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-5 pb-3 lg:hidden md:px-9" aria-label="Ir a otra sección">
          {nav.map(({name,icon:Icon})=><button key={name} type="button" aria-current={section===name?"page":undefined} onClick={()=>openSection(name)} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium ${section===name?"border-[#473a6d] bg-[#e6e4ee] text-[#473a6d]":"border-[#dddbe6] bg-white text-[#57566a]"}`}><Icon className="size-4"/>{name}</button>)}
        </nav>
      </header>
      <Dialog open={!!mailDialog} onOpenChange={open=>{if(!open)setMailDialog(null)}}><DialogContent><DialogHeader><DialogTitle>Enviar correo de confirmación</DialogTitle><DialogDescription>Revisa a quién le llegará antes de enviarlo.</DialogDescription></DialogHeader>{mailDialog&&<div className="space-y-3 text-sm">{mailDialog.loading&&!mailDialog.preview&&<p role="status">Buscando la ficha del paciente…</p>}{mailDialog.preview&&<div className="rounded-lg border border-[#e6e4ee] bg-[#f6f5f9] p-3"><p className="text-[#6b6a7c]">Vas a enviar el correo de confirmación a:</p><p className="mt-1 text-base font-semibold">{mailDialog.preview.patientName}</p><p className="font-medium text-[#473a6d]">{mailDialog.preview.email}</p><p className="mt-2">Cita: <strong>{mailDialog.preview.day}</strong> a las <strong>{mailDialog.preview.time}</strong></p><p className="mt-1 text-xs text-[#6b6a7c]">Sale desde {mailDialog.preview.from}. El paciente podrá confirmar o avisar que no asistirá.</p>{mailDialog.preview.previousSentAt&&<p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">Ya se le envió un correo para esta cita el {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(mailDialog.preview.previousSentAt))}{mailDialog.preview.previousResponse==="confirmed"?" y confirmó":mailDialog.preview.previousResponse==="declined"?" y avisó que no asistirá":""}. Si lo envías de nuevo, el enlace anterior deja de valer.</p>}</div>}{mailDialog.sent&&<p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-900">✓ {mailDialog.sent}. Cuando confirme, la cita se marcará en verde.</p>}{mailDialog.error&&<p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-rose-900">{mailDialog.error}</p>}</div>}<DialogFooter><Button variant="outline" onClick={()=>setMailDialog(null)}>{mailDialog?.sent?"Cerrar":"Cancelar"}</Button>{mailDialog?.preview&&!mailDialog.sent&&<Button className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={mailDialog.loading} onClick={()=>void sendMailDialog()}><Mail className="mr-2 size-4"/>{mailDialog.loading?"Enviando…":`Enviar a ${mailDialog.preview.patientName.split(" ")[0]}`}</Button>}</DialogFooter></DialogContent></Dialog>
      <Dialog open={!!newAppt} onOpenChange={open=>{if(!open)setNewAppt(null)}}><DialogContent><DialogHeader><DialogTitle>Agendar paciente nuevo</DialogTitle><DialogDescription>Sin ficha todavía: se crea la cita en tu Google Calendar. Si dejas el nombre en blanco queda como «Paciente nuevo». Con el celular, la cita se reconoce sola cuando después crees su ficha.</DialogDescription></DialogHeader>{newAppt&&<div className="space-y-3"><Field label="Nombre (opcional)"><Input value={newAppt.name} maxLength={120} placeholder="Paciente nuevo" onChange={e=>setNewAppt({...newAppt,name:e.target.value})}/></Field><Field label="Celular (opcional)"><Input type="tel" inputMode="tel" value={newAppt.phone} maxLength={20} placeholder="9 1234 5678" onChange={e=>setNewAppt({...newAppt,phone:e.target.value})}/></Field><Field label="Motivo (opcional)"><Input value={newAppt.reason} maxLength={150} placeholder="Evaluación" onChange={e=>setNewAppt({...newAppt,reason:e.target.value})}/></Field><div className="grid grid-cols-3 gap-3"><Field label="Fecha"><Input type="date" value={newAppt.day} onChange={e=>setNewAppt({...newAppt,day:e.target.value})}/></Field><Field label="Hora"><Input type="time" value={newAppt.time} onChange={e=>setNewAppt({...newAppt,time:e.target.value})}/></Field><Field label="Duración"><select className="h-10 w-full rounded-md border px-2" value={newAppt.minutes} onChange={e=>setNewAppt({...newAppt,minutes:Number(e.target.value)})}>{[15,30,45,60,90,120].map(m=><option key={m} value={m}>{m} min</option>)}</select></Field></div>{agendaError&&<p role="alert" className="text-sm font-medium text-[#a43542]">{agendaError}</p>}</div>}<DialogFooter><Button variant="outline" onClick={()=>setNewAppt(null)}>Cancelar</Button><Button className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={agendaBusy||!newAppt?.day||!newAppt?.time} onClick={()=>void saveNewAppt()}>{agendaBusy?"Guardando…":"Agendar"}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={!!agendaEdit} onOpenChange={open=>{if(!open)setAgendaEdit(null)}}><DialogContent><DialogHeader><DialogTitle>Editar cita</DialogTitle><DialogDescription>Los cambios también se hacen en tu Google Calendar.</DialogDescription></DialogHeader>{agendaEdit&&<div className="space-y-3"><Field label="Título"><Input value={agendaEdit.title} maxLength={300} onChange={e=>setAgendaEdit({...agendaEdit,title:e.target.value})}/></Field><div className="grid grid-cols-2 gap-3"><Field label="Fecha"><Input type="date" value={agendaEdit.day} onChange={e=>setAgendaEdit({...agendaEdit,day:e.target.value})}/></Field><Field label="Hora"><Input type="time" value={agendaEdit.time} onChange={e=>setAgendaEdit({...agendaEdit,time:e.target.value})}/></Field></div>{agendaError&&<p role="alert" className="text-sm font-medium text-[#a43542]">{agendaError}</p>}</div>}<DialogFooter><Button variant="outline" onClick={()=>setAgendaEdit(null)}>Cancelar</Button><Button className="bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={agendaBusy||!agendaEdit?.title.trim()||!agendaEdit?.day||!agendaEdit?.time} onClick={()=>void saveAgendaEdit()}>{agendaBusy?"Guardando…":"Guardar"}</Button></DialogFooter></DialogContent></Dialog>
      <main className="mx-auto max-w-[1480px] px-5 pb-16 pt-8 md:px-9"><GoogleDriveBackup/>{loading&&<p role="status" className="mb-4">Cargando fichas…</p>}{loadError&&<p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{loadError} <button type="button" className="underline" onClick={()=>location.reload()}>Reintentar</button></p>}{exportError&&<p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{exportError}</p>}<div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight md:text-[2.1rem]">{section}</h1><p className="mt-1 text-sm text-[#6b6a7c]">{section==="Ficha clínica"?"Historia y planificación del paciente":section==="Inicio"?"Tu día de un vistazo":section==="Resumen"?"Vista general de la consulta":section==="Pacientes"?"Busca y abre una ficha":section==="Agenda"?"Próximas atenciones":section==="Presupuestos"?"Elige un paciente para consultar sus planes individualmente":"Planes de tratamiento y valores"}</p></div><div className="flex flex-wrap items-center gap-2">{section!=="Inicio"&&section!=="Presupuestos"&&<Button className="fx-shine fx-shine-hover bg-gradient-to-br from-[#ef895f] to-[#c95f35] shadow-[0_6px_16px_-6px_rgba(201,95,53,.6)] hover:from-[#e07a50] hover:to-[#b2522c]" onClick={()=>setModal(section==="Agenda"&&patient?"appointment":section==="Presupuestos"&&patient?"budget":section==="Pacientes"||!patient?"patient":"note")}><Plus className="mr-2 size-4"/>{section==="Agenda"?"Nueva cita":section==="Presupuestos"?"Nuevo presupuesto":section==="Pacientes"?"Nuevo paciente":"Nueva evolución"}</Button>}{section==="Pacientes"&&<><Button type="button" variant="outline" onClick={()=>void downloadClinicalRecords("json")} disabled={exporting}><Download className="mr-2 size-4"/>{exporting?"Preparando…":"Descargar fichas (JSON)"}</Button><Button type="button" variant="outline" onClick={()=>void downloadClinicalRecords("md")} disabled={exporting} data-testid="download-md"><Download className="mr-2 size-4"/>Descargar en Markdown</Button><a href="/importar" className="px-1 text-sm font-medium text-[#473a6d] underline">Importar fichas desde Drive</a></>}</div></div>
        {section==="Inicio"&&<div className="space-y-8">
          <GlobalDictation patients={patients} notes={liveNotes} onUsePatient={openDictatedPatient} onCreatePatient={createDictatedPatient} onAnnul={annulEvolution} onOpenNewPatientForm={openNewPatientForm}/>
          <TodayPanel patients={patients} events={agendaEvents} budgets={budgets.map(b=>({id:b.id,patientId:b.patientId,total:budgetTotals(b.items).total,isAlternative:b.isAlternative}))} payments={payments} clinicName={clinicName} notes={notes} plans={budgets} onOpenPatient={id=>openPatient(id)} onOpenAgenda={()=>openSection("Agenda")}/>
          {pendingAcrossPatients.length>0&&<section aria-label="Tratamientos a medias" className="rounded-xl border border-amber-200 bg-amber-50 p-5" data-testid="pending-treatments"><h2 className="text-lg font-semibold text-amber-950">Tratamientos a medias ({pendingAcrossPatients.length})</h2><p className="mt-1 text-xs text-amber-900">Según las evoluciones: sin avance hace más tiempo del habitual.</p><ul className="mt-3 space-y-2 text-sm">{pendingAcrossPatients.slice(0,8).map(alert=><li key={`${alert.patientId}:${alert.key}`}><button type="button" className="font-semibold text-[#473a6d] underline" onClick={()=>openPatient(alert.patientId,"odontograma")}>{alert.patientName}</button> · FDI {formatFdi(alert.tooth)}: {alert.message}</li>)}</ul>{pendingAcrossPatients.length>8&&<p className="mt-2 text-xs text-amber-900">y {pendingAcrossPatients.length-8} más.</p>}</section>}
          <section className="surface" aria-label="Agenda de la semana"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Esta semana</h2><div className="flex flex-wrap items-center gap-3"><AgendaWeekControls weekStart={weekStart} onPrevious={()=>setWeekStart(current=>shiftAgendaWeek(current,-1))} onNext={()=>setWeekStart(current=>shiftAgendaWeek(current,1))} onCurrent={showCurrentAgendaWeek}/><button type="button" onClick={openNewAppt} className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#473a6d] px-3 text-sm font-semibold text-white hover:bg-[#3a2f5a]" data-testid="agenda-nuevo-paciente"><Plus className="size-4"/>Agendar paciente nuevo</button><button type="button" onClick={()=>openSection("Agenda")} className="text-sm font-medium text-[#473a6d] hover:underline">Ver agenda completa</button></div></div><WeeklyAgendaMosaic days={weekDays} events={weekCalendarEvents} onEdit={startEditAgendaEvent} onDelete={deleteAgendaEvent} marks={agendaMarks} onMail={mailAgendaEvent}/><CalendarFreshness syncedAt={calendarSyncedAt}/><details className="mt-4 rounded-xl border border-[#e6e4ee] p-3" data-testid="agenda-ajustes"><summary className="cursor-pointer text-sm font-semibold text-[#473a6d]">Calendarios, correos y envío de la agenda</summary><div className="mt-3 space-y-4"><CalendarSources onChanged={()=>{void fetch("/api/clinical",{cache:"no-store"}).then(async response=>{if(response.ok)applyClinicalLoad(await response.json() as ClinicalLoadResponse)})}}/><AppointmentMailSettings/><AgendaDigestSettings/></div></details>{calendarSnapshotAt&&<p className="mt-2 text-xs text-[#6b6a7c]">Última consulta del calendario: {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(calendarSnapshotAt))}.</p>}</section>
        </div>}
        {section==="Ficha clínica"&&patient&&<div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_310px]"><div className="min-w-0 space-y-6"><div className="sticky z-10 -mx-5 flex items-center justify-between gap-3 border-b border-[#dddbe6] bg-white/95 px-5 py-2 shadow-sm backdrop-blur md:mx-0 md:rounded-xl md:border" style={{top:headerHeight}} data-testid="ficha-dictar-bar"><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-[#6b6a7c]">Ficha abierta · {PATIENT_TABS.find(tab=>tab.value===activeTab)?.label??""}</p><p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5"><span className="truncate text-base font-semibold text-[#173f43] md:text-lg" data-testid="sticky-patient-name">{patient.name}</span>{(ageFromBirthDate(patient.birthDate)!==null||patient.rut)&&<span className="hidden text-xs text-[#6b6a7c] sm:inline">{[ageFromBirthDate(patient.birthDate)!==null?`${ageFromBirthDate(patient.birthDate)} años`:"",patient.rut?(validRut(patient.rut)?formatRut(patient.rut):patient.rut):""].filter(Boolean).join(" · ")}</span>}{patient.allergies?.trim()&&!/^(sin registrar|sin alergias|ninguna|no|no refiere|—|-)\.?$/i.test(patient.allergies.trim())&&<span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800" data-testid="sticky-allergies">⚠ Alergia: {patient.allergies.trim().slice(0,60)}</span>}</p></div><ClinicalDictation prominent patientId={patient.id} patientName={patient.name} odontogram={toothStatuses[selectedId]??emptyOdontogram()} latestNote={patientNotes[0]??null} patient={patient} request={dictationRequest?.patientId===patient.id?dictationRequest:null} persist={persist} onApplied={applyClinicalLoad} budgetOptions={patientBudgets.filter(b=>!b.isAlternative).map(b=>({id:b.id,title:b.title}))} notes={patientNotes} plannedItems={Object.entries(plannedTeeth).flatMap(([tooth,items])=>items.map(item=>({...item,tooth:Number(tooth)})))} onAnnul={(evolutionId,mode,reason,replacement)=>annulEvolution(patient.id,evolutionId,mode,reason,replacement)}/></div><div className="surface"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-4"><span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-[#e7e4ed] text-lg font-semibold text-[#473a6d]">{initials(patient.name)}</span><div><h2 className="text-2xl font-semibold">{patient.name}</h2><p className="text-sm text-[#6b6a7c]">{ageFromBirthDate(patient.birthDate)!==null?`${ageFromBirthDate(patient.birthDate)} años · `:""}{patient.reason}</p></div></div><span className="rounded-full bg-[#efeef4] px-3 py-1 text-xs font-semibold text-[#3a2f5a]">{patient.status}</span></div><div className="mt-7 grid gap-4 border-t border-[#ebeaf1] pt-5 sm:grid-cols-3"><Info label="Antecedentes" value={patient.history}/><Info label="Alergias" value={patient.allergies}/><Info label="Presupuestos" value={`${patientBudgets.length} registrados`}/></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#ebeaf1] pt-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-3 [&>*]:min-w-0"><Info label="RUT" value={patient.rut?(validRut(patient.rut)?formatRut(patient.rut):patient.rut):"Sin registrar"}/><Info label="Teléfono" value={patient.phone?displayPhone(patient.phone):"Sin registrar"}/><Info label="Correo electrónico" value={patient.email?patient.email.trim().toLowerCase():"Sin registrar"}/><div className="sm:col-span-3"><Info label="Dirección" value={formatAddress(patient.address)||"Sin registrar"}/></div></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={editPatient}>Editar datos</Button></div></div>{selectedPerio.attention>0&&<button type="button" onClick={()=>setActiveTab("periodontograma")} className="mt-4 w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-950"><strong>Revisar periodontograma</strong><span className="mt-1 block">{selectedPerio.attention} {selectedPerio.attention===1?"sitio":"sitios"} con atención en el último examen · piezas FDI {selectedPerio.affected.map(formatFdi).join(", ")}.</span></button>}</div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4"><div className="flex justify-end"><AnamnesisButton patientId={patient.id} patientName={patient.name}/></div><TabsList variant="line" className="h-auto! w-full flex-wrap justify-start gap-2 border-b border-[#dddbe6] pb-3 sm:flex-nowrap sm:overflow-x-auto" data-testid="patient-tabs">{PATIENT_TABS.map(tab=><TabsTrigger key={tab.value} value={tab.value} className={`h-10 flex-none rounded-lg border px-4 text-[15px] font-bold shadow-none after:hidden group-data-[variant=line]/tabs-list:data-[state=active]:shadow-md ${tab.style}`}>{tab.label}</TabsTrigger>)}</TabsList>
            <TabsContent value="evoluciones"><div className="surface"><div className="flex items-center justify-between"><h3 className="font-semibold">Historia clínica</h3><div className="flex flex-wrap justify-end gap-2">{annulledCount>0&&<Button variant="ghost" size="sm" aria-pressed={showAnnulled} onClick={()=>setShowAnnulled(v=>!v)} data-testid="toggle-annulled">{showAnnulled?"Ocultar anuladas":`Ver anuladas (${annulledCount})`}</Button>}<Button variant="outline" size="sm" onClick={()=>setModal("note")}><FilePlus2 className="mr-2 size-4"/>Añadir registro</Button></div></div>{chartMessage&&<p role="status" className="mt-3 text-sm text-[#3b3355]">{chartMessage}</p>}<EvolutionHistory
  notes={showAnnulled ? patientNotesAll : patientNotes}
  allNotes={patientNotesAll}
  odontogram={toothStatuses[selectedId] ?? emptyOdontogram()}
  onSyncOdontogram={async note => {
    try {
      const result = await persist({ action: "syncEvolutionOdontogram", patientId: selectedId, evolutionId: note.id });
      const chart = result.chart;
      if (chart?.odontogram) setToothStatuses(previous => ({ ...previous, [selectedId]: chart.odontogram! }));
      setChartMessage(chart?.updatedTeeth?.length ? "Odontograma actualizado: FDI " + chart.updatedTeeth.map(formatFdi).join(", ") + "." : "No hubo cambios; revisa el odontograma.");
    } catch (error) {
      setChartMessage(error instanceof Error ? error.message : "No se pudo actualizar el odontograma.");
    }
  }}
  onAnnul={note => setAnnulTarget(note)}
/></div></TabsContent>
            <TabsContent value="odontograma"><OdontogramDateBar dates={chartDates(toothStatuses[selectedId]??emptyOdontogram())} value={chartDate} onChange={setChartDate}/><Suspense fallback={<div className="min-h-[320px] rounded-xl bg-white p-5 text-sm text-[#6b6a7c]" role="status">Cargando odontograma…</div>}><Odontogram key={`${selectedId}-${chartDate??"hoy"}`} endo={endoMarks} onOpenEndo={tooth=>{setEndoFocus(tooth);setActiveTab("endodoncia")}} onSetPriorEndo={endoData?setPriorEndo:undefined} priorEndo={Object.fromEntries((endoData?.cases??[]).filter(c=>c.prior).map(c=>[c.tooth,c.priorYear??""]))} treatments={toothTreatmentMap} planned={plannedTeeth} onSetPlannedDone={setBudgetItemDone} onOpenPlan={()=>setActiveTab("presupuestos")} onDeleteEvent={deleteToothEvent} onEditEvent={editToothEvent} data={chartDate?chartAt(toothStatuses[selectedId]??emptyOdontogram(),chartDate):toothStatuses[selectedId]??emptyOdontogram()} evolutionEvents={toothEvolutionHistory} onSetStatus={chartDate?readOnlyChart:updateTooth} onRemoveLesion={chartDate?readOnlyChart:removeToothLesion} onSetMissingReason={chartDate?readOnlyChart:updateMissingReason} onSetSurface={chartDate?readOnlyChart:updateSurface} onSetCrownDetails={chartDate?readOnlyChart:updateCrownDetails}/></Suspense></TabsContent>
            <TabsContent value="presupuestos"><div className="surface"><div className="flex justify-between gap-3"><div><h3 className="font-semibold">Planes de tratamiento y presupuestos</h3><p className="mt-1 text-sm text-[#615f73]">Organiza prestaciones por fases y revisa total, abonos y saldo en cada plan.</p></div><Button variant="outline" size="sm" onClick={startNewBudget}>Añadir plan</Button></div><div className="mt-5 space-y-4">{patientBudgets.length?<>
              {patientBudgets.filter(b=>!b.isAlternative).map(primary=>{
                const paid=patientPayments.filter(payment=>payment.budgetId===primary.id).reduce((sum,payment)=>sum+payment.amount,0);
                const alternatives=patientBudgets.filter(budget=>budget.isAlternative&&budget.parentBudgetId===primary.id);
                return <section key={primary.id} className="space-y-3">
                  <BudgetCard budget={primary} paid={paid} payments={patientPayments.filter(payment=>payment.budgetId===primary.id)} onRegisterPayment={()=>openManualPayment(primary)} onSetItemDone={(index,doneOn)=>setBudgetItemDone(primary.id,index,doneOn)} onEdit={()=>editBudget(primary)} onPrint={()=>setPrintingBudgetId(primary.id)} onCreateAlternative={paid===0&&alternatives.length<12?()=>startBudgetAlternative(primary):undefined}/>
                  {paid>0&&alternatives.length>0&&<p className="ml-4 text-xs text-[#8a5b1c]">Este plan tiene abonos; no se puede cambiar la alternativa principal para conservar el historial financiero.</p>}
                  {alternatives.length>0&&<div className="ml-4 space-y-3 border-l-2 border-amber-200 pl-4">
                    <h4 className="text-sm font-semibold text-[#4f4e62]">Opciones alternativas</h4>
                    {alternatives.map(alternative=><BudgetCard key={alternative.id} budget={alternative} parentTitle={primary.title} onEdit={()=>editBudget(alternative)} onPrint={()=>setPrintingBudgetId(alternative.id)} onSelectPrimary={paid===0?()=>selectBudgetAlternative(alternative):undefined}/>)}
                  </div>}
                </section>;
              })}
              {patientBudgets.filter(budget=>budget.isAlternative&&!patientBudgets.some(primary=>primary.id===budget.parentBudgetId&&!primary.isAlternative)).map(alternative=><BudgetCard key={alternative.id} budget={alternative} onEdit={()=>editBudget(alternative)} onPrint={()=>setPrintingBudgetId(alternative.id)}/>)}
            </>:<Empty text="Aún no hay planes de tratamiento para este paciente."/>}</div><PatientPaymentSummary payments={patientPayments}/></div></TabsContent>
            <TabsContent value="aranceles"><Suspense fallback={<div className="min-h-[220px] rounded-xl bg-white p-5 text-sm text-[#6b6a7c]" role="status">Cargando aranceles…</div>}>{activeTab==="aranceles"&&patient&&<ArancelesPanel patient={{name:patient.name,budgets:patientBudgets.map(budget=>({id:budget.id,title:budget.title})),cart:arancelCart.patientId===selectedId?arancelCart.items:[],onCartChange:items=>setArancelCart({patientId:selectedId,items}),onSend:sendArancelToBudget}}/>}</Suspense></TabsContent>
            <TabsContent value="periodontograma"><Suspense fallback={<div className="min-h-[320px] rounded-xl bg-white p-5 text-sm text-[#6b6a7c]" role="status">Cargando periodontograma…</div>}><OdontogramDateBar what="Periodontograma" dates={[...new Set((periodontalExams[selectedId]??[]).map(perioDay))].sort().reverse()} value={perioDate} onChange={setPerioDate}/><Periodontogram key={`${selectedId}-${perioDate??"hoy"}`} onDeleteReading={perioDate?readOnlyChart:deletePerioReading} onEditReading={perioDate?readOnlyChart:editPerioReading} exams={(periodontalExams[selectedId]??[]).filter(exam=>!perioDate||perioDay(exam)<=perioDate)} toothStatuses={toothStatuses[selectedId]?.teeth??{}} toothHistory={[...(toothStatuses[selectedId]?.history??[]),...toothEvolutionHistory]} onSave={perioDate?readOnlyChart:savePerio}/></Suspense></TabsContent>
            <TabsContent value="endodoncia"><Suspense fallback={<div className="min-h-[220px] rounded-xl bg-white p-5 text-sm text-[#6b6a7c]" role="status">Cargando endograma…</div>}>{activeTab==="endodoncia"&&<OdontogramDateBar what="Endograma" dates={endoDays} value={endoDate} onChange={setEndoDate}/>}{activeTab==="endodoncia"&&(endoData&&(!endoDate||endoPast)?<EndodonticsPanel key={`${selectedId}-${endoDate??"hoy"}`} data={endoDate&&endoPast?endoPast:endoData} onSave={endoDate?readOnlyChart:saveEndo} focusTooth={endoFocus} patientName={patient?.name||""} images={endoImages} onUploadImage={uploadOrthoImage} onRemoveImage={removeImage} onAddNote={addOrthoNote}/>:<div className="surface" role="status">{endoError?<p role="alert" className="text-[#a43542]">{endoError}</p>:"Cargando endograma…"}</div>)}</Suspense></TabsContent>
            <TabsContent value="ortodoncia"><Suspense fallback={<div className="min-h-[220px] rounded-xl bg-white p-5 text-sm text-[#6b6a7c]" role="status">Cargando ortodoncia…</div>}>{activeTab==="ortodoncia"&&<OrthodonticsPanel key={selectedId} patientId={selectedId} patientName={patient?.name||""} images={orthoImages} onUploadImage={uploadOrthoImage} onRemoveImage={removeImage} onAddNote={addOrthoNote}/>}</Suspense></TabsContent>
            <TabsContent value="imagenes"><Suspense fallback={<div className="min-h-[220px] rounded-xl bg-white p-5 text-sm text-[#6b6a7c]" role="status">Cargando imágenes…</div>}><PatientImages key={selectedId} images={patientImages} onAdd={addImages} onRemove={removeImage}/></Suspense></TabsContent>
          </Tabs></div><aside className="space-y-5">{selectedId>0&&<AuditNotice patientId={selectedId}/>}<div className="surface"><h3 className="font-semibold">Próximas citas</h3><div className="mt-5 space-y-4">{calendarUpcomingFor(selectedId).map(e=><div key={`cal-${e.id}`} className="rounded-xl bg-[#efeef4] p-4" data-testid="ficha-cita-calendar"><p className="font-semibold text-[#473a6d]">{new Intl.DateTimeFormat("es-CL",{weekday:"long",day:"2-digit",month:"2-digit",year:"numeric",timeZone:"America/Santiago"}).format(new Date(e.startAt))} · {new Intl.DateTimeFormat("es-CL",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"America/Santiago"}).format(new Date(e.startAt))}</p><p className="mt-1 text-sm">{e.title}</p><p className="mt-2 text-xs text-[#6b6a7c]">Desde Google Calendar</p></div>)}{(appointments.filter(a=>a.patientId===selectedId).length||calendarUpcomingFor(selectedId).length)?appointments.filter(a=>a.patientId===selectedId).map(a=><div key={a.id} className="rounded-xl bg-[#efeef4] p-4"><p className="font-semibold text-[#473a6d]">{a.day} · {a.time}</p><p className="mt-1 text-sm">{a.reason}</p>{(()=>{const ev=agendaEventFor(a);if(!ev||ev.id<0)return null;const sent=agendaMarks.sent[ev.id],ok=agendaMarks.confirmed[ev.id],no=agendaMarks.declined.includes(ev.id);return <div className="mt-2 space-y-1 text-xs" data-testid="ficha-cita-correo">{no?<p className="font-semibold text-[#a43542]">✗ Avisó que no asistirá</p>:ok?<p className="font-semibold text-emerald-800">✓ Confirmada</p>:sent?<p className="font-medium text-[#473a6d]">✉ Correo de confirmación enviado {sentLabel(sent)} · sin respuesta aún</p>:<p className="text-[#6b6a7c]">Correo de confirmación: no enviado</p>}{new Date(ev.endAt).getTime()>Date.now()&&<button type="button" onClick={()=>void mailAgendaEvent(ev)} className="inline-flex items-center gap-1 rounded border border-[#d9d5e4] bg-white px-1.5 py-0.5 text-[11px] font-medium hover:bg-[#f6f5f9]"><Mail className="size-3"/>{sent?"Reenviar correo":"Enviar confirmación"}</button>}</div>})()}<div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={()=>editAppointment(a)}><Pencil className="mr-1 size-3.5"/>Editar cita</Button><Button size="sm" variant="outline" className="text-[#a43542]" onClick={()=>void deleteFichaAppointment(a)} aria-label={`Borrar la cita del ${a.day} ${a.time}`}><Trash2 className="mr-1 size-3.5"/>Borrar</Button></div></div>):<Empty text="Sin citas agendadas."/>}</div><Button variant="outline" className="mt-5 w-full" onClick={()=>setModal("appointment")}>Agendar control</Button>{apptNote&&(()=>{let note:{iso:string;text:string};try{note=JSON.parse(apptNote)}catch{note={iso:"",text:apptNote}}return <div role="status" className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="appointment-saved"><p>{note.text}</p>{note.iso&&<button type="button" className="mt-2 font-semibold underline" onClick={()=>{setWeekStart(mondayOfAgendaWeek(note.iso));setApptNote("");openSection("Agenda")}}>Ver en la agenda</button>}</div>})()}</div><div className="rounded-xl bg-[#473a6d] p-6 text-white"><Activity className="mb-4 size-6 text-[#ef895f]"/><h3 className="font-semibold">Secuencia clínica</h3><p className="mt-2 text-sm leading-6 text-[#dfdbe8]">Documenta evaluación, cirugía, componentes, rehabilitación y controles en orden cronológico.</p></div></aside></div>}
        {section==="Pacientes"&&<div className="surface">{linkNotice&&<p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="link-notice">{linkNotice}</p>}<div className="relative mb-5 max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8b8ca3]"/><Input aria-label="Buscar paciente por nombre o RUT" placeholder="Buscar por nombre o RUT" value={search} onChange={e=>setSearch(e.target.value)} className="pl-10"/></div><div className="space-y-2">{filteredPatients.map(p=><button key={p.id} onClick={()=>openPatient(p.id)} className="flex w-full items-center gap-4 rounded-xl border border-[#ebeaf1] p-4 text-left transition hover:border-[#b8b1d6] hover:bg-[#f7f6fa]"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#e6e4ee] text-sm font-bold text-[#3a2f5a]">{initials(p.name)}</span><span className="min-w-0 flex-1"><strong className="block truncate">{p.name}</strong><small className="text-sm text-[#6b6a7c]">{p.reason}{p.birthDate?` · Nacimiento: ${p.birthDate}`:" · Nacimiento sin registrar"}{p.rut?` · RUT: ${p.rut}`:""}</small></span><ChevronRight className="size-5 text-[#8b8ca3]"/></button>)}{!filteredPatients.length&&<Empty text="No se encontraron pacientes."/>}</div></div>}
        {section==="Aranceles"&&<Suspense fallback={<div className="min-h-[220px] rounded-xl bg-white p-5 text-sm text-[#6b6a7c]" role="status">Cargando aranceles…</div>}><ArancelesPanel/></Suspense>}
        {section==="Resumen"&&<div className="grid grid-cols-1 gap-5 md:grid-cols-3 [&>*]:min-w-0">{[["Pacientes en esta sesión",patients.length,Users],["Citas programadas",appointments.length,CalendarDays],["Pacientes con presupuesto",new Set(budgets.map(b=>b.patientId)).size,ClipboardList]].map(([label,value,Icon])=><div key={String(label)} className="surface"><div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-[#e6e4ee] text-[#473a6d]">{typeof Icon!=="number"&&typeof Icon!=="string"&&<Icon className="size-5"/>}</div><p className="text-3xl font-semibold">{String(value)}</p><p className="mt-1 text-sm text-[#6b6a7c]">{String(label)}</p></div>)}<div className="surface md:col-span-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Agenda semanal</h3><button type="button" onClick={openNewAppt} className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#473a6d] px-3 text-sm font-semibold text-white hover:bg-[#3a2f5a]"><Plus className="size-4"/>Agendar paciente nuevo</button><AgendaWeekControls weekStart={weekStart} onPrevious={()=>setWeekStart(current=>shiftAgendaWeek(current,-1))} onNext={()=>setWeekStart(current=>shiftAgendaWeek(current,1))} onCurrent={showCurrentAgendaWeek}/></div><div className="mt-4"><WeeklyAgendaMosaic days={weekDays} events={weekCalendarEvents} onEdit={startEditAgendaEvent} onDelete={deleteAgendaEvent} marks={agendaMarks} onMail={mailAgendaEvent}/><CalendarFreshness syncedAt={calendarSyncedAt}/>{calendarSnapshotAt&&<p className="mt-2 text-xs text-[#6b6a7c]">Citas consultadas en Google Calendar el {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(calendarSnapshotAt))}.</p>}</div></div><div className={`surface md:col-span-3 ${perioAlerts.length?"border-amber-200 bg-amber-50":""}`}><h3 className="font-semibold">Atención periodontal</h3>{perioAlerts.length?<div className="mt-3 space-y-2">{perioAlerts.map(({patient:p,summary,date})=><button key={p.id} type="button" onClick={()=>openPatient(p.id,"periodontograma")} className="flex w-full flex-wrap justify-between gap-2 rounded-lg border border-amber-200 bg-white p-3 text-left text-sm hover:border-amber-400"><span><strong>{p.name}</strong><span className="ml-2 text-[#714e13]">{summary.attention} {summary.attention===1?"sitio":"sitios"} · piezas FDI {summary.affected.map(formatFdi).join(", ")}</span></span><span className="text-[#615f73]">{date} · Ver examen</span></button>)}</div>:<p className="mt-2 text-sm text-[#615f73]">No hay sitios destacados en los periodontogramas registrados en esta sesión.</p>}<p className="mt-2 text-xs text-[#615f73]">Alertas de revisión clínica; no equivalen a un diagnóstico.</p></div><AuditPanel onOpenPatient={(id)=>openPatient(id)}/><ImprovementPanel/><div className="surface md:col-span-3"><h3 className="font-semibold">Actividad reciente</h3><div className="mt-5 space-y-3">{liveNotes.slice(0,4).map(n=><button key={n.id} onClick={()=>openPatient(n.patientId)} className="flex w-full justify-between gap-4 rounded-lg border-b border-[#ebeaf1] py-3 text-left hover:text-[#473a6d]"><span><strong className="block font-medium">{n.title}</strong><span className="text-sm text-[#6b6a7c]">{patients.find(p=>p.id===n.patientId)?.name}</span></span><span className="text-sm text-[#6b6a7c]">{n.date}</span></button>)}</div></div></div>}
        {section==="Agenda"&&<div className="surface"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Agenda semanal</h3><AgendaWeekControls weekStart={weekStart} onPrevious={()=>setWeekStart(current=>shiftAgendaWeek(current,-1))} onNext={()=>setWeekStart(current=>shiftAgendaWeek(current,1))} onCurrent={showCurrentAgendaWeek}/></div><div className="mt-4"><WeeklyAgendaMosaic days={weekDays} events={weekCalendarEvents} onEdit={startEditAgendaEvent} onDelete={deleteAgendaEvent} marks={agendaMarks} onMail={mailAgendaEvent}/><CalendarFreshness syncedAt={calendarSyncedAt}/><CalendarSources onChanged={()=>{void fetch("/api/clinical",{cache:"no-store"}).then(async response=>{if(response.ok)applyClinicalLoad(await response.json() as ClinicalLoadResponse)})}}/>{calendarSnapshotAt&&<p className="mt-2 text-xs text-[#6b6a7c]">Citas consultadas en Google Calendar el {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(calendarSnapshotAt))}.</p>}</div></div>}{section==="Presupuestos"&&<section className="surface" aria-label="Presupuestos por paciente"><div className="mb-4"><h2 className="font-semibold">Elige un paciente</h2><p className="mt-1 text-sm text-[#615f73]">Cada ficha tiene sus propios presupuestos, pagos y opciones para añadir o editar planes.</p></div><div className="space-y-2">{patients.length?patients.map(p=>{const count=budgets.filter(b=>b.patientId===p.id).length;return <button key={p.id} type="button" onClick={()=>openPatient(p.id,"presupuestos")} className="flex w-full items-center justify-between gap-4 rounded-xl border border-[#dddbe6] bg-white p-4 text-left transition hover:border-[#9d93c4] hover:bg-[#f7f6fa] focus-visible:outline-2 focus-visible:outline-[#473a6d]"><span className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#e6e4ee] text-sm font-semibold text-[#473a6d]">{initials(p.name)}</span><span className="min-w-0"><span className="block truncate font-medium text-[#35343f]">{p.name}</span><span className="mt-0.5 block text-sm text-[#615f73]">{count===1?"1 presupuesto":`${count} presupuestos`}</span></span></span><span className="shrink-0 text-sm font-medium text-[#473a6d]">Abrir ficha <ChevronRight className="ml-1 inline size-4"/></span></button>}):<Empty text="No hay pacientes registrados."/>}</div></section>}
        <p className="mt-10 text-center text-xs text-[#86829f]">La ficha se guarda en Gestión Dental. Si autorizas tu Google Drive, la aplicación sincroniza automáticamente el respaldo; las imágenes clínicas siguen almacenadas en la aplicación.</p>
      </main></div>
    <AnnulEvolutionDialog note={annulTarget} onClose={()=>setAnnulTarget(null)} onConfirm={(evolutionId,mode,reason,replacement)=>annulEvolution(annulTarget?.patientId??selectedId,evolutionId,mode,reason,replacement)}/>
    <Dialog open={clinicalReview!==null} onOpenChange={open=>{if(!open)finishReview(false)}}><DialogContent className="max-h-[90vh] supports-[height:1dvh]:max-h-[90dvh] overflow-y-auto bg-white sm:max-w-xl"><DialogHeader><DialogTitle>Revisar antes de guardar</DialogTitle><DialogDescription>Confirma el paciente y los datos clínicos. Puedes volver a corregirlos sin guardar.</DialogDescription></DialogHeader><div className="space-y-3 text-sm"><p>Paciente: <strong>{patients.find(item=>item.id===clinicalReview?.patientId)?.name||"Paciente no identificado"}</strong></p><p className="font-semibold">{clinicalReview?.heading}</p>{clinicalReview?.body&&<div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border p-3">{clinicalReview.body}</div>}{clinicalReview?.details.length?<ul className="list-inside list-disc space-y-1 rounded-lg bg-[#f7f6f9] p-3">{clinicalReview.details.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p className="rounded-lg bg-amber-50 p-3 text-amber-950">No se detectaron cambios automáticos en los diagramas. Comprueba si corresponde registrarlos manualmente.</p>}</div><DialogFooter><Button variant="outline" onClick={()=>finishReview(false)}>Volver y corregir</Button><Button className="bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={()=>finishReview(true)}>Confirmar y guardar</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={modal!==null} onOpenChange={v=>{if(!v)resetModal()}}><DialogContent className={`max-h-[90vh] supports-[height:1dvh]:max-h-[90dvh] overflow-y-auto border-[#dddbe6] bg-white ${modal === "budget" || modal === "editBudget" ? "sm:max-w-2xl" : modal === "patient" || modal === "editPatient" ? "sm:max-w-3xl" : "sm:max-w-md"}`}><DialogHeader><DialogTitle>{modal==="patient"?"Nuevo paciente":modal==="editPatient"?"Editar datos del paciente":modal==="note"?"Nueva evolución":modal==="budget"?(alternativeParentBudgetId?"Nueva alternativa de tratamiento":"Nuevo plan de tratamiento"):modal==="editBudget"?"Editar plan de tratamiento":modal==="editAppointment"?"Editar cita":"Nueva cita"}</DialogTitle><DialogDescription>{modal === "budget" || modal === "editBudget" ? (alternativeParentBudgetId ? "Esta cotización no recibe pagos hasta establecerla como plan principal." : "Agrupa las prestaciones por fases y revisa los valores antes de guardar.") : "Los cambios se guardan en la ficha clínica. La fecha de cada evolución se asigna automáticamente."}</DialogDescription></DialogHeader><div className={`space-y-4 py-2 ${modal==="patient"||modal==="editPatient"?"[&_input]:h-12 [&_input]:text-base [&_label]:text-base":""}`}>
        
        {modal==="patient"&&<><Field label="Nombre y dos apellidos *"><Input ref={nameRef} value={name} onChange={e=>{const value=e.target.value;setName(value);patientDraftRef.current={...patientDraftRef.current,name:value};setPatientError("")}} placeholder="Ej. Ana Pérez Rojas" maxLength={180} aria-invalid={patientAttemptedSave&&!hasFourNameParts(name)} aria-describedby={patientAttemptedSave&&!hasFourNameParts(name)?"name-missing":undefined}/>{patientAttemptedSave&&!hasFourNameParts(name)&&<span id="name-missing" className="block text-xs font-medium text-[#a43542]">Registra al menos un nombre y los dos apellidos (el segundo nombre es opcional).</span>}</Field><Field label="Fecha de nacimiento *"><Input ref={birthDateRef} type="date" value={birthDate} max={`${chileToday().year}-${String(chileToday().month).padStart(2,"0")}-${String(chileToday().day).padStart(2,"0")}`} onChange={e=>{const value=e.target.value;setBirthDate(value);patientDraftRef.current={...patientDraftRef.current,birthDate:value};setPatientError("")}} aria-invalid={patientAttemptedSave&&(!birthDate||ageFromBirthDate(birthDate)===null)} aria-describedby={patientAttemptedSave&&(!birthDate||ageFromBirthDate(birthDate)===null)?"birthdate-missing":undefined}/>{patientAttemptedSave&&(!birthDate||ageFromBirthDate(birthDate)===null)&&<span id="birthdate-missing" className="block text-xs font-medium text-[#a43542]">{birthDate?"Revisa la fecha de nacimiento.":"Falta la fecha de nacimiento."}</span>}</Field>{birthDate&&<p className="text-sm text-[#615f73]">{ageFromBirthDate(birthDate)===null?"Fecha no válida":`Edad calculada: ${ageFromBirthDate(birthDate)} años`}</p>}<Field label="RUN / RUT chileno"><Input ref={rutRef} inputMode="text" autoCapitalize="characters" value={rut} maxLength={14} onChange={e=>{const value=e.target.value;setRut(value);patientDraftRef.current={...patientDraftRef.current,rut:value};setPatientError("")}} onBlur={()=>{if(validRut(rut)){const value=formatRut(rut);setRut(value);patientDraftRef.current={...patientDraftRef.current,rut:value}}}} placeholder="12.345.678-5" aria-invalid={Boolean(rut)&&!validRut(rut)}/></Field>{rut&&!validRut(rut)&&<p className="text-sm text-[#a43542]">RUT o dígito verificador no válido.</p>}<Field label="Teléfono"><Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e=>{setPhone(e.target.value);patientDraftRef.current={...patientDraftRef.current,phone:e.target.value}}} placeholder="+56 9 6696 3089" aria-invalid={Boolean(phone)&&!validPhone(phone)}/></Field><Field label="Correo electrónico"><Input type="email" inputMode="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);patientDraftRef.current={...patientDraftRef.current,email:e.target.value}}} placeholder="paciente@ejemplo.cl" aria-invalid={Boolean(email)&&!validEmail(email)}/></Field><Field label="Calle y número"><Input value={address.street} onChange={e=>changeAddress({street:e.target.value})} placeholder="Av. Providencia 1234, depto. 56" maxLength={160} autoComplete="street-address" data-testid="patient-street"/></Field><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Comuna"><Input value={address.commune} onChange={e=>changeAddress({commune:e.target.value})} placeholder="Providencia" maxLength={80} data-testid="patient-commune"/></Field><Field label="País"><Input value={address.country} onChange={e=>changeAddress({country:e.target.value})} placeholder="Chile" maxLength={60} autoComplete="country-name" data-testid="patient-country"/></Field></div><Field label="Motivo de consulta"><Input value={reason} onChange={e=>{const value=e.target.value;setReason(value);patientDraftRef.current={...patientDraftRef.current,reason:value}}} placeholder="Evaluación implantológica"/></Field>{patientAttemptedSave&&!patientValidation.valid&&<div role="alert" className="rounded-lg border border-[#e4a0a7] bg-[#fff5f5] p-3 text-sm text-[#922f3a]"><p className="font-semibold">Revisa la ficha antes de guardar:</p><div className="mt-2 flex flex-wrap gap-2">{patientValidation.missingFields.map(field=><button type="button" key={field} className="rounded-full border border-[#d88d96] bg-white px-3 py-1.5 text-left font-semibold underline decoration-dotted underline-offset-2" onClick={()=>field.toLowerCase().includes("nombre")?nameRef.current?.focus():birthDateRef.current?.focus()}>Falta {field.toLowerCase()} · completar</button>)}{patientValidation.invalidFields.map(field=><button type="button" key={field} className="rounded-full border border-[#d88d96] bg-white px-3 py-1.5 text-left font-semibold underline decoration-dotted underline-offset-2" onClick={()=>field==="RUN / RUT"?rutRef.current?.focus():birthDateRef.current?.focus()}>Revisar {field.toLowerCase()}</button>)}</div></div>}{patientError&&patientValidation.valid&&<p role="alert" className="text-sm font-medium text-[#a43542]">{patientError}</p>}</>}{modal==="editPatient"&&<><Field label="Nombre del paciente *"><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre y apellido" maxLength={180} aria-invalid={!validExistingPatientName(name,patient?.name||"")}/><span className="block text-xs text-[#6b6a7c]">En fichas existentes, conserva el nombre registrado o cámbialo con datos confirmados. Los cuatro componentes se solicitan al crear pacientes nuevos.</span></Field><Field label="RUN / RUT chileno"><Input inputMode="text" autoCapitalize="characters" value={rut} maxLength={14} onChange={e=>setRut(e.target.value)} onBlur={()=>{if(rut&&validRut(rut))setRut(formatRut(rut))}} placeholder="12.345.678-5" aria-invalid={Boolean(rut)&&!validRut(rut)}/></Field><Field label="Teléfono"><Input type="tel" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+56 9 6696 3089" aria-invalid={Boolean(phone)&&!validPhone(phone)}/></Field><Field label="Correo electrónico"><Input type="email" inputMode="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="paciente@ejemplo.cl" aria-invalid={Boolean(email)&&!validEmail(email)}/></Field><Field label="Calle y número"><Input value={address.street} onChange={e=>changeAddress({street:e.target.value})} placeholder="Av. Providencia 1234, depto. 56" maxLength={160} autoComplete="street-address" data-testid="patient-street"/></Field><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Comuna"><Input value={address.commune} onChange={e=>changeAddress({commune:e.target.value})} placeholder="Providencia" maxLength={80} data-testid="patient-commune"/></Field><Field label="País"><Input value={address.country} onChange={e=>changeAddress({country:e.target.value})} placeholder="Chile" maxLength={60} autoComplete="country-name" data-testid="patient-country"/></Field></div><Field label="Alergias"><Input value={allergies} onChange={e=>setAllergies(e.target.value)} placeholder="Sin registrar"/></Field><Field label="Antecedentes"><Textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Sin registrar" rows={3}/></Field></>}{modal==="note"&&<><p className="text-sm text-[#6b6a7c]">Paciente: <strong className="text-[#35343f]">{patient?.name}</strong></p><Field label="Título"><Input value={noteTitle} onChange={e=>setNoteTitle(e.target.value)} placeholder="Evolución clínica (opcional)"/></Field><div className="space-y-2"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Registro clínico</span><Button type="button" variant="outline" size="sm" onClick={()=>{if(!patient)return;const text=noteBody.trim();resetModal();setDictationRequest({nonce:Date.now(),text,patientId:patient.id})}} data-testid="note-dictate-ai"><Mic className="mr-2 size-4"/>{noteBody.trim()?"Corregir con IA":"Dictar con IA"}</Button></div><Textarea aria-label="Registro clínico" value={noteBody} onChange={e=>setNoteBody(e.target.value)} placeholder="Motivo, hallazgos, procedimiento, indicaciones..." rows={5} lang="es-CL" spellCheck/><p className="text-xs leading-5 text-[#615f73]">Si dictas con el micrófono del teclado, pulsa «Corregir con IA»: la IA corrige lo mal oído, arma la nota por secciones y deja la transcripción original aparte. Revisa nombres, piezas y dosis antes de guardar.</p></div></>}{(modal==="budget"||modal==="editBudget")&&<><p className="text-sm text-[#6b6a7c]">Paciente: <strong className="text-[#35343f]">{patient?.name}</strong></p>{alternativeParentBudgetId&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Esta opción se guarda como alternativa. No aceptará pagos hasta que la establezcas como plan principal.</p>}<Field label="Nombre del plan"><Input maxLength={180} value={budgetTitle} onChange={e=>setBudgetTitle(e.target.value)} placeholder="Plan de tratamiento"/></Field><BudgetItemsEditor items={budgetItems} onChange={setBudgetItems}/></>}{modal==="editAppointment"&&<><p className="text-sm text-[#6b6a7c]">Paciente: <strong className="text-[#35343f]">{patient?.name}</strong></p><div className="grid grid-cols-2 gap-3"><Field label="Fecha"><Input type="date" value={apptDate} onChange={e=>setApptDate(e.target.value)}/></Field><Field label="Hora"><Input type="time" value={apptTime} onChange={e=>setApptTime(e.target.value)}/></Field></div><p className="text-xs text-[#6b6a7c]">El cambio también se hace en tu Google Calendar.</p><Field label="Motivo"><Input value={apptReason} onChange={e=>setApptReason(e.target.value)} maxLength={500}/></Field></>}{modal==="appointment"&&<><p className="text-sm text-[#6b6a7c]">Paciente: <strong className="text-[#35343f]">{patient?.name}</strong></p><Field label="Fecha"><Input ref={apptDateRef} type="date" value={apptDate} onChange={e=>setApptDate(e.target.value)}/></Field><Field label="Hora"><Input ref={apptTimeRef} type="time" value={apptTime} onChange={e=>setApptTime(e.target.value)}/></Field><Field label="Motivo"><Input value={apptReason} onChange={e=>setApptReason(e.target.value)} placeholder="Control implantológico"/></Field></>}</div>{formError&&<p role="alert" className="px-1 text-sm font-medium text-[#a43542]">{formError}</p>}<DialogFooter><Button variant="outline" onClick={resetModal}>Cancelar</Button><Button className="bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={save} disabled={saving}>{saving?"Guardando…":"Guardar"}</Button></DialogFooter></DialogContent></Dialog>
    <BudgetPaymentDialog open={paymentBudgetId!==null} budget={paymentTargetBudget} paid={paymentTargetPaid} onOpenChange={open=>{if(!open)setPaymentBudgetId(null)}} onSave={saveManualPayment}/>
    <BudgetPrintDialog open={printingBudgetId!==null} onOpenChange={open=>{if(!open)setPrintingBudgetId(null)}} budget={printingBudget} patientName={patient?.name??""} professionalName={viewerName} clinicName={clinicName}/>
  </div>;
}
