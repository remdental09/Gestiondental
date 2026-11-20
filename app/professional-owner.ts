import type { ChatGPTUser } from "@/app/chatgpt-auth";
import type { OwnerSeed } from "@/app/professionals-db";

/** Datos del dueño para crear el primer profesional: su perfil (nombre, especialidad, RUT) o, si no lo llenó, su nombre de cuenta. */
export async function ownerSeedOf(user: ChatGPTUser): Promise<OwnerSeed> {
  try {
    const { personalIdOf } = await import("@/app/chatgpt-auth");
    const { loadProfile } = await import("@/app/clinician-profile-db");
    const profile = await loadProfile(personalIdOf(user));
    const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(" ").trim();
    if (name) return { name, specialty: profile?.specialty ?? "", rut: profile?.rut ?? "" };
  } catch { /* sin perfil */ }
  return { name: (user.fullName || user.displayName || "").split("@")[0].trim().slice(0, 80) || "Profesional" };
}
