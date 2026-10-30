"use client";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, CalendarDays, ChevronRight, ClipboardList, Download, Home as HomeIcon, FilePlus2, LayoutDashboard, Menu, Mic, MicOff, Pencil, Plus, Search, Stethoscope, Users, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DeferredClinicalVoiceAssistant as ClinicalVoiceAssistant } from "@/components/deferred-clinical-voice-assistant";
const Periodontogram = lazy(() => import("@/components/periodontogram").then(module => ({ default: module.Periodontogram })));
const Odontogram = lazy(() => import("@/components/odontogram").then(module => ({ default: module.Odontogram })));
const PatientImages = lazy(() => import("@/components/patient-images").then(module => ({ default: module.PatientImages })));
import { emptyOdontogram, formatFdi, summarizePerio, type ClinicalImage, type OdontogramData, type OdontogramSurface, type PerioExam, type SurfaceFinding } from "@/app/clinical-data";
import { installedImplantTeeth } from "@/app/implant-evidence";
import { cementedCrownFromEvolution } from "@/app/crown-evidence";
import { bestStoredNameMatches, hasFourNameParts, normalizePatientName } from "@/app/patient-identity";

type Patient = { id:number; name:string; birthDate:string; rut:string; phone:string; email:string; reason:string; status:string; allergies:string; history:string };
type Note = { id:number; patientId:number; date:string; title:string; body:string; backupStatus?:string; sourceDocumentId?:string|null; recordedAt?:string };
type Budget = { id:number; patientId:number; title:string; items:{label:string;amount:number}[]; status:string; date:string };
type Appointment = { id:number; patientId:number; day:string; time:string; reason:string };
type CalendarEvent = { id:number; title:string; startAt:string; endAt:string; sourceTimeZone:string; htmlLink:string|null; status:string; allDay:boolean; patientId:number|null };
type WeekDay = { key:string; label:string; date:number };
type Modal = "patient"|"editPatient"|"note"|"budget"|"editBudget"|"appointment"|"editAppointment"|null;
type PatientDraft = { name:string; birthDate:string; rut:string; phone:string; email:string; reason:string };
type PatientDraftValidation = { missingFields:string[]; invalidFields:string[]; valid:boolean };
type ClinicalLoadResponse = { error?:string; patients:Patient[]; notes:Note[]; budgets:Budget[]; appointments:Appointment[]; calendarEvents:CalendarEvent[]; calendarSnapshotAt?:string|null; periodontalExams:Record<number,PerioExam[]>; toothStatuses:Record<number,OdontogramData>; clinicalImages:ClinicalImage[] };
type ClinicalMutationResponse = { error?:string; odontogram:OdontogramData; exam:PerioExam; patient:Patient; note:Note; budget:Budget; appointment:Appointment; image:ClinicalImage; chart?:{odontogram?:OdontogramData;updatedTeeth?:number[];warning?:string} };
type ClinicalReview = { patientId:number; heading:string; details:string[]; body?:string };
type WebMcpRegistry = { registerTool(tool:{name:string;title?:string;description:string;inputSchema:object;execute:(input:unknown)=>unknown|Promise<unknown>},options?:{signal?:AbortSignal}):void|Promise<void> };
type SpeechResult = { isFinal:boolean; 0:{ transcript:string } };
type SpeechEvent = { resultIndex:number; results:ArrayLike<SpeechResult> };
type SpeechRecognizer = { lang:string; continuous:boolean; interimResults:boolean; onresult:((event:SpeechEvent)=>void)|null; onerror:((event:{error:string})=>void)|null; onend:(()=>void)|null; start:()=>void; stop:()=>void; abort:()=>void };
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
function BudgetCard({b,patientName,onEdit}:{b:Budget;patientName?:string;onEdit?:()=>void}){return <div className="rounded-xl border border-[#e4ebed] p-5 transition hover:border-[#9accca]"><div className="flex flex-wrap items-start justify-between gap-3"><div><strong>{b.title}</strong>{patientName&&<p className="mt-1 text-sm text-[#71858b]">{patientName}</p>}<p className="mt-1 text-xs text-[#8aa0a5]">{b.date} · {b.status}</p></div><div className="flex items-center gap-3"><span className="font-semibold text-[#087f83]">{money(b.items.reduce((sum,i)=>sum+i.amount,0))}</span>{onEdit&&<Button type="button" variant="outline" size="sm" onClick={onEdit}><Pencil className="mr-1 size-4"/>Editar</Button>}</div></div><div className="mt-4 border-t border-[#edf1f2] pt-3">{b.items.map((i,idx)=><p key={idx} className="flex justify-between gap-3 text-sm text-[#60757a]"><span>{i.label}</span><span>{money(i.amount)}</span></p>)}</div></div>}
function WeeklyAgendaMosaic({days,events}:{days:WeekDay[];events:CalendarEvent[]}) {
  const timedAppointments=events.filter(event=>event.status==="confirmed"&&!event.allDay);
  const time=(value:string)=>new Intl.DateTimeFormat("es-CL",{hour:"2-digit",minute:"2-digit",hourCycle:"h23",timeZone:"America/Santiago"}).format(new Date(value));
  return <div className="overflow-x-auto"><div className="grid min-w-[900px] grid-cols-7 gap-2">{days.map(day=><section key={day.key} className="min-h-36 rounded-xl border border-[#e1e9e9] bg-white"><header className="border-b border-[#e8eeee] px-2 py-3 text-center"><p className="text-xs font-semibold uppercase text-[#71858b]">{day.label}</p><p className="mt-1 text-lg font-semibold text-[#20343b]">{day.date}</p></header><div className="min-h-24 space-y-2 p-2">{timedAppointments.filter(event=>chileDate(new Date(event.startAt))===day.key).map(event=><article key={event.id} className="rounded-lg bg-[#d8f2ef] px-2 py-2 text-[#174c50]"><p className="break-words text-sm font-semibold leading-5">{event.title}</p><p className="mt-1 text-xs font-medium">{time(event.startAt)}–{time(event.endAt)}</p></article>)}</div></section>)}</div>{timedAppointments.length===0&&<p className="mt-3 text-center text-sm text-[#71858b]">No hay citas importadas para esta semana.</p>}</div>;
}
export default function Home(){
  const [patients,setPatients]=useState(initialPatients),[notes,setNotes]=useState(initialNotes),[budgets,setBudgets]=useState(initialBudgets),[appointments,setAppointments]=useState(initialAppointments),[calendarEvents,setCalendarEvents]=useState(initialCalendarEvents);
  const [calendarSnapshotAt,setCalendarSnapshotAt]=useState<string|null>(null);
  const [periodontalExams,setPeriodontalExams]=useState<Record<number,PerioExam[]>>({}),[clinicalImages,setClinicalImages]=useState<ClinicalImage[]>([]);  const todayChile=chileToday(), todayUtc=new Date(Date.UTC(todayChile.year,todayChile.month-1,todayChile.day)), weekday=todayUtc.getUTCDay(), weekStartUtc=new Date(todayUtc); weekStartUtc.setUTCDate(todayUtc.getUTCDate()+(weekday===0?1:1-weekday));
  const weekStart=weekStartUtc.toISOString().slice(0,10), weekEndUtc=new Date(weekStartUtc); weekEndUtc.setUTCDate(weekStartUtc.getUTCDate()+7); const weekEnd=weekEndUtc.toISOString().slice(0,10);
  const weekDays:WeekDay[]=Array.from({length:7},(_,offset)=>{const date=new Date(`${weekStart}T12:00:00.000Z`);date.setUTCDate(date.getUTCDate()+offset);return {key:date.toISOString().slice(0,10),label:new Intl.DateTimeFormat("es-CL",{weekday:"short",timeZone:"America/Santiago"}).format(date).replace(".",""),date:Number(new Intl.DateTimeFormat("en-US",{day:"numeric",timeZone:"America/Santiago"}).format(date))}});
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
        setPatients(data.patients);setNotes(data.notes);setBudgets(data.budgets);setAppointments(data.appointments);setCalendarEvents(data.calendarEvents||[]);setCalendarSnapshotAt(data.calendarSnapshotAt||null);
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
    return data;
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
  const [voiceAssistantOpen,setVoiceAssistantOpen]=useState(false),[voiceAssistantBusy,setVoiceAssistantBusy]=useState(false),[voiceToolsReady,setVoiceToolsReady]=useState(false);
  const [dictating,setDictating]=useState(false),[speechError,setSpeechError]=useState(""),[micPermission,setMicPermission]=useState<"idle"|"requesting"|"granted"|"blocked">("idle");
  const recognizerRef=useRef<SpeechRecognizer|null>(null),draftRef=useRef("");
  const stopDictation=useCallback(()=>{const recognizer=recognizerRef.current;recognizerRef.current=null;if(recognizer){recognizer.onresult=null;recognizer.onerror=null;recognizer.onend=null;recognizer.abort()}setDictating(false)},[]);
  useEffect(()=>()=>{recognizerRef.current?.abort()},[]);
  const requestMicrophone=async()=>{
    if(!navigator.mediaDevices?.getUserMedia){setMicPermission("blocked");setSpeechError("Este visor no permite solicitar el micrófono. Abre el sitio directamente en Safari o Chrome y prueba de nuevo.");return}
    setMicPermission("requesting");setSpeechError("");
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      stream.getTracks().forEach(track=>track.stop());
      setMicPermission("granted");
      setSpeechError("Micrófono autorizado. Pulsa Dictar para empezar. Si el dictado sigue bloqueado, abre el sitio directamente en Safari o Chrome.");
    }catch(error){
      setMicPermission("blocked");
      const name=error instanceof DOMException?error.name:"";
      setSpeechError(name==="NotAllowedError"||name==="PermissionDeniedError"?"El navegador o este visor denegó el micrófono. Abre el sitio directamente en Safari o Chrome y permite el acceso cuando lo solicite.":"No se pudo acceder al micrófono. Comprueba que esté conectado y que el navegador tenga permiso.");
    }
  };
  const startDictation=()=>{
    if(micPermission==="blocked"){void requestMicrophone();return}
    setSpeechError("");
    const browser=window as typeof window & { SpeechRecognition?:new()=>SpeechRecognizer; webkitSpeechRecognition?:new()=>SpeechRecognizer };
    const Recognition=browser.SpeechRecognition??browser.webkitSpeechRecognition;
    if(!Recognition){setSpeechError("Este navegador no ofrece dictado desde el botón. Selecciona el campo y usa el micrófono del teclado o el dictado de tu computador.");return}
    try{
      const recognizer=new Recognition();recognizerRef.current=recognizer;draftRef.current=noteBody;
      recognizer.lang="es-CL";recognizer.continuous=true;recognizer.interimResults=true;
      recognizer.onresult=(event)=>{let final="",interim="";for(let i=event.resultIndex;i<event.results.length;i++){const segment=event.results[i][0].transcript;if(event.results[i].isFinal)final+=segment;else interim+=segment}if(final){draftRef.current=[draftRef.current.trim(),final.trim()].filter(Boolean).join(" ")}setNoteBody([draftRef.current.trim(),interim.trim()].filter(Boolean).join(" "))};
      recognizer.onerror=(event)=>{if(event.error==="not-allowed"||event.error==="service-not-allowed"){setMicPermission("blocked");setSpeechError("El reconocimiento de voz fue bloqueado. Pulsa Permitir micrófono; si continúa, abre el sitio directamente en Safari o Chrome.")}else setSpeechError(event.error==="no-speech"?"No se detectó voz. Puedes intentar de nuevo.":"No se pudo continuar el dictado. Revisa el micrófono e intenta de nuevo.");setDictating(false)};
      recognizer.onend=()=>{if(recognizerRef.current===recognizer){recognizerRef.current=null;setDictating(false);setNoteBody(draftRef.current)}};
      recognizer.start();setDictating(true);
    }catch{recognizerRef.current=null;setDictating(false);setSpeechError("No se pudo iniciar el micrófono. Revisa los permisos del navegador.")}
  };
  const [budgetTitle,setBudgetTitle]=useState(""),[itemLabel,setItemLabel]=useState(""),[itemAmount,setItemAmount]=useState("");
  const [editingBudgetId,setEditingBudgetId]=useState<number|null>(null);
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
  const patientNotes=notes.filter(n=>n.patientId===selectedId),patientBudgets=budgets.filter(b=>b.patientId===selectedId);
  const nav=[{name:"Inicio",icon:HomeIcon},{name:"Resumen",icon:LayoutDashboard},{name:"Pacientes",icon:Users},{name:"Ficha clínica",icon:Stethoscope},{name:"Agenda",icon:CalendarDays},{name:"Presupuestos",icon:Wallet}];
  const goHome=()=>{setSection("Inicio");setNavigationHistory([]);setMobileNav(false)};
  const navigateTo=(destination:string,id=selectedId,tab=activeTab)=>{
    const next=destination==="Ficha clínica"&&!patients.some(item=>item.id===id)?"Pacientes":destination;
    if(section!==next||next==="Ficha clínica"&&(selectedId!==id||activeTab!==tab))setNavigationHistory(previous=>[...previous.slice(-19),{section,patientId:selectedId,tab:activeTab}]);
    setSelectedId(id);setActiveTab(tab);setSection(next);setMobileNav(false);
  };
  const openSection=(destination:string)=>destination==="Inicio"?goHome():navigateTo(destination);
  const openPatient=(id:number,tab="evoluciones")=>navigateTo("Ficha clínica",id,tab);
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
    {name:"Presupuestos",icon:Wallet,description:"Consultar planes y valores",detail:`${budgets.length} presupuestos`},
  ];
  const addImages=async(files:File[],kind:ClinicalImage["kind"],note:string)=>{
    for(const file of files){
      const data=new FormData();data.set("file",file);data.set("name",file.name);data.set("patientId",String(selectedId));data.set("kind",kind);data.set("note",note);
      const response=await fetch("/api/images",{method:"POST",body:data});
      const result=await response.json() as {error?:string;image:ClinicalImage};
      if(!response.ok)throw new Error(result.error||"No se pudo guardar la imagen.");
      setClinicalImages(previous=>[result.image,...previous]);
    }
  };
  const removeImage=async(id:number)=>{
    const response=await fetch("/api/images/"+id,{method:"DELETE"});
    const result=await response.json() as {error?:string};
    if(!response.ok)throw new Error(result.error||"No se pudo quitar la imagen.");
    setClinicalImages(previous=>previous.filter(item=>item.id!==id));
  };
  const updateTooth=async(tooth:number,status:string)=>{
    if(!await reviewChange({patientId:selectedId,heading:"Estado del odontograma",details:[`Pieza FDI ${formatFdi(tooth)}: ${toothStatuses[selectedId]?.teeth[tooth]||"Sin hallazgos"} → ${status}.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"setToothStatus",patientId:selectedId,tooth,status});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const updateCrownDetails=async(tooth:number,material:string,shade:string)=>{
    if(!await reviewChange({patientId:selectedId,heading:"Detalle de corona",details:[`Pieza FDI ${formatFdi(tooth)}: corona de ${material}${shade?`, color ${shade}`:""}.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"setCrownDetails",patientId:selectedId,tooth,material,shade});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const updateMissingReason=async(tooth:number,reason:"caries"|"other"|"unknown")=>{
    if(!await reviewChange({patientId:selectedId,heading:"Causa de ausencia",details:[`Pieza FDI ${formatFdi(tooth)}: ${reason==="caries"?"caries":reason==="other"?"otra causa":"causa sin registrar"}.`]}))throw new Error("Cambio cancelado; no se guardó.");
    const data=await persist({action:"setToothMissingReason",patientId:selectedId,tooth,reason});
    setToothStatuses(previous=>({...previous,[selectedId]:data.odontogram}));
  };
  const updateSurface=async(tooth:number,surface:OdontogramSurface,finding:SurfaceFinding)=>{
    if(!await reviewChange({patientId:selectedId,heading:"Hallazgo por superficie",details:[`Pieza FDI ${formatFdi(tooth)}, cara ${surface}: ${finding.condition}${finding.condition==="caries"?` · ICDAS ${finding.icdas} · actividad ${finding.activity}`:""}.`]}))throw new Error("Cambio cancelado; no se guardó.");
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
  const resetModal=useCallback(()=>{stopDictation();setSpeechError("");setFormError("");setModal(null);modalRef.current=null;setVoiceAssistantOpen(false);setVoiceAssistantBusy(false);setName("");setBirthDate("");setRut("");setPhone("");setEmail("");setReason("");setAllergies("");setHistory("");patientDraftRef.current={name:"",birthDate:"",rut:"",phone:"",email:"",reason:""};setPatientError("");setPatientAttemptedSave(false);setNoteTitle("");setNoteBody("");requestIdRef.current="";setBudgetTitle("");setItemLabel("");setItemAmount("");setEditingBudgetId(null);setEditingAppointmentId(null);setApptDate("");setApptTime("");setApptReason("")},[stopDictation]);
  const editPatient=()=>{if(!patient)return;setName(patient.name);setRut(patient.rut||"");setPhone(patient.phone||"");setEmail(patient.email||"");setAllergies(patient.allergies==="Sin registrar"?"":patient.allergies);setHistory(patient.history==="Sin registrar"?"":patient.history);setModal("editPatient")};
  const editBudget=(budget:Budget)=>{if(!patient||budget.patientId!==selectedId||budget.items.length!==1)return;setEditingBudgetId(budget.id);setBudgetTitle(budget.title);setItemLabel(budget.items[0].label);setItemAmount(String(budget.items[0].amount));setModal("editBudget")};
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
        const details=[...(implants.length?[`Posible actualización automática del odontograma: implante en FDI ${implants.map(formatFdi).join(", ")}.`]:[]),...(crown?[`Posible actualización automática: corona en FDI ${formatFdi(crown.tooth)}${crown.material?`, material ${crown.material}`:""}${crown.shade?`, color ${crown.shade}`:""}.`]:[])];
        if(!await reviewChange({patientId:selectedId,heading:noteTitle.trim()||"Evolución clínica",details,body}))return;
        requestIdRef.current ||= crypto.randomUUID();
        const data=await persist({action:"addNote",patientId:selectedId,title:noteTitle.trim(),body:noteBody.trim(),requestId:requestIdRef.current});
        setNotes(previous=>[data.note,...previous.filter(n=>n.id!==data.note.id)]);
        const savedOdontogram=data.chart?.odontogram;
        if(savedOdontogram)setToothStatuses(previous=>({...previous,[selectedId]:savedOdontogram}));
        setChartMessage(data.chart?.warning|| (data.chart?.updatedTeeth?.length?`Odontograma actualizado: FDI ${data.chart.updatedTeeth.map(formatFdi).join(", ")}.`:""));
      }
      if(modal==="budget"){
        const amount=Number(itemAmount);
        if(!budgetTitle.trim()||!itemLabel.trim()||!(amount>0))throw new Error("Completa el nombre del plan, la prestación y un valor mayor que cero.");
        const data=await persist({action:"addBudget",patientId:selectedId,title:budgetTitle.trim(),label:itemLabel.trim(),amount});
        setBudgets(previous=>[data.budget,...previous]);
      }
      if(modal==="editBudget"){
        const amount=Number(itemAmount);
        if(!editingBudgetId||!budgetTitle.trim()||!itemLabel.trim()||!(amount>0))throw new Error("Completa el nombre del plan, la prestación y un valor mayor que cero.");
        const data=await persist({action:"updateBudget",patientId:selectedId,budgetId:editingBudgetId,title:budgetTitle.trim(),label:itemLabel.trim(),amount});
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
          setModal("patient");setVoiceAssistantOpen(false);setVoiceAssistantBusy(false);setPatientAttemptedSave(true);
          const validation=validatePatientDraft(draft),message=patientValidationMessage(validation);
          setPatientError(message);
          return {prepared:true,readyToSave:validation.valid,missingFields:validation.missingFields,invalidFields:validation.invalidFields,nextQuestion:validation.missingFields[0]?"Pregunta por "+validation.missingFields[0].toLowerCase()+".":validation.invalidFields[0]?"Pide que confirme "+validation.invalidFields[0].toLowerCase()+".":null};
        }catch(error){return {prepared:false,error:error instanceof Error?error.message:"No pude leer los datos del borrador."}}
      }
    };
    const saveTool={
      name:"save_patient_intake",
      title:"Guardar ficha de paciente",
      description:"Guarda el borrador actual solo si el clínico confirmó verbalmente que desea guardarlo. Rechaza la operación si falta el nombre, la fecha de nacimiento o hay un dato inválido. Después de guardar correctamente, usa la aplicación Google Drive conectada para crear un Google Doc con esta ficha en la carpeta 'Fichas clínicas de prueba - Gestión Dental'. No confirmes el respaldo hasta que Drive confirme la creación. Si Drive no está disponible o falla, di que la ficha quedó guardada solo en la aplicación y deja el respaldo pendiente.",
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
          return {saved:true,patient:{id:saved.id,name:saved.name,birthDate:saved.birthDate,rut:saved.rut,reason:saved.reason,status:saved.status,history:saved.history,allergies:saved.allergies},driveBackupRequired:true,driveFolderName:"Fichas clínicas de prueba - Gestión Dental",driveTitle:"Ficha clínica de prueba - "+saved.name};
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
  const sidebarContent=<><div className="flex h-[76px] items-center gap-3 border-b border-white/10 px-6"><button type="button" onClick={goHome} className="flex size-10 items-center justify-center rounded-xl bg-[#3ca9a5] text-lg font-bold" aria-label="Ir a Inicio">LR</button><span className="leading-tight"><strong className="block text-sm">Gestión Dental</strong><small className="text-[#92b5b8]">Dr. Luis Rodríguez</small></span><button className="ml-auto lg:hidden" aria-label="Cerrar menú" onClick={()=>setMobileNav(false)}><X className="size-5"/></button></div><nav className="flex-1 space-y-1 px-3 py-7" aria-label="Principal">{nav.map(({name,icon:Icon})=><button key={name} type="button" aria-current={section===name?"page":undefined} onClick={()=>openSection(name)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-medium transition ${section===name?"bg-[#26606a] text-white":"text-[#a9c4c7] hover:bg-white/10 hover:text-white"}`}><Icon className="size-[19px]"/>{name}</button>)}</nav><div className="m-4 rounded-xl border border-white/10 bg-white/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#7dc6c3]">Proyecto activo</p><p className="mt-2 text-sm leading-5 text-[#c7dcdd]">Primera versión para evaluar el flujo de trabajo.</p></div></>;
  return <div className="min-h-screen bg-[#f4f7f8] text-[#20343b]">
    <div className="fixed inset-y-0 left-0 z-30 hidden w-[248px] flex-col bg-[#102e37] text-white lg:flex">{sidebarContent}</div>
    {mobileNav&&<div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={()=>setMobileNav(false)}><div className="flex h-full w-[260px] flex-col bg-[#102e37] text-white" onClick={e=>e.stopPropagation()}>{sidebarContent}</div></div>}
    <div className="lg:pl-[248px]">
      <header className="sticky top-0 z-20 border-b border-[#dce5e7] bg-white/95 backdrop-blur">
        <div className="flex h-[76px] items-center justify-between px-5 md:px-9">
          <div className="flex min-w-0 items-center gap-3">
            <button type="button" className="lg:hidden" aria-label="Abrir menú" onClick={()=>setMobileNav(true)}><Menu className="size-6"/></button>
            {section!=="Inicio"&&<button type="button" onClick={goBack} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[#145b60] hover:bg-[#e4f2f1]" aria-label="Volver a la sección anterior"><ArrowLeft className="size-4"/><span className="hidden sm:inline">Volver</span></button>}
            <button type="button" onClick={goHome} className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-medium text-[#145b60] hover:bg-[#e4f2f1]"><HomeIcon className="size-4"/><span className="hidden sm:inline">Inicio</span></button>
            <span className="min-w-0 truncate text-sm font-semibold text-[#20343b]">{section}</span>
          </div>
          <span className="hidden rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 sm:inline">Ficha privada</span>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-5 pb-3 lg:hidden md:px-9" aria-label="Ir a otra sección">
          {nav.map(({name,icon:Icon})=><button key={name} type="button" aria-current={section===name?"page":undefined} onClick={()=>openSection(name)} className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-sm font-medium ${section===name?"border-[#087f83] bg-[#e4f2f1] text-[#145b60]":"border-[#dce5e7] bg-white text-[#53686e]"}`}><Icon className="size-4"/>{name}</button>)}
        </nav>
      </header>
      <main className="mx-auto max-w-[1480px] px-5 pb-16 pt-8 md:px-9">{loading&&<p role="status" className="mb-4">Cargando fichas…</p>}{loadError&&<p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{loadError} <button type="button" className="underline" onClick={()=>location.reload()}>Reintentar</button></p>}{exportError&&<p role="alert" className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{exportError}</p>}<div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-[.16em] text-[#3c8585]">CLÍNICA · DR. LUIS RODRÍGUEZ</p><h1 className="text-3xl font-semibold tracking-tight md:text-[2.1rem]">{section}</h1><p className="mt-1 text-sm text-[#71858b]">{section==="Ficha clínica"?"Historia y planificación del paciente":section==="Inicio"?"Accede a cada área desde aquí":section==="Resumen"?"Vista general de la consulta":section==="Pacientes"?"Busca y abre una ficha":section==="Agenda"?"Próximas atenciones":"Planes de tratamiento y valores"}</p></div><div className="flex flex-wrap items-center gap-2">{section!=="Inicio"&&<Button className="bg-[#087f83] hover:bg-[#07676b]" onClick={()=>setModal(section==="Agenda"&&patient?"appointment":section==="Presupuestos"&&patient?"budget":section==="Pacientes"||!patient?"patient":"note")}><Plus className="mr-2 size-4"/>{section==="Agenda"?"Nueva cita":section==="Presupuestos"?"Nuevo presupuesto":section==="Pacientes"?"Nuevo paciente":"Nueva evolución"}</Button>}{section==="Pacientes"&&<><Button type="button" variant="outline" onClick={downloadClinicalRecords} disabled={exporting}><Download className="mr-2 size-4"/>{exporting?"Preparando…":"Descargar fichas"}</Button><a href="/importar" className="px-1 text-sm font-medium text-[#087f83] underline">Importar fichas desde Drive</a></>}</div></div>
        {section==="Inicio"&&<div className="space-y-8">
          <section aria-label="Entradas de la aplicación">
            <div className="mb-4"><h2 className="text-xl font-semibold">Elige una sección</h2><p className="mt-1 text-sm text-[#60757a]">Accede a cada área desde la portada y vuelve a Inicio cuando quieras.</p></div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {homeCards.map(({name,icon:Icon,description,detail})=><button key={name} type="button" onClick={()=>openSection(name)} className="group flex min-h-[175px] flex-col rounded-2xl border border-[#dce7e8] bg-white p-5 text-left shadow-sm transition hover:border-[#7bbdb9] hover:bg-[#f7fbfb] focus-visible:outline-2 focus-visible:outline-[#087f83]">
                <span className="flex size-11 items-center justify-center rounded-xl bg-[#dff2ef] text-[#087f83]"><Icon className="size-6"/></span>
                <span className="mt-4 flex w-full items-center justify-between gap-3 text-lg font-semibold text-[#20343b]">{name}<ChevronRight className="size-5 shrink-0 text-[#087f83] transition group-hover:translate-x-1"/></span>
                <span className="mt-1 text-sm text-[#60757a]">{description}</span>
                <span className="mt-3 text-xs font-medium text-[#087f83]">{detail}</span>
              </button>)}
            </div>
          </section>
          <section className="surface" aria-label="Agenda de la semana"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">Esta semana</h2><button type="button" onClick={()=>openSection("Agenda")} className="text-sm font-medium text-[#087f83] hover:underline">Ver agenda completa</button></div><WeeklyAgendaMosaic days={weekDays} events={weekCalendarEvents}/>{calendarSnapshotAt&&<p className="mt-2 text-xs text-[#71858b]">Última consulta del calendario: {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(calendarSnapshotAt))}.</p>}</section>
        </div>}
        {section==="Ficha clínica"&&patient&&<div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_310px]"><div className="space-y-6"><div className="surface"><div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-4"><span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#d7ebea] text-lg font-semibold text-[#145b60]">{initials(patient.name)}</span><div><h2 className="text-2xl font-semibold">{patient.name}</h2><p className="text-sm text-[#71858b]">{ageFromBirthDate(patient.birthDate)!==null?`${ageFromBirthDate(patient.birthDate)} años · `:""}{patient.reason}{patient.rut?` · ${patient.rut}`:""}</p></div></div><span className="rounded-full bg-[#e9f5f1] px-3 py-1 text-xs font-semibold text-[#2b7764]">{patient.status}</span></div><div className="mt-7 grid gap-4 border-t border-[#e9eef0] pt-5 sm:grid-cols-3"><Info label="Antecedentes" value={patient.history}/><Info label="Alergias" value={patient.allergies}/><Info label="Presupuestos" value={`${patientBudgets.length} registrados`}/></div><div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#e9eef0] pt-5"><div className="grid gap-4 sm:grid-cols-2"><Info label="Teléfono" value={patient.phone||"Sin registrar"}/><Info label="Correo electrónico" value={patient.email||"Sin registrar"}/></div><Button variant="outline" size="sm" onClick={editPatient}>Editar datos</Button></div>{selectedPerio.attention>0&&<button type="button" onClick={()=>setActiveTab("periodontograma")} className="mt-4 w-full rounded-xl border border-amber-200 bg-amber-50 p-3 text-left text-sm text-amber-950"><strong>Revisar periodontograma</strong><span className="mt-1 block">{selectedPerio.attention} {selectedPerio.attention===1?"sitio":"sitios"} con atención en el último examen · piezas FDI {selectedPerio.affected.map(formatFdi).join(", ")}.</span></button>}</div>
          <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4"><TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-[#dce5e7] pb-2"><TabsTrigger value="evoluciones">Evoluciones</TabsTrigger><TabsTrigger value="odontograma">Odontograma</TabsTrigger><TabsTrigger value="periodontograma">Periodontograma</TabsTrigger><TabsTrigger value="imagenes">Imágenes</TabsTrigger><TabsTrigger value="presupuestos">Presupuestos</TabsTrigger></TabsList>
            <TabsContent value="evoluciones"><div className="surface"><div className="flex items-center justify-between"><h3 className="font-semibold">Historia clínica</h3><Button variant="outline" size="sm" onClick={()=>setModal("note")}><FilePlus2 className="mr-2 size-4"/>Añadir registro</Button></div>{chartMessage&&<p role="status" className="mt-3 text-sm text-[#31575b]">{chartMessage}</p>}<div className="mt-6 space-y-6">{patientNotes.length?patientNotes.map(n=><div key={n.id} className="relative border-l-2 border-[#9bd6d0] pl-5"><span className="absolute -left-[6px] top-1.5 size-2.5 rounded-full bg-[#087f83]"/><p className="text-xs font-medium uppercase tracking-wide text-[#71858b]">{n.date}</p><h4 className="mt-1 font-semibold">{n.title}</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#53686e]">{n.body}</p>{installedImplantTeeth(n.body).some(tooth=>toothStatuses[selectedId]?.teeth[tooth]!=="Implante")&&<Button type="button" variant="outline" size="sm" className="mt-2" onClick={async()=>{try{const result=await persist({action:"syncEvolutionOdontogram",patientId:selectedId,evolutionId:n.id}),chart=result.chart;if(chart?.odontogram)setToothStatuses(previous=>({...previous,[selectedId]:chart.odontogram!}));setChartMessage(chart?.updatedTeeth?.length?`Odontograma actualizado: FDI ${chart.updatedTeeth.map(formatFdi).join(", ")}.`:"No hubo cambios; revisa el odontograma.")}catch(e){setChartMessage(e instanceof Error?e.message:"No se pudo actualizar el odontograma.")}}}>Actualizar odontograma desde esta evolución</Button>}{n.backupStatus==="not_configured"&&<p className="mt-1 text-xs text-amber-800">Guardado en la ficha · respaldo en Drive pendiente</p>}{n.sourceDocumentId&&<a className="mt-2 inline-block text-xs font-medium text-[#087f83] underline" href={`https://docs.google.com/document/d/${n.sourceDocumentId}/edit`} target="_blank" rel="noopener noreferrer">Ver documento original en Drive</a>}</div>):<Empty text="Todavía no hay evoluciones en esta ficha."/>}</div></div></TabsContent>
            <TabsContent value="odontograma"><Suspense fallback={<div className="min-h-[320px] rounded-xl bg-white p-5 text-sm text-[#71858b]" role="status">Cargando odontograma…</div>}><Odontogram key={selectedId} data={toothStatuses[selectedId]??emptyOdontogram()} onSetStatus={updateTooth} onSetMissingReason={updateMissingReason} onSetSurface={updateSurface} onSetCrownDetails={updateCrownDetails}/></Suspense></TabsContent>
            <TabsContent value="presupuestos"><div className="surface"><div className="flex justify-between gap-3"><h3 className="font-semibold">Presupuestos del paciente</h3><Button variant="outline" size="sm" onClick={()=>setModal("budget")}>Añadir</Button></div><div className="mt-5 space-y-3">{patientBudgets.length?patientBudgets.map(b=><BudgetCard key={b.id} b={b} onEdit={()=>editBudget(b)}/>):<Empty text="Aún no hay presupuestos para este paciente."/>}</div></div></TabsContent>
            <TabsContent value="periodontograma"><Suspense fallback={<div className="min-h-[320px] rounded-xl bg-white p-5 text-sm text-[#71858b]" role="status">Cargando periodontograma…</div>}><Periodontogram key={selectedId} exams={periodontalExams[selectedId]??[]} toothStatuses={toothStatuses[selectedId]?.teeth??{}} onSave={savePerio}/></Suspense></TabsContent>
            <TabsContent value="imagenes"><Suspense fallback={<div className="min-h-[220px] rounded-xl bg-white p-5 text-sm text-[#71858b]" role="status">Cargando imágenes…</div>}><PatientImages key={selectedId} images={patientImages} onAdd={addImages} onRemove={removeImage}/></Suspense></TabsContent>
          </Tabs></div><aside className="space-y-5"><div className="surface"><h3 className="font-semibold">Próximas citas</h3><div className="mt-5 space-y-4">{appointments.filter(a=>a.patientId===selectedId).length?appointments.filter(a=>a.patientId===selectedId).map(a=><div key={a.id} className="rounded-xl bg-[#f1f7f7] p-4"><p className="font-semibold text-[#087f83]">{a.day} · {a.time}</p><p className="mt-1 text-sm">{a.reason}</p><Button size="sm" variant="outline" className="mt-3" onClick={()=>editAppointment(a)}>Editar motivo</Button></div>):<Empty text="Sin citas agendadas."/>}</div><Button variant="outline" className="mt-5 w-full" onClick={()=>setModal("appointment")}>Agendar control</Button></div><div className="rounded-2xl bg-[#103c44] p-6 text-white"><Activity className="mb-4 size-6 text-[#7ed1ca]"/><h3 className="font-semibold">Secuencia clínica</h3><p className="mt-2 text-sm leading-6 text-[#bbd3d5]">Documenta evaluación, cirugía, componentes, rehabilitación y controles en orden cronológico.</p></div></aside></div>}
        {section==="Pacientes"&&<div className="surface"><div className="relative mb-5 max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8aa0a5]"/><Input aria-label="Buscar paciente por nombre o RUT" placeholder="Buscar por nombre o RUT" value={search} onChange={e=>setSearch(e.target.value)} className="pl-10"/></div><div className="space-y-2">{filteredPatients.map(p=><button key={p.id} onClick={()=>openPatient(p.id)} className="flex w-full items-center gap-4 rounded-xl border border-[#e8edef] p-4 text-left transition hover:border-[#8dc8c6] hover:bg-[#f7fbfb]"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#e4f2f1] text-sm font-bold text-[#187477]">{initials(p.name)}</span><span className="min-w-0 flex-1"><strong className="block truncate">{p.name}</strong><small className="text-sm text-[#71858b]">{p.reason}{p.birthDate?` · Nacimiento: ${p.birthDate}`:" · Nacimiento sin registrar"}{p.rut?` · RUT: ${p.rut}`:""}</small></span><ChevronRight className="size-5 text-[#8aa0a5]"/></button>)}{!filteredPatients.length&&<Empty text="No se encontraron pacientes."/>}</div></div>}
        {section==="Resumen"&&<div className="grid gap-5 md:grid-cols-3">{[["Pacientes en esta sesión",patients.length,Users],["Citas programadas",appointments.length,CalendarDays],["Presupuestos",budgets.length,ClipboardList]].map(([label,value,Icon])=><div key={String(label)} className="surface"><div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-[#e4f2f1] text-[#087f83]">{typeof Icon!=="number"&&typeof Icon!=="string"&&<Icon className="size-5"/>}</div><p className="text-3xl font-semibold">{String(value)}</p><p className="mt-1 text-sm text-[#71858b]">{String(label)}</p></div>)}<div className="surface md:col-span-3"><h3 className="font-semibold">Agenda semanal</h3><div className="mt-4"><WeeklyAgendaMosaic days={weekDays} events={weekCalendarEvents}/>{calendarSnapshotAt&&<p className="mt-2 text-xs text-[#71858b]">Citas consultadas en Google Calendar el {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(calendarSnapshotAt))}.</p>}</div></div><div className={`surface md:col-span-3 ${perioAlerts.length?"border-amber-200 bg-amber-50":""}`}><h3 className="font-semibold">Atención periodontal</h3>{perioAlerts.length?<div className="mt-3 space-y-2">{perioAlerts.map(({patient:p,summary,date})=><button key={p.id} type="button" onClick={()=>openPatient(p.id,"periodontograma")} className="flex w-full flex-wrap justify-between gap-2 rounded-lg border border-amber-200 bg-white p-3 text-left text-sm hover:border-amber-400"><span><strong>{p.name}</strong><span className="ml-2 text-[#714e13]">{summary.attention} {summary.attention===1?"sitio":"sitios"} · piezas FDI {summary.affected.map(formatFdi).join(", ")}</span></span><span className="text-[#60757a]">{date} · Ver examen</span></button>)}</div>:<p className="mt-2 text-sm text-[#60757a]">No hay sitios destacados en los periodontogramas registrados en esta sesión.</p>}<p className="mt-2 text-xs text-[#60757a]">Alertas de revisión clínica; no equivalen a un diagnóstico.</p></div><div className="surface md:col-span-3"><h3 className="font-semibold">Actividad reciente</h3><div className="mt-5 space-y-3">{notes.slice(0,4).map(n=><button key={n.id} onClick={()=>openPatient(n.patientId)} className="flex w-full justify-between gap-4 rounded-lg border-b border-[#ecf0f1] py-3 text-left hover:text-[#087f83]"><span><strong className="block font-medium">{n.title}</strong><span className="text-sm text-[#71858b]">{patients.find(p=>p.id===n.patientId)?.name}</span></span><span className="text-sm text-[#71858b]">{n.date}</span></button>)}</div></div></div>}
        {section==="Agenda"&&<div className="surface"><h3 className="font-semibold">Agenda semanal</h3><div className="mt-4"><WeeklyAgendaMosaic days={weekDays} events={weekCalendarEvents}/>{calendarSnapshotAt&&<p className="mt-2 text-xs text-[#71858b]">Citas consultadas en Google Calendar el {new Intl.DateTimeFormat("es-CL",{dateStyle:"short",timeStyle:"short",timeZone:"America/Santiago"}).format(new Date(calendarSnapshotAt))}.</p>}</div></div>}{section==="Presupuestos"&&<div className="surface"><h3 className="font-semibold">Planes de tratamiento</h3><div className="mt-5 space-y-3">{budgets.map(b=><button key={b.id} onClick={()=>openPatient(b.patientId)} className="w-full text-left"><BudgetCard b={b} patientName={patients.find(p=>p.id===b.patientId)?.name}/></button>)}</div></div>}
        <p className="mt-10 text-center text-xs text-[#82969a]">El botón Guardar conserva la ficha aquí. La copia en Drive se realiza en el flujo de voz de ChatGPT Work y requiere confirmación de Google Drive.</p>
      </main></div>
    <Dialog open={clinicalReview!==null} onOpenChange={open=>{if(!open)finishReview(false)}}><DialogContent className="max-h-[90vh] overflow-y-auto bg-white sm:max-w-xl"><DialogHeader><DialogTitle>Revisar antes de guardar</DialogTitle><DialogDescription>Confirma el paciente y los datos clínicos. Puedes volver a corregirlos sin guardar.</DialogDescription></DialogHeader><div className="space-y-3 text-sm"><p>Paciente: <strong>{patients.find(item=>item.id===clinicalReview?.patientId)?.name||"Paciente no identificado"}</strong></p><p className="font-semibold">{clinicalReview?.heading}</p>{clinicalReview?.body&&<div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg border p-3">{clinicalReview.body}</div>}{clinicalReview?.details.length?<ul className="list-inside list-disc space-y-1 rounded-lg bg-[#f2faf9] p-3">{clinicalReview.details.map((item,index)=><li key={index}>{item}</li>)}</ul>:<p className="rounded-lg bg-amber-50 p-3 text-amber-950">No se detectaron cambios automáticos en los diagramas. Comprueba si corresponde registrarlos manualmente.</p>}</div><DialogFooter><Button variant="outline" onClick={()=>finishReview(false)}>Volver y corregir</Button><Button className="bg-[#087f83] hover:bg-[#07676b]" onClick={()=>finishReview(true)}>Confirmar y guardar</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={modal!==null} onOpenChange={v=>{if(!v)resetModal()}}><DialogContent className="max-h-[90vh] overflow-y-auto border-[#dce5e7] bg-white sm:max-w-md"><DialogHeader><DialogTitle>{modal==="patient"?"Nuevo paciente":modal==="editPatient"?"Editar datos del paciente":modal==="note"?"Nueva evolución":modal==="budget"?"Nuevo presupuesto":modal==="editBudget"?"Editar presupuesto":modal==="editAppointment"?"Editar motivo de cita":"Nueva cita"}</DialogTitle><DialogDescription>Los cambios se guardan en la ficha clínica. La fecha de cada evolución se asigna automáticamente.</DialogDescription></DialogHeader><div className="space-y-4 py-2">{modal==="note"&&<><Button type="button" variant={voiceAssistantOpen?"default":"outline"} size="sm" className={voiceAssistantOpen?"bg-[#087f83] hover:bg-[#07676b]":""} onClick={()=>setVoiceAssistantOpen(value=>{if(value)setVoiceAssistantBusy(false);return !value})}><Mic className="mr-2 size-4"/>{voiceAssistantOpen?"Ocultar asistente de voz":"Asistente de voz"}</Button>{voiceAssistantOpen&&<ClinicalVoiceAssistant mode="note" onBusyChange={setVoiceAssistantBusy} onClose={()=>{setVoiceAssistantBusy(false);setVoiceAssistantOpen(false)}} onPatientAnswer={()=>{}} onNoteAnswers={setNoteBody}/>}</>}
        {modal==="patient"&&<div className="rounded-xl border border-[#cfe3e1] bg-[#f5faf9] p-3 text-sm"><p className="font-semibold text-[#145b60]">Dicta con ChatGPT Voice</p><p className="mt-1 leading-5 text-[#53686e]">Di “nuevo paciente” en ChatGPT Work y cuenta los datos como en una conversación. ChatGPT preparará esta ficha y te preguntará por el nombre o la fecha de nacimiento si faltan. La aplicación no necesita una API de voz.</p><p className="mt-1 text-xs leading-5 text-[#60757a]">{voiceToolsReady?"Las acciones de esta ficha están disponibles para ChatGPT en esta pestaña.":"Abre la aplicación dentro de un ChatGPT compatible para habilitar las acciones de voz."} Al confirmar el registro, la app lo guarda en la ficha; ChatGPT comprobará el respaldo en Drive antes de decir que quedó guardado allí.</p></div>}
        {modal==="patient"&&<><Field label="Dos nombres y dos apellidos *"><Input ref={nameRef} value={name} onChange={e=>{const value=e.target.value;setName(value);patientDraftRef.current={...patientDraftRef.current,name:value};setPatientError("")}} placeholder="Ej. Ana María Pérez Rojas" maxLength={180} aria-invalid={patientAttemptedSave&&!hasFourNameParts(name)} aria-describedby={patientAttemptedSave&&!hasFourNameParts(name)?"name-missing":undefined}/>{patientAttemptedSave&&!hasFourNameParts(name)&&<span id="name-missing" className="block text-xs font-medium text-[#a43542]">Registra los dos nombres y los dos apellidos, en ese orden.</span>}</Field><Field label="Fecha de nacimiento *"><Input ref={birthDateRef} type="date" value={birthDate} max={`${chileToday().year}-${String(chileToday().month).padStart(2,"0")}-${String(chileToday().day).padStart(2,"0")}`} onChange={e=>{const value=e.target.value;setBirthDate(value);patientDraftRef.current={...patientDraftRef.current,birthDate:value};setPatientError("")}} aria-invalid={patientAttemptedSave&&(!birthDate||ageFromBirthDate(birthDate)===null)} aria-describedby={patientAttemptedSave&&(!birthDate||ageFromBirthDate(birthDate)===null)?"birthdate-missing":undefined}/>{patientAttemptedSave&&(!birthDate||ageFromBirthDate(birthDate)===null)&&<span id="birthdate-missing" className="block text-xs font-medium text-[#a43542]">{birthDate?"Revisa la fecha de nacimiento.":"Falta la fecha de nacimiento."}</span>}</Field>{birthDate&&<p className="text-sm text-[#60757a]">{ageFromBirthDate(birthDate)===null?"Fecha no válida":`Edad calculada: ${ageFromBirthDate(birthDate)} años`}</p>}<Field label="RUN / RUT chileno"><Input ref={rutRef} inputMode="text" autoCapitalize="characters" value={rut} maxLength={14} onChange={e=>{const value=e.target.value;setRut(value);patientDraftRef.current={...patientDraftRef.current,rut:value};setPatientError("")}} onBlur={()=>{if(validRut(rut)){const value=formatRut(rut);setRut(value);patientDraftRef.current={...patientDraftRef.current,rut:value}}}} placeholder="12.345.678-5" aria-invalid={Boolean(rut)&&!validRut(rut)}/></Field>{rut&&!validRut(rut)&&<p className="text-sm text-[#a43542]">RUT o dígito verificador no válido.</p>}<Field label="Teléfono"><Input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e=>{setPhone(e.target.value);patientDraftRef.current={...patientDraftRef.current,phone:e.target.value}}} placeholder="+56 9 6696 3089" aria-invalid={Boolean(phone)&&!validPhone(phone)}/></Field><Field label="Correo electrónico"><Input type="email" inputMode="email" autoComplete="email" value={email} onChange={e=>{setEmail(e.target.value);patientDraftRef.current={...patientDraftRef.current,email:e.target.value}}} placeholder="paciente@ejemplo.cl" aria-invalid={Boolean(email)&&!validEmail(email)}/></Field><Field label="Motivo de consulta"><Input value={reason} onChange={e=>{const value=e.target.value;setReason(value);patientDraftRef.current={...patientDraftRef.current,reason:value}}} placeholder="Evaluación implantológica"/></Field>{patientAttemptedSave&&!patientValidation.valid&&<div role="alert" className="rounded-lg border border-[#e4a0a7] bg-[#fff5f5] p-3 text-sm text-[#922f3a]"><p className="font-semibold">Revisa la ficha antes de guardar:</p><div className="mt-2 flex flex-wrap gap-2">{patientValidation.missingFields.map(field=><button type="button" key={field} className="rounded-full border border-[#d88d96] bg-white px-3 py-1.5 text-left font-semibold underline decoration-dotted underline-offset-2" onClick={()=>field.toLowerCase().includes("nombre")?nameRef.current?.focus():birthDateRef.current?.focus()}>Falta {field.toLowerCase()} · completar</button>)}{patientValidation.invalidFields.map(field=><button type="button" key={field} className="rounded-full border border-[#d88d96] bg-white px-3 py-1.5 text-left font-semibold underline decoration-dotted underline-offset-2" onClick={()=>field==="RUN / RUT"?rutRef.current?.focus():birthDateRef.current?.focus()}>Revisar {field.toLowerCase()}</button>)}</div></div>}{patientError&&patientValidation.valid&&<p role="alert" className="text-sm font-medium text-[#a43542]">{patientError}</p>}</>}{modal==="editPatient"&&<><Field label="Nombre del paciente *"><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre y apellido" maxLength={180} aria-invalid={!validExistingPatientName(name,patient?.name||"")}/><span className="block text-xs text-[#71858b]">En fichas existentes, conserva el nombre registrado o cámbialo con datos confirmados. Los cuatro componentes se solicitan al crear pacientes nuevos.</span></Field><Field label="RUN / RUT chileno"><Input inputMode="text" autoCapitalize="characters" value={rut} maxLength={14} onChange={e=>setRut(e.target.value)} onBlur={()=>{if(rut&&validRut(rut))setRut(formatRut(rut))}} placeholder="12.345.678-5" aria-invalid={Boolean(rut)&&!validRut(rut)}/></Field><Field label="Teléfono"><Input type="tel" inputMode="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+56 9 6696 3089" aria-invalid={Boolean(phone)&&!validPhone(phone)}/></Field><Field label="Correo electrónico"><Input type="email" inputMode="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="paciente@ejemplo.cl" aria-invalid={Boolean(email)&&!validEmail(email)}/></Field><Field label="Alergias"><Input value={allergies} onChange={e=>setAllergies(e.target.value)} placeholder="Sin registrar"/></Field><Field label="Antecedentes"><Textarea value={history} onChange={e=>setHistory(e.target.value)} placeholder="Sin registrar" rows={3}/></Field></>}{modal==="note"&&<><p className="text-sm text-[#71858b]">Paciente: <strong className="text-[#20343b]">{patient?.name}</strong></p><Field label="Título"><Input value={noteTitle} onChange={e=>setNoteTitle(e.target.value)} placeholder="Evolución clínica (opcional)"/></Field><div className="space-y-2"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Registro clínico</span><Button type="button" variant={dictating?"default":"outline"} size="sm" className={dictating?"bg-[#087f83] hover:bg-[#07676b]":""} onClick={dictating?stopDictation:startDictation} aria-pressed={dictating} disabled={micPermission==="requesting"}>{dictating?<MicOff className="mr-2 size-4"/>:<Mic className="mr-2 size-4"/>}{dictating?"Detener dictado":micPermission==="blocked"?"Permitir micrófono":"Dictar"}</Button></div><Textarea aria-label="Registro clínico" readOnly={voiceAssistantBusy} value={noteBody} onChange={e=>{if(dictating)stopDictation();setNoteBody(e.target.value)}} placeholder="Motivo, hallazgos, procedimiento, indicaciones..." rows={5} lang="es-CL" spellCheck/><p className="text-xs leading-5 text-[#60757a]">También puedes usar el micrófono del teclado. Revisa nombres, piezas y dosis antes de guardar.{voiceAssistantBusy?" Edita el texto cuando el asistente se detenga.":""}</p>{dictating&&<p role="status" className="text-sm font-medium text-[#087f83]">Escuchando… habla en español y pulsa Detener al terminar.</p>}{speechError&&<p role="alert" className="text-sm text-[#a43542]">{speechError}</p>}</div></>}{(modal==="budget"||modal==="editBudget")&&<><p className="text-sm text-[#71858b]">Paciente: <strong className="text-[#20343b]">{patient?.name}</strong></p><Field label="Nombre del plan"><Input value={budgetTitle} onChange={e=>setBudgetTitle(e.target.value)} placeholder="Implante unitario"/></Field><Field label="Prestación o etapa"><Input maxLength={180} value={itemLabel} onChange={e=>setItemLabel(e.target.value)} placeholder="Etapa quirúrgica"/></Field><Field label="Valor en CLP"><Input type="number" min="1" value={itemAmount} onChange={e=>setItemAmount(e.target.value)} placeholder="790000"/></Field><p className="text-xs text-[#71858b]">Este primer prototipo registra una prestación por presupuesto.</p></>}{modal==="editAppointment"&&<><p className="text-sm text-[#71858b]">Paciente: <strong className="text-[#20343b]">{patient?.name}</strong></p><p className="text-sm">{appointments.find(a=>a.id===editingAppointmentId)?.day} · {appointments.find(a=>a.id===editingAppointmentId)?.time}</p><Field label="Motivo"><Input value={apptReason} onChange={e=>setApptReason(e.target.value)} maxLength={500}/></Field></>}{modal==="appointment"&&<><p className="text-sm text-[#71858b]">Paciente: <strong className="text-[#20343b]">{patient?.name}</strong></p><Field label="Fecha"><Input ref={apptDateRef} type="date" value={apptDate} onChange={e=>setApptDate(e.target.value)}/></Field><Field label="Hora"><Input ref={apptTimeRef} type="time" value={apptTime} onChange={e=>setApptTime(e.target.value)}/></Field><Field label="Motivo"><Input value={apptReason} onChange={e=>setApptReason(e.target.value)} placeholder="Control implantológico"/></Field></>}</div>{formError&&<p role="alert" className="px-1 text-sm font-medium text-[#a43542]">{formError}</p>}<DialogFooter><Button variant="outline" onClick={resetModal}>Cancelar</Button><Button className="bg-[#087f83] hover:bg-[#07676b]" onClick={save} disabled={saving}>{saving?"Guardando…":"Guardar"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
