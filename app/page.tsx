"use client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { viewerInitials } from "@/app/access-owners";
import { Activity, ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, ClipboardList, Download, Home as HomeIcon, FilePlus2, LayoutDashboard, LogOut, Menu, Mic, Plus, Search, Stethoscope, Trash2, Users, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ClinicalDictation } from "@/components/clinical-dictation";
import { AnnulEvolutionDialog, type AnnulReplacement, type RemovalMode } from "@/components/evolution-annul";
import { EvolutionHistory } from "@/components/evolution-history";
import { GlobalDictation, type NewPatientFields } from "@/components/global-dictation";
import { GoogleDriveBackup } from "@/components/google-drive-backup";
import { BudgetCard, BudgetItemsEditor, type BudgetPlan } from "@/components/budget-plan";
import { BudgetPaymentDialog, type ManualPaymentInput } from "@/components/budget-payment-dialog";
import { BudgetPrintDialog } from "@/components/budget-print-dialog";
import { PatientPaymentSummary } from "@/components/patient-payment-summary";
import { budgetTotals, normalizeBudgetItems } from "@/lib/budget-plans";
import { buildAppUrl, parseAppUrl, resolveAppUrl, type ParsedAppUrl } from "@/lib/app-url";
const Periodontogram = lazy(() => import("@/components/periodontogram").then(module => ({ default: module.Periodontogram })));
const Odontogram = lazy(() => import("@/components/odontogram").then(module => ({ default: module.Odontogram })));
const PatientImages = lazy(() => import("@/components/patient-images").then(module => ({ default: module.PatientImages })));
import { emptyOdontogram, formatFdi, summarizePerio, type ClinicalImage, type OdontogramData, type OdontogramSurface, type PerioExam, type PerioTooth, type SurfaceFinding, type ToothHistoryEvent } from "@/app/clinical-data";
import { installedImplantTeeth } from "@/app/implant-evidence";
import { cariesDetail } from "@/lib/caries";
import { cementedCrownFromEvolution } from "@/app/crown-evidence";
import { bestStoredNameMatches, hasFourNameParts, normalizePatientName } from "@/app/patient-identity";
import { nameSimilarity, type DictatedIdentity } from "@/lib/dictation/patient-identify";
import { agendaWeekDays, agendaWeekRangeLabel, mondayOfAgendaWeek, santiagoDateISO, shiftAgendaWeek } from "@/app/agenda-week";

type Patient = { id:number; name:string; birthDate:string; rut:string; phone:string; email:string; reason:string; status:string; allergies:string; history:string };
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
type ClinicalLoadResponse = { error?:string; viewer?:{name?:string;email?:string}; patients:Patient[]; notes:Note[]; budgets:Budget[]; payments?:Payment[]; appointments:Appointment[]; calendarEvents:CalendarEvent[]; calendarSnapshotAt?:string|null; calendarSyncedAt?:string|null; periodontalExams:Record<number,PerioExam[]>; toothStatuses:Record<number,OdontogramData>; clinicalImages:ClinicalImage[] };
type ClinicalMutationResponse = { error?:string; odontogram:OdontogramData; exam:PerioExam; deleted?:boolean; patient:Patient; note:Note; budget:Budget; budgets?:Budget[]; payment?:Payment; appointment:Appointment; image:ClinicalImage; chart?:{odontogram?:OdontogramData;updatedTeeth?:number[];warning?:string} };
type ClinicalReview = { patientId:number; heading:string; details:string[]; body?:string };
type WebMcpRegistry = { registerTool(tool:{name:string;title?:string;description:string;inputSchema:object;execute:(input:unknown)=>unknown|Promise<unknown>},options?:{signal?:AbortSignal}):void|Promise<void> };
const initialPatients:Patient[] = [];
const initialNotes:Note[] = [];
const initialBudgets:Budget[] = [];
const initialAppointments:Appointment[] = [];
const initialCalendarEvents:CalendarEvent[] = [];
const money=(n:number)=>new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(n);
const initials=(s:string)=>s.trim().split(/\s+/).slice(0,2).map(w=>w[0]?.toUpperCase()).join("");
const chileDate=(value:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"}).format(value);
const chileToday=()=>{const parts=new Intl.DateTimeFormat("en-US",{timeZone:"America/Santiago",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const get=(type:string)=>Number(parts.find(p=>p.type===type)?.value);return {year:get("year"),month:get("month"),day:get("day")}};
const ageFromBirthDate=(value:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const [year,month,day]=value.split("-").map(Number),date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null;const now=chileToday();const age=now.year-year-((now.month<month||(now.month===month&&now.day<day))?1:0);return age>=0&&age<=125?age:null};
const rutParts=(value:string)=>value.toUpperCase().replace(/[^0-9K]/g,"");
const validRut=(value:string)=>{const clean=rutParts(value),body=clean.slice(0,-1),dv=clean.slice(-1);if(!/^\d{1,9}$/.test(body)||!/[0-9K]/.test(dv))return false;let sum=0,multiplier=2;for(let i=body.length-1;i>=0;i--){sum+=Number(body[i])*multiplier;multiplier=multiplier===7?2:multiplier+1}const result=11-sum%11;return (result===11?"0":result===10?"K":String(result))===dv};
const formatRut=(value:string)=>{const clean=rutParts(value),body=clean.slice(0,-1),dv=clean.slice(-1);return body?`${Number(body).toLocaleString("es-CL")}-${dv}`:value};
const validPhone=(value:string)=>!value||(/^[+\d()\s.-]{7,24}$/.test(value)&&value.replace(/\D/g,"").length>=8);
const validEmail=(value:string)=>!value||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validExistingPatientName=(value:string,stored:string)=>{const clean=value.trim(),normalized=normalizePatientName(clean);return Boolean(normalized)&&clean.length<=180&&(normalized===normalizePatientName(stored)||normalized.split(/\s+/).filter(Boolean).length>=2)};
const validatePatientDraft=(draft:PatientDraft):PatientDraftValidation=>{const missingFields:string[]=[],invalidFields:string[]=[];if(!hasFourNameParts(draft.name))missingFields.push("Dos nombres y dos apellidos");if(!draft.birthDate.trim())missingFields.push("Fecha de nacimiento");else if(ageFromBirthDate(draft.birthDate)===null)invalidFields.push("Fecha de nacimiento");if(draft.rut.trim()&&!validRut(draft.rut))invalidFields.push("RUN / RUT");if(!validPhone(draft.phone.trim()))invalidFields.push("Teléfono");if(!validEmail(draft.email.trim()))invalidFields.push("Correo electrónico");return {missingFields,invalidFields,valid:missingFields.length===0&&invalidFields.length===0}};
const patientValidationMessage=(validation:PatientDraftValidation)=>[validation.missingFields.length?"Falta completar: "+validation.missingFields.join(", ")+".":"",validation.invalidFields.length?"Revisa: "+validation.invalidFields.join(", ")+".":""].filter(Boolean).join(" ");
function Info({label,value}:{label:string;value:string}){return <div><p className="text-xs font-medium uppercase tracking-wide text-[#8aa0a5]">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label className="block space-y-1.5 text-sm font-medium">{label}{children}</label>}
function Empty({text}:{text:string}){return <p className="rounded-xl border border-dashed border-[#dce5e7] p-6 text-center text-sm text-[#71858b]">{text}</p>}
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
    <span className="text-xs font-medium text-[#71858b]">{agendaWeekRangeLabel(weekStart)}</span>
  </div>;
}
/** Aviso cuando la agenda importada de Google Calendar lleva más de 36 horas sin actualizarse (la sincronización automática puede haberse detenido). */
function CalendarFreshness({syncedAt}:{syncedAt:string|null|undefined}) {
  const [now]=useState(()=>Date.now());
  if(!syncedAt) return <p role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">La agenda aún no se ha sincronizado con Google Calendar.</p>;
  const when=new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(syncedAt));
  const stale=now-Date.parse(syncedAt)>36*3600*1000;
  return stale
    ? <p role="alert" className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">La agenda no se actualiza desde el {when}. Las citas nuevas de Google Calendar pueden no aparecer: revisa la sincronización automática.</p>
    : <p className="mt-2 text-xs text-[#71858b]">Agenda sincronizada con Google Calendar el {when}.</p>;
}
function WeeklyAgendaMosaic({days,events}:{days:WeekDay[];events:CalendarEvent[]}) {
  const timedAppointments=events.filter(event=>event.status==="confirmed"&&!event.allDay);
  const time=(value:string)=>new Intl.DateTimeFormat("es-CL",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"America/Santiago"}).format(new Date(value));
  return <div className="overflow-x-auto"><div className="grid min-w-[900px] grid-cols-7 gap-2">{days.map(day=><section key={day.key} className="min-h-36 rounded-xl border border-[#e1e9e9] bg-white"><header className="border-b border-[#e8eeee] px-2 py-3 text-center"><p className="text-xs font-semibold uppercase text-[#71858b]">{day.label}</p><p className="mt-1 text-lg font-semibold text-[#20343b]">{day.date}</p></header><div className="min-h-24 space-y-2 p-2">{timedAppointments.filter(event=>chileDate(new Date(event.startAt))===day.key).map(event=><article key={event.id} className="rounded-lg bg-[#d8f2ef] px-2 py-2 text-[#174c50]"><p className="break-words text-sm font-semibold leading-5">{event.title}</p><p className="mt-1 text-xs font-medium">{time(event.startAt)}–{time(event.endAt)}</p></article>)}</div></section>)}</div>{timedAppointments.length===0&&<p className="mt-3 text-center text-sm text-[#71858b]">No hay citas importadas para esta semana.</p>}</div>;
}
export default function Home(){
  const [patients,setPatients]=useState(initialPatients),[notes,setNotes]=useState(initialNotes),[budgets,setBudgets]=useState(initialBudgets),[payments,setPayments]=useState<Payment[]>([]),[appointments,setAppointments]=useState(initialAppointments),[calendarEvents,setCalendarEvents]=useState(initialCalendarEvents);
  const [calendarSnapshotAt,setCalendarSnapshotAt]=useState<string|null>(null),[calendarSyncedAt,setCalendarSyncedAt]=useState<string|null>(null);
  const [viewerName,setViewerName]=useState(""),[viewerEmail,setViewerEmail]=useState("");
  const [periodontalExams,setPeriodontalExams]=useState<Record<number,PerioExam[]>>({}),[clinicalImages,setClinicalImages]=useState<ClinicalImage[]>([]);
  const [weekStart,setWeekStart]=useState(()=>mondayOfAgendaWeek(santiagoDateISO(new Date())));
  const weekEnd=shiftAgendaWeek(weekStart,1);
  const weekDays:WeekDay[]=agendaWeekDays(weekStart);
  const showCurrentAgendaWeek=()=>setWeekStart(mondayOfAgendaWeek(santiagoDateISO(new Date())));
  const weekCalendarEvents=calendarEvents.filter(event=>{const day=chileDate(new Date(event.startAt));return day>=weekStart&&day<weekEnd}).sort((a,b)=>a.startAt.localeCompare(b.startAt));

  const [selectedId,setSelectedId]=useState(0),[section,setSection]=useState("Inicio"),[modal,setModal]=useState<Modal>(null),[search,setSearch]=useState(""),[mobileNav,setMobileNav]=useState(false);
  const [navigationHistory,setNavigationHistory]=useState<Array<{section:string;patientId:number;tab:string}>>([]);
  const modalRef=useRef<Modal>(null);
  useEffect(()=>{modalRef.current=modal},[modal]);
  const [activeTab,setActiveTab]=useState("evoluciones");
  const [toothStatuses,setToothStatuses]=useState<Record<number,OdontogramData>>({});
  const [name,setName]=useState(""),[birthDate,setBirthDate]=useState(""),[rut,setRut]=useState(""),[phone,setPhone]=useState(""),[email,setEmail]=useState(""),[reason,setReason]=useState(""),[allergies,setAllergies]=useState(""),[history,setHistory]=useState(""),[patientError,setPatientError]=useState("");
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
        const response=await fetch("/api/clinical",{cache:"no-store"});
        const data=await response.json() as ClinicalLoadResponse;
        if(!response.ok)throw new Error(data.error||"No se pudo abrir la base de datos.");
        if(!active)return;
        setPatients(data.patients);setNotes(data.notes);setBudgets(data.budgets);setPayments(data.payments??[]);setAppointments(data.appointments);setCalendarEvents(data.calendarEvents||[]);setCalendarSnapshotAt(data.calendarSnapshotAt||null);setCalendarSyncedAt(data.calendarSyncedAt||null);setViewerName(data.viewer?.name||"");setViewerEmail(data.viewer?.email||"");
        setPeriodontalExams(data.periodontalExams);setToothStatuses(data.toothStatuses);setClinicalImages(data.clinicalImages);setLoadError("");
      }catch(e){if(active)setLoadError(e instanceof Error?e.message:"No se pudo cargar la ficha.");}
      finally{requestRunning=false;if(active)setLoading(false)}
    };
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
  const applyClinicalLoad=useCallback((data:ClinicalLoadResponse)=>{
    setPatients(data.patients);setNotes(data.notes);setBudgets(data.budgets);setPayments(data.payments??[]);setAppointments(data.appointments);setCalendarEvents(data.calendarEvents||[]);setCalendarSnapshotAt(data.calendarSnapshotAt||null);setCalendarSyncedAt(data.calendarSyncedAt||null);
    setPeriodontalExams(data.periodontalExams);setToothStatuses(data.toothStatuses);setClinicalImages(data.clinicalImages);setLoadError("");
  },[]);
  const downloadClinicalRecords=useCallback(async()=>{
    setExporting(true);setExportError("");
    try{
      const response=await fetch("/api/clinical/export",{cache:"no-store"});
      if(!response.ok){const data=await response.json() as {error?:string};throw new Error(data.error||"No se pudieron descargar las fichas.")}
      const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement("a");
      link.href=url;link.download=`gestion-dental-pacientes-${chileToday().year}-${String(chileToday().month).padStart(2,"0")}-${String(chileToday().day).padStart(2,"0")}.json`;
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
    await persist(mode==="delete"?{action:"deleteEvolution",patientId,evolutionId,confirm:"eliminar",...extra}:{action:"annulEvolution",patientId,evolutionId,reason,...extra});
    const response=await fetch("/api/clinical",{cache:"no-store"});
    if(response.ok)applyClinicalLoad(await response.json() as ClinicalLoadResponse);
    const done=mode==="delete"?"Evolución eliminada":"Evolución anulada (visible con «Ver anuladas»)";
    setChartMessage(`${done}${replacement?" y nueva evolución guardada":""}. El odontograma y los pagos no cambian solos.`);
  },[persist,applyClinicalLoad]);
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
  const patientImages=clinicalImages.filter(item=>item.patientId===selectedId);
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
  const paymentTargetBudget=patientBudgets.find(b=>b.id===paymentBudgetId)??null;
  const paymentTargetPaid=paymentTargetBudget?patientPayments.filter(p=>p.budgetId===paymentTargetBudget.id).reduce((sum,p)=>sum+p.amount,0):0;
  const toothEvolutionHistory:ToothHistoryEvent[]=patientNotes.flatMap(note=>(note.diagnoses??[]).filter(diagnosis=>diagnosis.tooth!==null).map((diagnosis,index)=>({
    id:`diagnosis:${note.id}:${diagnosis.id??index}`,
    tooth:diagnosis.tooth as number,
    recordedAt:note.recordedAt??(note.clinicalDate?`${note.clinicalDate}T12:00:00.000Z`:""),
    clinicalDate:note.clinicalDate,
    eventType:"diagnosis" as const,
    source:"evolution" as const,
    sourceEvolutionId:note.id,
    title:diagnosis.title,
    detail:[diagnosis.code?`CIE-11 ${diagnosis.code}`:"",diagnosis.findings].filter(Boolean).join(" · "),
  })));
  const nav=[{name:"Inicio",icon:HomeIcon},{name:"Resumen",icon:LayoutDashboard},{name:"Pacientes",icon:Users},{name:"Ficha clínica",icon:Stethoscope},{name:"Agenda",icon:CalendarDays},{name:"Presupuestos",icon:Wallet}];
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
  const createDictatedPatient=async(fields:NewPatientFields)=>{
    if(!hasFourNameParts(fields.name))throw new Error("Escribe los dos nombres y los dos apellidos.");
    const data=await persist({action:"createPatient",name:fields.name.trim(),birthDate:fields.birthDate,rut:fields.rut.trim(),phone:fields.phone.trim(),email:fields.email.trim()});
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
  const homeCards=[
    {name:"Resumen",icon:LayoutDashboard,description:"Actividad general de la consulta",detail:"Ver resumen"},
    {name:"Pacientes",icon:Users,description:"Buscar pacientes y abrir sus fichas",detail:`${patients.length} pacientes`},
    {name:"Ficha clínica",icon:Stethoscope,description:patient?"Continuar con la ficha seleccionada":"Seleccionar un paciente para abrir su ficha",detail:patient?.name||"Abrir ficha"},
    {name:"Agenda",icon:CalendarDays,description:"Ver las citas de la semana",detail:`${weekCalendarEvents.filter(event=>event.status==="confirmed"&&!event.allDay).length} citas esta semana`},
    {name:"Presupuestos",icon:Wallet,description:"Elige un paciente para ver sus planes",detail:`${new Set(budgets.map(b=>b.patientId)).size} pacientes con presupuesto`},
  ];
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
  const resetModal=useCallback(()=>{setFormError("");setModal(null);modalRef.current=null;setName("");setBirthDate("");setRut("");setPhone("");setEmail("");setReason("");setAllergies("");setHistory("");patientDraftRef.current={name:"",birthDate:"",rut:"",phone:"",email:"",reason:""};setPatientError("");setPatientAttemptedSave(false);setNoteTitle("");setNoteBody("");requestIdRef.current="";setBudgetTitle("");setBudgetItems([{label:"",amount:0,phase:"Fase 1",discountPercent:0}]);setEditingBudgetId(null);setAlternativeParentBudgetId(null);setEditingAppointmentId(null);setApptDate("");setApptTime("");setApptReason("")},[setAllergies,setAlternativeParentBudgetId,setApptDate,setApptReason,setApptTime,setBudgetItems,setBudgetTitle,setEmail,setHistory,setName,setNoteBody,setNoteTitle,setPhone,setRut]);
  const editPatient=()=>{if(!patient)return;setName(patient.name);setRut(patient.rut||"");setPhone(patient.phone||"");setEmail(patient.email||"");setAllergies(patient.allergies==="Sin registrar"?"":patient.allergies);setHistory(patient.history==="Sin registrar"?"":patient.history);setModal("editPatient")};
  const editBudget=(budget:Budget)=>{if(!patient||budget.patientId!==selectedId)return;setEditingBudgetId(budget.id);setAlternativeParentBudgetId(null);setBudgetTitle(budget.title);setBudgetItems(budget.items.map(item=>({label:item.label,amount:item.amount,phase:item.phase||"Fase 1",discountPercent:item.discountPercent??0})));setModal("editBudget")};
  const startNewBudget=()=>{setBudgetTitle("");setBudgetItems([{label:"",amount:0,phase:"Fase 1",discountPercent:0}]);setEditingBudgetId(null);setAlternativeParentBudgetId(null);setModal("budget")};
  const startBudgetAlternative=(budget:Budget)=>{setBudgetTitle(budget.title+" · Alternativa");setBudgetItems(budget.items.map(item=>({label:item.label,amount:item.amount,phase:item.phase||"Fase 1",discountPercent:item.discountPercent??0})));setEditingBudgetId(null);setAlternativeParentBudgetId(budget.id);setModal("budget")};
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
  const editAppointment=(appointment:Appointment)=>{setSelectedId(appointment.patientId);setEditingAppointmentId(appointment.id);setApptReason(appointment.reason);setModal("editAppointment")};
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
    const data=await persist({action:"createPatient",name:clean.name,birthDate:clean.birthDate,rut:clean.rut,phone:clean.phone,email:clean.email,reason:clean.reason});
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
        await savePatientDraft(patientDraft);
      }
      if(modal==="editPatient"){
        if(!validPhone(phone.trim())||!validEmail(email.trim())||(rut.trim()&&!validRut(rut.trim())))throw new Error("Revisa el RUN / RUT, teléfono y correo electrónico.");
        if(!validExistingPatientName(name,patient?.name||""))throw new Error("Para cambiar el nombre de una ficha existente, ingresa al menos un nombre y un apellido.");
        const data=await persist({action:"updatePatient",patientId:selectedId,name:name.trim(),rut:rut.trim(),phone:phone.trim(),email:email.trim(),allergies:allergies.trim(),history:history.trim()});
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
      }
      if(modal==="editAppointment"){
        if(!editingAppointmentId||!apptReason.trim())throw new Error("Escribe el motivo de la cita.");
        const data=await persist({action:"updateAppointmentReason",patientId:selectedId,appointmentId:editingAppointmentId,reason:apptReason.trim()});
        setAppointments(previous=>previous.map(a=>a.id===editingAppointmentId?data.appointment:a));
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
  const sidebarContent=<><div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6"><button type="button" onClick={goHome} className="flex size-10 items-center justify-center rounded-xl bg-[#3ca9a5] text-lg font-bold" aria-label="Ir a Inicio">{viewerInitials(viewerName)}</button><span className="leading-tight"><strong className="block text-sm">Gestión Dental</strong><small className="block text-[#92b5b8]">{viewerName||"\u00a0"}</small>{viewerEmail&&viewerEmail!==viewerName&&<small className="block max-w-[11rem] truncate text-[11px] text-[#92b5b8]" title={viewerEmail}>{viewerEmail}</small>}</span><button className="ml-auto lg:hidden" aria-label="Cerrar menú" onClick={()=>setMobileNav(false)}><X className="size-5"/></button></div><nav className="flex-1 space-y-1 px-3 py-7" aria-label="Principal">{nav.map(({name,icon:Icon})=><button key={name} type="button" aria-current={section===name?"page":undefined} onClick={()=>openSection(name)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${section===name?"bg-[#26606a] text-white":"text-[#a9c4c7] hover:bg-white/10 hover:text-white"}`}><Icon className="size-[19px]"/>{name}</button>)}</nav><div className="m-4 rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#7dc6c3]">Proyecto activo</p><p className="mt-2 text-sm leading-5 text-[#c7dcdd]">Primera versión para evaluar el flujo de trabajo.</p></div></>;
  return <div className="min-h-screen bg-[#f4f7f8] text-[#20343b]">
    <div className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-[#102e37] text-white lg:flex">{sidebarContent}</div>
    {mobileNav&&<div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={()=>setMobileNav(false)}><div className="flex h-full w-[260px] flex-col bg-[#102e37] text-white" onClick={e=>e.stopPropagation()}>{sidebarContent}</div></div>}
    <div className="lg:pl-[248px]">
      <header ref={headerRef} className="sticky top-0 z-20 border-b border-[#dce5e7] bg-white/95 backdrop-blur">
        <div className="flex h-[76px] items-center justify-between px-5 md:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="lg:hidden" aria-label="Abrir menú" onClick={()=>setMobileNav(true)}><Menu className="size-6"/></button>
            {section!=="Inicio"&&<button type="button" onClick={goBack} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[#145b60] hover:bg-[#e4f2f1]" aria-label="Volver a la sección anterior"><ArrowLeft className="size-4"/><span className="hidden sm:inline">Volver</span></button>}
            <button type="button" onClick={goHome} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[#145b60] hover:bg-[#e4f2f1]"><HomeIcon className="size-4"/><span className="hidden sm:inline">Inicio</span></button>
            <span className="min-w-0 truncate text-sm font-semibold text-[#20343b]">{section}</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="hidden rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 sm:inline">Ficha privada</span>
            {viewerEmail&&<span className="hidden max-w-[16rem] truncate text-sm text-[#53686e] md:inline" title={viewerEmail}>{viewerName&&viewerName!==viewerEmail?<><strong className="font-semibold text-[#20343b]">{viewerName}</strong> · </>:null}{viewerEmail}</span>}
            {/* Cloudflare Access cierra la sesión en esta ruta y vuelve a la pantalla de ingreso, para entrar con otra cuenta. */}
            <a href="/cdn-cgi/access/logout" className="flex min-h-10 items-center gap-2 rounded-lg border border-[#dce5e7] px-3 text-sm font-medium text-[#53686e] hover:border-[#7bbdb9] hover:bg-[#f7fbfb] hover:text-[#145b60]" aria-label="Cerrar sesión para entrar con otra cuenta"><LogOut className="size-4"/><span className="hidden sm:inline">Cerrar sesión</span></a>
          </div>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-5 pb-3 lg:hidden md:px-9" aria-label="Ir a otra sección">
          {nav.map(({name,icon:Icon})=><button key={name} type="button" aria-current={section===name?"page":undefined} onClick={()=>openSection(name)} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium ${section===name?"border-[#087f83] bg-[#e4f2f1] text-[#145b60]":"border-[#dce5e7] bg-white text-[#53686e]"}`}><Icon className="size-4"/>{name}</button>)}
        </nav>
      </header>
      <main className="mx-auto max-w-[1480px] px-5 pb-16 pt-8 md:px-9"><GoogleDriveBackup/>{loading&&<p role="status" className="mb-4">Cargando fichas…</p>}{loadError&&<p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{loadError} <button type="button" className="underline" onClick={()=>location.reload()}>Reintentar</button></p>}{exportError&&<p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{exportError}</p>}<div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-[.16em] text-[#3c8585]">CLÍNICA · DR. LUIS RODRÍGUEZ</p><h1 className="text-3xl font-semibold tracking-tight md:text-[2.1rem]">{section}</h1><p className="mt-1 text-sm text-[#71858b]">{section==="Ficha clínica"?"Historia y planificación del paciente":section==="Inicio"?"Accede a cada área desde aquí":section==="Resumen"?"Vista general de la consulta":section==="Pacientes"?"Busca y abre una ficha":section==="Agenda"?"Próximas atenciones":section==="Presupuestos"?"Elige un paciente para consultar sus planes individualmente":"Planes de tratamiento y valores"}</p></div><div className="flex flex-wrap items-center gap-2">{section!=="Inicio"&&section!=="Presupuestos"&&<Button className="bg-[#087f83] hover:bg-[#07676b]" onClick={()=>setModal(section==="Agenda"&&patient?"appointment":section==="Presupuestos"&&patient?"budget":section==="Pacientes"||!patient?"patient":"note")}><Plus className="mr-2 size-4"/>{section==="Agenda"?"Nueva cita":section==="Presupuestos"?"Nuevo presupuesto":section==="Pacientes"?"Nuevo paciente":"Nueva evolución"}</Button>}{section==="Pacientes"&&<><Button type="button" variant="outline" onClick={downloadClinicalRecords} disabled={exporting}><Download className="mr-2 size-4"/>{exporting?"Preparando…":"Descargar fichas"}</Button><a href="/importar" className="px-1 text-sm font-medium text-[#087f83] underline">Importar fichas desde Drive</a></>}</div></div>
        {section==="Inicio"&&<div className="space-y-8">
          <GlobalDictation patients={patients} notes={liveNotes} onUsePatient={openDictatedPatient} onCreatePatient={createDictatedPatient} onAnnul={annulEvolution}/>
          <section aria-label="Entradas de la aplicación">
            <div className="mb-4"><h2 className="text-xl font-semibold">Elige una sección</h2><p className="mt-1 text-sm text-[#60757a]">Accede a cada área desde la portada y vuelve a Inicio cuando quieras.</p></div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
              {homeCards.map(({name,icon:Icon,description,detail})=><button key={name} type="button" onClick={()=>openSection(name)} className="group flex min-h-[175px] flex-col rounded-2xl border border-[#dce7e8] bg-white p-5 text-left shadow-sm transition hover:border-[#7bbdb9] hover:bg-[#f7fbfb] focus-visible:outline-2 focus-visible:outline-[#087f83]">
                <span className="flex size-11 items-center justify-center rounded-xl bg-[#dff2ef] text-[#087f83]"><Icon className="size-6"/></span>
                <span className="mt-4 flex w-full items-center justify-between gap-3 text-lg font-semibold text-[#20343b]">{name}<ChevronRight className="size-5 shrink-0 text-[#087f83] transition group-hover:translate-x-1"/></span>
                <span className="mt-1 text-sm text-[#60757a]">{description}</span>
                <span className="mt-3 text-xs font-medium text-[#087f83]">{detail}</span>
              </button>)}
            </div>
          </section>
          <section className="surface" aria-label="Agenda de la semana"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">Esta semana</h2><div className="flex flex-wrap items-center gap-3"><AgendaWeekControls weekStart={weekStart} onPrevious={()=>setWeekStart(current=>shiftAgendaWeek(current,-1))} onNext={()=>setWeekStart(current=>shiftAgendaWeek(current,1))} onCurrent={showCurrentAgendaWeek}/><button type="button" onClick={()=>openSection("Agenda")} className="text-sm font-medium text-[#087f83] hover:underline">Ver agenda completa</button></div></div><WeeklyAgendaMosaic days={weekDays} events={weekCalendarEvents}/><CalendarFreshness syncedAt={calendarSyncedAt}/>{calendarSnapshotAt&&<p className="mt-2 text-xs text-[#71858b]">Última consulta del calendario: {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(calendarSnapshotAt))}.</p>}</section>
        </div>}
        {section==="Ficha clínica"&&patient&&<div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_310px]"><div className="min-w-0 space-y-6"><div className="sticky z-10 -mx-5 flex items-center justify-between gap-3 border-b border-[#dce5e7] bg-white/95 px-5 py-2 backdrop-blur md:static md:mx-0 md:rounded-xl md:border" style={{top:headerHeight}} data-testid="ficha-dictar-bar"><div className="min-w-0"><p className="text-[11px] font-semibold uppercase tracking-wide text-[#71858b]">Ficha abierta</p><p className="truncate font-semibold text-[#173f43]">{patient.name}</p></div><ClinicalDictation prominent patientId={patient.id} patientName={patient.name} odontogram={toothStatuses[selectedId]??emptyOdontogram()} latestNote={patientNotes[0]??null} patient={patient} request={dictationRequest?.patientId===patient.id?dictationRequest:null} persist={persist} onApplied={applyClinicalLoad} budgetOptions={patientBudgets.filter(b=>!b.isAlternative).map(b=>({id:b.id,title:b.title}))} notes={patientNotes} onAnnul={(evolutionId,mode,reason,replacement)=>annulEvolution(patient.id,evolutionId,mode,reason,replacement)}/></div><div className="surface"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-4"><span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#d7ebea] text-lg font-semibold text-[#145b60]">{initials(patient.name)}</span><div><h2 className="text-2xl font-semibold">{patient.name}</h2><p className="text-sm text-[#71858b]">{ageFromBirthDate(patient.birthDate)!==null?`${ageFromBirthDate(patient.birthDate)} años · `:""}{patient.reason}{patient.rut?` · ${patient.rut}`:""}</p></div></div><span className="rounded-full bg-[#e9f5f1] px-3 py-1 text-xs font-semibold text-[#2b7764]">{patient.status}</span></div><div className="mt-7 grid gap-4 border-t border-[#e9eef0] pt-5 sm:grid-cols-3"><Info label="Antecedentes" value={patient.history}/><Info label="Alergias" value={patient.allergies}/><Info label="Presupuestos" value={`${patientBudgets.length} registrados`}/></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#e9eef0] pt-5"><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 [&>*]:min-w-0"><Info label="Teléfono" value={patient.phone||"Sin registrar"}/><Info label="Correo electrónico" value={patient.email||"Sin registrar"}/></div><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" onClick={editPatient}>Editar datos</Button></div></div>{selectedPerio.attention>0&&<button type="button" onClick={()=>setActiveTab("periodontograma")} className="mt-4 w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-950"><strong>Revisar periodontograma</strong><span className="mt-1 block">{selectedPerio.attention} {selectedPerio.attention===1?"sitio":"sitios"} con atención en el último examen · piezas FDI {selectedPerio.affected.map(formatFdi).join(", ")}.</span></button>}</div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4"><TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-[#dce5e7] pb-2"><TabsTrigger value="evoluciones">Evoluciones</TabsTrigger><TabsTrigger value="odontograma">Odontograma</TabsTrigger><TabsTrigger value="periodontograma">Periodontograma</TabsTrigger><TabsTrigger value="imagenes">Imágenes</TabsTrigger><TabsTrigger value="presupuestos">Presupuestos</TabsTrigger></TabsList>
            <TabsContent value="evoluciones"><div className="surface"><div className="flex items-center justify-between"><h3 className="font-semibold">Historia clínica</h3><div className="flex flex-wrap justify-end gap-2">{annulledCount>0&&<Button variant="ghost" size="sm" aria-pressed={showAnnulled} onClick={()=>setShowAnnulled(v=>!v)} data-testid="toggle-annulled">{showAnnulled?"Ocultar anuladas":`Ver anuladas (${annulledCount})`}</Button>}<Button variant="outline" size="sm" onClick={()=>setModal("note")}><FilePlus2 className="mr-2 size-4"/>Añadir registro</Button></div></div>{chartMessage&&<p role="status" className="mt-3 text-sm text-[#31575b]">{chartMessage}</p>}<EvolutionHistory
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
            <TabsContent value="odontograma"><Suspense fallback={<div className="min-h-[320px] rounded-xl bg-white p-5 text-sm text-[#71858b]" role="status">Cargando odontograma…</div>}><Odontogram key={selectedId} onDeleteEvent={deleteToothEvent} onEditEvent={editToothEvent} data={toothStatuses[selectedId]??emptyOdontogram()} evolutionEvents={toothEvolutionHistory} onSetStatus={updateTooth} onSetMissingReason={updateMissingReason} onSetSurface={updateSurface} onSetCrownDetails={updateCrownDetails}/></Suspense></TabsContent>
            <TabsContent value="presupuestos"><div className="surface"><div className="flex justify-between gap-3"><div><h3 className="font-semibold">Planes de tratamiento y presupuestos</h3><p className="mt-1 text-sm text-[#60757a]">Organiza prestaciones por fases y revisa total, abonos y saldo en cada plan.</p></div><Button variant="outline" size="sm" onClick={startNewBudget}>Añadir plan</Button></div><div className="mt-5 space-y-4">{patientBudgets.length?<>
              {patientBudgets.filter(b=>!b.isAlternative).map(primary=>{
                const paid=patientPayments.filter(payment=>payment.budgetId===primary.id).reduce((sum,payment)=>sum+payment.amount,0);
                const alternatives=patientBudgets.filter(budget=>budget.isAlternative&&budget.parentBudgetId===primary.id);
                return <section key={primary.id} className="space-y-3">
                  <BudgetCard budget={primary} paid={paid} payments={patientPayments.filter(payment=>payment.budgetId===primary.id)} onRegisterPayment={()=>openManualPayment(primary)} onEdit={()=>editBudget(primary)} onPrint={()=>setPrintingBudgetId(primary.id)} onCreateAlternative={paid===0&&alternatives.length<12?()=>startBudgetAlternative(primary):undefined}/>
                  {paid>0&&alternatives.length>0&&<p className="ml-4 text-xs text-[#8a5b1c]">Este plan tiene abonos; no se puede cambiar la alternativa principal para conservar el historial financiero.</p>}
                  {alternatives.length>0&&<div className="ml-4 space-y-3 border-l-2 border-amber-200 pl-4">
                    <h4 className="text-sm font-semibold text-[#527075]">Opciones alternativas</h4>
                    {alternatives.map(alternative=><BudgetCard key={alternative.id} budget={alternative} parentTitle={primary.title} onEdit={()=>editBudget(alternative)} onPrint={()=>setPrintingBudgetId(alternative.id)} onSelectPrimary={paid===0?()=>selectBudgetAlternative(alternative):undefined}/>)}
                  </div>}
                </section>;
              })}
              {patientBudgets.filter(budget=>budget.isAlternative&&!patientBudgets.some(primary=>primary.id===budget.parentBudgetId&&!primary.isAlternative)).map(alternative=><BudgetCard key={alternative.id} budget={alternative} onEdit={()=>editBudget(alternative)} onPrint={()=>setPrintingBudgetId(alternative.id)}/>)}
            </>:<Empty text="Aún no hay planes de tratamiento para este paciente."/>}</div><PatientPaymentSummary payments={patientPayments}/></div></TabsContent>
            <TabsContent value="periodontograma"><Suspense fallback={<div className="min-h-[320px] rounded-xl bg-white p-5 text-sm text-[#71858b]" role="status">Cargando periodontograma…</div>}><Periodontogram key={selectedId} onDeleteReading={deletePerioReading} onEditReading={editPerioReading} exams={periodontalExams[selectedId]??[]} toothStatuses={toothStatuses[selectedId]?.teeth??{}} toothHistory={[...(toothStatuses[selectedId]?.history??[]),...toothEvolutionHistory]} onSave={savePerio}/></Suspense></TabsContent>
            <TabsContent value="imagenes"><Suspense fallback={<div className="min-h-[220px] rounded-xl bg-white p-5 text-sm text-[#71858b]" role="status">Cargando imágenes…</div>}><PatientImages key={selectedId} images={patientImages} onAdd={addImages} onRemove={removeImage}/></Suspense></TabsContent>
          </Tabs></div><aside className="space-y-5"><div className="surface"><h3 className="font-semibold">Próximas citas</h3><div className="mt-5 space-y-4">{appointments.filter(a=>a.patientId===selectedId).length?appointments.filter(a=>a.patientId===selectedId).map(a=><div key={a.id} className="rounded-xl bg-[#f1f7f7] p-4"><p className="font-semibold text-[#087f83]">{a.day} · {a.time}</p><p className="mt-1 text-sm">{a.reason}</p><Button size="sm" variant="outline" className="mt-3" onClick={()=>editAppointment(a)}>Editar motivo</Button></div>):<Empty text="Sin citas agendadas."/>}</div><Button variant="outline" className="mt-5 w-full" onClick={()=>setModal("appointment")}>Agendar control</Button></div><div className="rounded-2xl bg-[#103c44] p-6 text-white"><Activity className="mb-4 size-6 text-[#7ed1ca]"/><h3 className="font-semibold">Secuencia clínica</h3><p className="mt-2 text-sm leading-6 text-[#bbd3d5]">Documenta evaluación, cirugía, componentes, rehabilitación y controles en orden cronológico.</p></div></aside></div>}
        {section==="Pacientes"&&<div className="surface">{linkNotice&&<p role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="link-notice">{linkNotice}</p>}<div className="relative mb-5 max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa0a5]"/><Input aria-label="Buscar paciente por nombre o RUT" placeholder="Buscar por nombre o RUT" value={search} onChange={e=>setSearch(e.target.value)} className="pl-10"/></div><div className="space-y-2">{filteredPatients.map(p=><button key={p.id} onClick={()=>openPatient(p.id)} className="flex w-full items-center gap-4 rounded-xl border border-[#e8edef] p-4 text-left transition hover:border-[#8dc8c6] hover:bg-[#f7fbfb]"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#e4f2f1] text-sm font-bold text-[#187477]">{initials(p.name)}</span><span className="min-w-0 flex-1"><strong className="block truncate">{p.name}</strong><small className="text-sm text-[#71858b]">{p.reason}{p.birthDate?` · Nacimiento: ${p.birthDate}`:" · Nacimiento sin registrar"}{p.rut?` · RUT: ${p.rut}`:""}</small></span><ChevronRight className="size-5 text-[#8aa0a5]"/></button>)}{!filteredPatients.length&&<Empty text="No se encontraron pacientes."/>}</div></div>}
        {section==="Resumen"&&<div className="grid grid-cols-1 gap-5 md:grid-cols-3 [&>*]:min-w-0">{[["Pacientes en esta sesión",patients.length,Users],["Citas programadas",appointments.length,CalendarDays],["Pacientes con presupuesto",new Set(budgets.map(b=>b.patientId)).size,ClipboardList]].map(([label,value,Icon])=><div key={String(label)} className="surface"><div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-[#e4f2f1] text-[#087f83]">{typeof Icon!=="number"&&typeof Icon!=="string"&&<Icon className="size-5"/>}</div><p className="text-3xl font-semibold">{String(value)}</p><p className="mt-1 text-sm text-[#71858b]">{String(label)}</p></div>)}<div className="surface md:col-span-3"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Agenda semanal</h3><AgendaWeekControls weekStart={weekStart} onPrevious={()=>setWeekStart(current=>shiftAgendaWeek(current,-1))} onNext={()=>setWeekStart(current=>shiftAgendaWeek(current,1))} onCurrent={showCurrentAgendaWeek}/></div><div className="mt-4"><WeeklyAgendaMosaic days={weekDays} events={weekCalendarEvents}/><CalendarFreshness syncedAt={calendarSyncedAt}/>{calendarSnapshotAt&&<p className="mt-2 text-xs text-[#71858b]">Citas consultadas en Google Calendar el {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(calendarSnapshotAt))}.</p>}</div></div><div className={`surface md:col-span-3 ${perioAlerts.length?"border-amber-200 bg-amber-50":""}`}><h3 className="font-semibold">Atención periodontal</h3>{perioAlerts.length?<div className="mt-3 space-y-2">{perioAlerts.map(({patient:p,summary,date})=><button key={p.id} type="button" onClick={()=>openPatient(p.id,"periodontograma")} className="flex w-full flex-wrap justify-between gap-2 rounded-lg border border-amber-200 bg-white p-3 text-left text-sm hover:border-amber-400"><span><strong>{p.name}</strong><span className="ml-2 text-[#714e13]">{summary.attention} {summary.attention===1?"sitio":"sitios"} · piezas FDI {summary.affected.map(formatFdi).join(", ")}</span></span><span className="text-[#60757a]">{date} · Ver examen</span></button>)}</div>:<p className="mt-2 text-sm text-[#60757a]">No hay sitios destacados en los periodontogramas registrados en esta sesión.</p>}<p className="mt-2 text-xs text-[#60757a]">Alertas de revisión clínica; no equivalen a un diagnóstico.</p></div><div className="surface md:col-span-3"><h3 className="font-semibold">Actividad reciente</h3><div className="mt-5 space-y-3">{liveNotes.slice(0,4).map(n=><button key={n.id} onClick={()=>openPatient(n.patientId)} className="flex w-full justify-between gap-4 rounded-lg border-b border-[#ecf0f1] py-3 text-left hover:text-[#087f83]"><span><strong className="block font-medium">{n.title}</strong><span className="text-sm text-[#71858b]">{patients.find(p=>p.id===n.patientId)?.name}</span></span><span className="text-sm text-[#71858b]">{n.date}</span></button>)}</div></div></div>}
        {section==="Agenda"&&<div className="surface"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Agenda semanal</h3><AgendaWeekControls weekStart={weekStart} onPrevious={()=>setWeekStart(current=>shiftAgendaWeek(current,-1))} onNext={()=>setWeekStart(current=>shiftAgendaWeek(current,1))} onCurrent={showCurrentAgendaWeek}/></div><div className="mt-4"><WeeklyAgendaMosaic days={weekDays} events={weekCalendarEvents}/><CalendarFreshness syncedAt={calendarSyncedAt}/>{calendarSnapshotAt&&<p className="mt-2 text-xs text-[#71858b]">Citas consultadas en Google Calendar el {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(calendarSnapshotAt))}.</p>}</div></div>}{section==="Presupuestos"&&<section className="surface" aria-label="Presupuestos por paciente"><div className="mb-4"><h2 className="font-semibold">Elige un paciente</h2><p className="mt-1 text-sm text-[#60757a]">Cada ficha tiene sus propios presupuestos, pagos y opciones para añadir o editar planes.</p></div><div className="space-y-2">{patients.length?patients.map(p=>{const count=budgets.filter(b=>b.patientId===p.id).length;return <button key={p.id} type="button" onClick={()=>openPatient(p.id,"presupuestos")} className="flex w-full items-center justify-between gap-4 rounded-xl border border-[#dce7e8] bg-white p-4 text-left transition hover:border-[#7bbdb9] hover:bg-[#f7fbfb] focus-visible:outline-2 focus-visible:outline-[#087f83]"><span className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#dff2ef] text-sm font-semibold text-[#145b60]">{initials(p.name)}</span><span className="min-w-0"><span className="block truncate font-medium text-[#20343b]">{p.name}</span><span className="mt-0.5 block text-sm text-[#60757a]">{count===1?"1 presupuesto":`${count} presupuestos`}</span></span></span><span className="shrink-0 text-sm font-medium text-[#087f83]">Abrir ficha <ChevronRight className="ml-1 inline size-4"/></span></button>}):<Empty text="No hay pacientes registrados."/>}</div></section>}
        <p className="mt-10 text-center text-xs text-[#82969a]">La ficha se guarda en Gestión Dental. Si autorizas tu Google Drive, la aplicación sincroniza automáticamente el respaldo; las imágenes clínicas siguen almacenadas en la aplicación.</p>
      </main></div>
    <AnnulEvolutionDialog note={annulTarget} onClose={()=>setAnnulTarget(null)} onConfirm={(evolutionId,mode,reason,replacement)=>annulEvolution(annulTarget?.patientId??selectedId,evolutionId,mode,reason,replacement)}/>
    <Dialog open={clinicalReview!==null} onOpenChange={open=>{if(!open)finishReview(false)}}><DialogContent className="max-h-[90vh] supports-[height:1dvh]:max-h-[90dvh] overflow-y-auto bg-white sm:max-w-xl"><DialogHeader><DialogTitle>Revisar antes de guardar</DialogTitle><DialogDescription>Confirma el paciente y los datos clínicos. Puedes volver a corregirlos sin guardar.</DialogDescription></DialogHeader><div className="space-y-3 text-sm"><p>Paciente: <strong>{patients.find(item=>item.id===clinicalReview?.patientId)?.name||"Paciente no identificado"}</strong></p><p className="font-semibold">{clinicalReview?.heading}</p>{clinicalReview?.body&&<div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border p-3">{clinicalReview.body}</div>}{clinicalReview?.details.length?<ul className="list-inside list-disc space-y-1 rounded-lg bg-[#f2faf9] p-3">{clinicalReview.details.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p className="rounded-lg bg-amber-50 p-3 text-amber-950">No se detectaron cambios automáticos en los diagramas. Comprueba si corresponde registrarlos manualmente.</p>}</div><DialogFooter><Button variant="outline" onClick={()=>finishReview(false)}>Volver y corregir</Button><Button className="bg-[#087f83] hover:bg-[#07676b]" onClick={()=>finishReview(true)}>Confirmar y guardar</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={modal!==null} onOpenChange={v=>{if(!v)resetModal()}}><DialogContent className={`max-h-[90vh] supports-[height:1dvh]:max-h-[90dvh] overflow-y-auto border-[#dce5e7] bg-white ${modal === "budget" || modal === "editBudget" ? "sm:max-w-2xl" : "sm:max-w-md"}`}><DialogHeader><DialogTitle>{modal==="patient"?"Nuevo paciente":modal==="editPatient"?"Editar datos del paciente":modal==="note"?"Nueva evolución":modal==="budget"?(alternativeParentBudgetId?"Nueva alternativa de tratamiento":"Nuevo plan de tratamiento"):modal==="editBudget"?"Editar plan de tratamiento":modal==="editAppointment"?"Editar motivo de cita":"Nueva cita"}</DialogTitle><DialogDescription>{modal === "budget" || modal === "editBudget" ? (alternativeParentBudgetId ? "Esta cotización no recibe pagos hasta establecerla como plan principal." : "Agrupa las prestaciones por fases y revisa los valores antes de guardar.") : "Los cambios se guardan en la ficha clínica. La fecha de cada evolución se asigna automáticamente."}</DialogDescription></DialogHeader><div className="space-y-4 py-2">
        {modal==="patient"&&<div className="rounded-xl border border-[#cfe3e1] bg-[#f5faf9] p-3 text-sm"><p className="font-semibold text-[#145b60]">Dicta con ChatGPT Voice</p><p className="mt-1 leading-5 text-[#53686e]">Di “nuevo paciente” en ChatGPT Work y cuenta los datos como en una conversación. ChatGPT preparará esta ficha y te preguntará por el nombre o la fecha de nacimiento si faltan. La aplicación no necesita una API de voz.</p><p className="mt-1 text-xs leading-5 text-[#60757a]">{voiceToolsReady?"Las acciones de esta ficha están disponibles para ChatGPT en esta pestaña.":"Abre la aplicación dentro de un ChatGPT compatible para habilitar las acciones de voz."} Al confirmar el registro, la app lo guarda en la ficha; la aplicación sincroniza el respaldo con el Google Drive autorizado para esta cuenta.</p></div>}
        {modal==="patient"&&<><Field label="Dos nombres y dos apellidos *"><Input ref={nameRef} value={name} onChange={e=>{const value=e.target.value;setName(value);patientDraftRef.current={...patientDraftRef.current,name:value};setPatientError("")}} placeholder="Ej. Ana María Pérez Rojas" maxLength={180} aria-invalid={patientAttemptedSave&&!hasFourNameParts(name)} aria-describedby={patientAttemptedSave&&!hasFourNameParts(name)?"name-missing":undefined}/>{patientAttemptedSave&&!hasFourNameParts(name)&&<span id="name-missing" className="block text-xs font-medium text-[#a43542]">Registra los dos nombres y los dos apellidos, en ese orden.</span>}</Field><Field label="Fecha de nacimiento *"><Input ref={birthDateRef} type="date" value={birthDate} max={`${chileToday().year}-${String(chileToday().month).padStart(2,"0")}-${String(chileToday().day).padStart(2,"0")}`} onChange={e=>{const value=e.target.value;setBirthDate(value);patientDraftRef.current={...patientDraftRef.current,birthDate:value};setPatientError("")}} aria-invalid={patientAttemptedSave&&(!birthDate||ageFromBirthDate(birthDate)===null)} aria-describedby={patientAttemptedSave&&(!birthDate||ageFromBirthDate(birthDate)===null)?"birthdate-missing":undefined}/>{patientAttemptedSave&&(!birthDate||ageFromBirthDate(birthDate)===null)&&<span id="birthdate-missing" className="block text-xs font-medium text-[#a43542]">{birthDate?"Revisa la fecha de nacimiento.":"Falta la fecha de nacimiento."}</span>}</Field>{birthDate&&<p className="text-sm text-[#60757a]">{ageFromBirthDate(birthDate)===null?"Fecha no válida":`Edad calculada: ${ageFromBirthDate(birthDate)} años`}</p>}<Field label="RUN / RUT chileno"><Input ref={rutRef} inputMode="text" autoCapitalize="characters" value={rut} maxLength={14} onChange={e=>{const value=e.target.value;setRut(value);patientDraftRef.current={...patientDraftRef.current,rut:value};setPatientError("")}} onBlur={()=>{if(validRut(rut)){const value=formatRut(rut);setRut(value);patientDraftRef.current={...patientDraftRef.current,rut:value}}}} placeholder="12.345.678-5" aria-invalid={Boolean(rut)&&!validRut(rut)}/></Field>{rut&&!validRut(rut)&&<p className="text-sm text-[#a43542]">RUT o dígito verificador no válido.</p>}<Field label="Teléfono"><Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e=>{setPhone(e.target.value);patientDraftRef.current={...patientDraftRef.current,phone:e.target.value}}} placeholder="+56 9 6696 3089" aria-invalid={Boolean(phone)&&!validPhone(phone)}/></Field><Field label="Correo electrónico"><Input type="email" inputMode="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);patientDraftRef.current={...patientDraftRef.current,email:e.target.value}}} placeholder="paciente@ejemplo.cl" aria-invalid={Boolean(email)&&!validEmail(email)}/></Field><Field label="Motivo de consulta"><Input value={reason} onChange={e=>{const value=e.target.value;setReason(value);patientDraftRef.current={...patientDraftRef.current,reason:value}}} placeholder="Evaluación implantológica"/></Field>{patientAttemptedSave&&!patientValidation.valid&&<div role="alert" className="rounded-lg border border-[#e4a0a7] bg-[#fff5f5] p-3 text-sm text-[#922f3a]"><p className="font-semibold">Revisa la ficha antes de guardar:</p><div className="mt-2 flex flex-wrap gap-2">{patientValidation.missingFields.map(field=><button type="button" key={field} className="rounded-full border border-[#d88d96] bg-white px-3 py-1.5 text-left font-semibold underline decoration-dotted underline-offset-2" onClick={()=>field.toLowerCase().includes("nombre")?nameRef.current?.focus():birthDateRef.current?.focus()}>Falta {field.toLowerCase()} · completar</button>)}{patientValidation.invalidFields.map(field=><button type="button" key={field} className="rounded-full border border-[#d88d96] bg-white px-3 py-1.5 text-left font-semibold underline decoration-dotted underline-offset-2" onClick={()=>field==="RUN / RUT"?rutRef.current?.focus():birthDateRef.current?.focus()}>Revisar {field.toLowerCase()}</button>)}</div></div>}{patientError&&patientValidation.valid&&<p role="alert" className="text-sm font-medium text-[#a43542]">{patientError}</p>}</>}{modal==="editPatient"&&<><Field label="Nombre del paciente *"><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre y apellido" maxLength={180} aria-invalid={!validExistingPatientName(name,patient?.name||"")}/><span className="block text-xs text-[#71858b]">En fichas existentes, conserva el nombre registrado o cámbialo con datos confirmados. Los cuatro componentes se solicitan al crear pacientes nuevos.</span></Field><Field label="RUN / RUT chileno"><Input inputMode="text" autoCapitalize="characters" value={rut} maxLength={14} onChange={e=>setRut(e.target.value)} onBlur={()=>{if(rut&&validRut(rut))setRut(formatRut(rut))}} placeholder="12.345.678-5" aria-invalid={Boolean(rut)&&!validRut(rut)}/></Field><Field label="Teléfono"><Input type="tel" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+56 9 6696 3089" aria-invalid={Boolean(phone)&&!validPhone(phone)}/></Field><Field label="Correo electrónico"><Input type="email" inputMode="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="paciente@ejemplo.cl" aria-invalid={Boolean(email)&&!validEmail(email)}/></Field><Field label="Alergias"><Input value={allergies} onChange={e=>setAllergies(e.target.value)} placeholder="Sin registrar"/></Field><Field label="Antecedentes"><Textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Sin registrar" rows={3}/></Field></>}{modal==="note"&&<><p className="text-sm text-[#71858b]">Paciente: <strong className="text-[#20343b]">{patient?.name}</strong></p><Field label="Título"><Input value={noteTitle} onChange={e=>setNoteTitle(e.target.value)} placeholder="Evolución clínica (opcional)"/></Field><div className="space-y-2"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Registro clínico</span><Button type="button" variant="outline" size="sm" onClick={()=>{if(!patient)return;const text=noteBody.trim();resetModal();setDictationRequest({nonce:Date.now(),text,patientId:patient.id})}} data-testid="note-dictate-ai"><Mic className="mr-2 size-4"/>{noteBody.trim()?"Corregir con IA":"Dictar con IA"}</Button></div><Textarea aria-label="Registro clínico" value={noteBody} onChange={e=>setNoteBody(e.target.value)} placeholder="Motivo, hallazgos, procedimiento, indicaciones..." rows={5} lang="es-CL" spellCheck/><p className="text-xs leading-5 text-[#60757a]">Si dictas con el micrófono del teclado, pulsa «Corregir con IA»: la IA corrige lo mal oído, arma la nota por secciones y deja la transcripción original aparte. Revisa nombres, piezas y dosis antes de guardar.</p></div></>}{(modal==="budget"||modal==="editBudget")&&<><p className="text-sm text-[#71858b]">Paciente: <strong className="text-[#20343b]">{patient?.name}</strong></p>{alternativeParentBudgetId&&<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Esta opción se guarda como alternativa. No aceptará pagos hasta que la establezcas como plan principal.</p>}<Field label="Nombre del plan"><Input maxLength={180} value={budgetTitle} onChange={e=>setBudgetTitle(e.target.value)} placeholder="Plan de tratamiento"/></Field><BudgetItemsEditor items={budgetItems} onChange={setBudgetItems}/></>}{modal==="editAppointment"&&<><p className="text-sm text-[#71858b]">Paciente: <strong className="text-[#20343b]">{patient?.name}</strong></p><p className="text-sm">{appointments.find(a=>a.id===editingAppointmentId)?.day} · {appointments.find(a=>a.id===editingAppointmentId)?.time}</p><Field label="Motivo"><Input value={apptReason} onChange={e=>setApptReason(e.target.value)} maxLength={500}/></Field></>}{modal==="appointment"&&<><p className="text-sm text-[#71858b]">Paciente: <strong className="text-[#20343b]">{patient?.name}</strong></p><Field label="Fecha"><Input ref={apptDateRef} type="date" value={apptDate} onChange={e=>setApptDate(e.target.value)}/></Field><Field label="Hora"><Input ref={apptTimeRef} type="time" value={apptTime} onChange={e=>setApptTime(e.target.value)}/></Field><Field label="Motivo"><Input value={apptReason} onChange={e=>setApptReason(e.target.value)} placeholder="Control implantológico"/></Field></>}</div>{formError&&<p role="alert" className="px-1 text-sm font-medium text-[#a43542]">{formError}</p>}<DialogFooter><Button variant="outline" onClick={resetModal}>Cancelar</Button><Button className="bg-[#087f83] hover:bg-[#07676b]" onClick={save} disabled={saving}>{saving?"Guardando…":"Guardar"}</Button></DialogFooter></DialogContent></Dialog>
    <BudgetPaymentDialog open={paymentBudgetId!==null} budget={paymentTargetBudget} paid={paymentTargetPaid} onOpenChange={open=>{if(!open)setPaymentBudgetId(null)}} onSave={saveManualPayment}/>
    <BudgetPrintDialog open={printingBudgetId!==null} onOpenChange={open=>{if(!open)setPrintingBudgetId(null)}} budget={printingBudget} patientName={patient?.name??""}/>
  </div>;
}
