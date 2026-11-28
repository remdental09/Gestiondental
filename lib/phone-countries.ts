export type PhoneCountry = { code: string; name: string; dialCode: string };

/** Chile es la opción inicial para formularios y teléfonos de pacientes. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  { code: "CL", name: "Chile", dialCode: "+56" },
  { code: "US", name: "Estados Unidos", dialCode: "+1" },
  { code: "ES", name: "España", dialCode: "+34" },
  { code: "AR", name: "Argentina", dialCode: "+54" },
  { code: "BO", name: "Bolivia", dialCode: "+591" },
  { code: "BR", name: "Brasil", dialCode: "+55" },
  { code: "CO", name: "Colombia", dialCode: "+57" },
  { code: "CR", name: "Costa Rica", dialCode: "+506" },
  { code: "CU", name: "Cuba", dialCode: "+53" },
  { code: "DO", name: "República Dominicana", dialCode: "+1" },
  { code: "EC", name: "Ecuador", dialCode: "+593" },
  { code: "SV", name: "El Salvador", dialCode: "+503" },
  { code: "GT", name: "Guatemala", dialCode: "+502" },
  { code: "HT", name: "Haití", dialCode: "+509" },
  { code: "HN", name: "Honduras", dialCode: "+504" },
  { code: "MX", name: "México", dialCode: "+52" },
  { code: "NI", name: "Nicaragua", dialCode: "+505" },
  { code: "PA", name: "Panamá", dialCode: "+507" },
  { code: "PY", name: "Paraguay", dialCode: "+595" },
  { code: "PE", name: "Perú", dialCode: "+51" },
  { code: "PR", name: "Puerto Rico", dialCode: "+1" },
  { code: "UY", name: "Uruguay", dialCode: "+598" },
  { code: "VE", name: "Venezuela", dialCode: "+58" },
];

export const DEFAULT_PHONE_COUNTRY = PHONE_COUNTRIES[0];
const NANP_COUNTRY_BY_AREA_CODE: Record<string, string> = {
  "809": "DO", "829": "DO", "849": "DO", "787": "PR", "939": "PR",
};

export function splitPhoneNumber(value: string) {
  const raw = value.trim();
  const hasInternationalPrefix = raw.startsWith("+") || raw.startsWith("00");
  if (!hasInternationalPrefix) return { country: DEFAULT_PHONE_COUNTRY, nationalNumber: raw };

  let digits = raw.replace(/\D/g, "");
  if (raw.startsWith("00")) digits = digits.slice(2);
  const byLongestCode = [...PHONE_COUNTRIES].sort((a, b) => b.dialCode.length - a.dialCode.length);
  let country = byLongestCode.find(item => digits.startsWith(item.dialCode.slice(1))) ?? DEFAULT_PHONE_COUNTRY;
  if (country.dialCode === "+1") {
    const national = digits.slice(1);
    const region = PHONE_COUNTRIES.find(item => item.code === NANP_COUNTRY_BY_AREA_CODE[national.slice(0, 3)]);
    if (region) country = region;
  }
  return { country, nationalNumber: digits.startsWith(country.dialCode.slice(1)) ? digits.slice(country.dialCode.length - 1) : raw };
}

export function composePhoneNumber(countryCode: string, nationalNumber: string) {
  const country = PHONE_COUNTRIES.find(item => item.code === countryCode) ?? DEFAULT_PHONE_COUNTRY;
  const raw = nationalNumber.trim();
  if (!raw) return "";
  if (raw.startsWith("+") || raw.startsWith("00")) {
    const parsed = splitPhoneNumber(raw);
    if (parsed.nationalNumber !== raw) return `${parsed.country.dialCode}${parsed.nationalNumber.replace(/\D/g, "") ? ` ${parsed.nationalNumber.replace(/\D/g, "")}` : ""}`;
    return raw;
  }
  let digits = raw.replace(/\D/g, "");
  const dialDigits = country.dialCode.slice(1);
  // Permite pegar por error el número nacional junto con el prefijo; lo guardamos una sola vez.
  if (dialDigits && digits.startsWith(dialDigits) && digits.length >= dialDigits.length + 8) digits = digits.slice(dialDigits.length);
  return `${country.dialCode}${digits ? ` ${digits}` : ""}`;
}
