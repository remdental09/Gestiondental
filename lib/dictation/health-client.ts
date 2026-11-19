export type DictationHealthStage = "diagnosis" | "plan" | "proposal" | "save" | "flow";

export type DictationHealthEvent =
  | "flow_started" | "flow_completed" | "flow_abandoned"
  | "audio_started" | "audio_error"
  | "transcription_succeeded" | "transcription_error"
  | "redraft_started" | "redraft_succeeded" | "redraft_error" | "numeric_mismatch"
  | "tts_started" | "tts_succeeded" | "tts_error"
  | "voice_command" | "voice_unrecognized" | "answer_confirmed"
  | "proposal_review_started" | "proposal_review_succeeded" | "proposal_review_error" | "proposal_ready"
  | "save_started" | "save_succeeded" | "save_error";

export type DictationHealthErrorCode =
  | "none" | "permission_denied" | "unsupported" | "audio_empty" | "timeout"
  | "transcription_failed" | "provider_failed" | "numeric_mismatch"
  | "invalid_response" | "save_failed" | "network_error" | "other";

type DictationHealthPlatform =
  | "ios_safari" | "ios_other" | "android_chrome" | "android_other"
  | "desktop_chrome" | "desktop_safari" | "desktop_firefox" | "desktop_edge" | "desktop_other" | "unknown";

const EVENT_SET = new Set<DictationHealthEvent>([
  "flow_started", "flow_completed", "flow_abandoned", "audio_started", "audio_error",
  "transcription_succeeded", "transcription_error", "redraft_started", "redraft_succeeded",
  "redraft_error", "numeric_mismatch", "tts_started", "tts_succeeded", "tts_error",
  "voice_command", "voice_unrecognized", "answer_confirmed", "proposal_review_started",
  "proposal_review_succeeded", "proposal_review_error", "proposal_ready", "save_started",
  "save_succeeded", "save_error",
]);

const ERROR_SET = new Set<DictationHealthErrorCode>([
  "none", "permission_denied", "unsupported", "audio_empty", "timeout", "transcription_failed",
  "provider_failed", "numeric_mismatch", "invalid_response", "save_failed", "network_error", "other",
]);

function platform(): DictationHealthPlatform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua)) return /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua) ? "ios_safari" : "ios_other";
  if (/Android/i.test(ua)) return /Chrome|CriOS/i.test(ua) ? "android_chrome" : "android_other";
  if (/Edg\//i.test(ua)) return "desktop_edge";
  if (/Firefox\//i.test(ua)) return "desktop_firefox";
  if (/Chrome\//i.test(ua) || /Chromium/i.test(ua)) return "desktop_chrome";
  if (/Safari\//i.test(ua)) return "desktop_safari";
  return "desktop_other";
}

/** Sends only coarse technical events; payloads intentionally have no patient or dictated text fields. */
export function recordDictationHealthEvent(
  event: DictationHealthEvent,
  stage: DictationHealthStage,
  options: { errorCode?: DictationHealthErrorCode; durationMs?: number } = {},
) {
  if (typeof window === "undefined" || !EVENT_SET.has(event)) return;
  const errorCode = options.errorCode && ERROR_SET.has(options.errorCode) ? options.errorCode : undefined;
  const durationMs = Number.isFinite(options.durationMs) ? Math.max(0, Math.min(600_000, Math.round(options.durationMs!))) : undefined;
  const payload = { event, stage, platform: platform(), ...(errorCode ? { errorCode } : {}), ...(durationMs === undefined ? {} : { durationMs }) };
  const body = JSON.stringify(payload);
  try {
    if (typeof navigator.sendBeacon === "function") {
      const sent = navigator.sendBeacon("/api/dictation/telemetry", new Blob([body], { type: "application/json" }));
      if (sent) return;
    }
    void fetch("/api/dictation/telemetry", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {});
  } catch {
    // Monitoring never blocks or changes the clinical dictation flow.
  }
}

/** Maps platform/browser errors to fixed categories; the original message is never sent. */
export function dictationHealthErrorCode(message: string, context: "audio" | "transcription" | "redraft" | "tts" | "save"): DictationHealthErrorCode {
  const value = message.toLocaleLowerCase("es-CL");
  if (/permission|permiso|autoriza|micr[oó]fono bloqueado|not-allowed/i.test(value)) return "permission_denied";
  if (/not supported|no est[aá] disponible|no puede|no soporta|no es compatible/i.test(value)) return "unsupported";
  if (/timeout|timed out|tiempo de espera|demor[oó] demasiado/i.test(value)) return "timeout";
  if (context === "audio") return "other";
  if (context === "transcription") return /vac[ií]a|no alcanc[eé]|no se recibi[oó]/i.test(value) ? "audio_empty" : "transcription_failed";
  if (context === "redraft" || context === "tts") return /modelo|proveedor|openai|servicio/i.test(value) ? "provider_failed" : "network_error";
  if (context === "save") return "save_failed";
  return "other";
}
