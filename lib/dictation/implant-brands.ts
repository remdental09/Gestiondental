/**
 * Marcas y empresas de implantes dentales para que el dictado las reconozca y no las "corrija".
 * Lista curada a mano desde informes de mercado, catálogos y estudios de uso de marcas (Straumann, Envista,
 * Dentsply Sirona, Osstem, ZimVie, Henry Schein, estudios de Brasil y Chile). NO es exhaustiva: se estiman más de 150
 * marcas en el mundo. Una marca que no esté aquí se conserva tal como se dictó; no se inventa ni se asocia a una empresa.
 * Para agregar una: sumar una fila [marca, empresa, país/región, alias opcionales].
 */
export type ImplantBrand = { brand: string; company: string; region: string; aliases?: string[] };

const ROWS: Array<[string, string, string, string[]?]> = [
  // Suiza, Alemania y resto de Europa
  ["Straumann", "Straumann Group", "Suiza", ["Straumann BLT", "Straumann BLX", "Straumann TLX", "Straumann Pure"]],
  ["Roxolid", "Straumann Group", "Suiza"],
  ["Neodent", "Straumann Group", "Brasil", ["Neodent Helix", "Neodent Drive", "Neodent Grand Morse"]],
  ["Anthogyr", "Straumann Group", "Francia", ["Axiom"]],
  ["Medentika", "Straumann Group", "Alemania"],
  ["Thommen Medical", "Thommen Medical", "Suiza", ["Thommen"]],
  ["SIC invent", "SIC invent", "Suiza", ["SIC"]],
  ["Z-Systems", "Z-Systems", "Suiza", ["Z Systems"]],
  ["Zeramex", "Dentalpoint", "Suiza"],
  ["Camlog", "Camlog Biotechnologies (Henry Schein)", "Alemania", ["Camlog Conelog", "Conelog"]],
  ["Ankylos", "Dentsply Sirona", "Alemania"],
  ["Astra Tech", "Dentsply Sirona", "Suecia", ["OsseoSpeed", "Astra Tech Implant System"]],
  ["Xive", "Dentsply Sirona", "Alemania"],
  ["BEGO Implant Systems", "BEGO", "Alemania", ["Bego", "Semados"]],
  ["Bredent medical", "Bredent", "Alemania", ["SKY", "Bredent"]],
  ["Champions-Implants", "Champions-Implants", "Alemania", ["Champions"]],
  ["Ritter Implants", "Ritter", "Alemania", ["Ritter"]],
  ["Nobel Biocare", "Envista", "Suecia", ["Nobel", "NobelActive", "NobelReplace", "NobelParallel", "Branemark", "Brånemark"]],
  ["Biotech Dental", "Biotech Dental", "Francia", ["Kontact"]],
  ["Euroteknika", "Euroteknika", "Francia"],
  ["Global D", "Global D", "Francia"],
  ["Tekka", "Tekka", "Francia"],
  ["Phibo", "Phibo Dental Solutions", "España", ["TSA", "Avantblast"]],
  ["BTI", "Biotechnology Institute", "España", ["BTI Core", "Biotechnology Institute"]],
  ["Klockner", "Klockner Implant System", "España", ["Klockner KL", "Klockner Vega", "Soadco"]],
  ["Mozo-Grau", "Mozo-Grau (Osstem)", "España", ["Mozograu", "Ticare", "Inhex"]],
  ["Microdent", "Microdent", "España"],
  ["Bioner", "Bioner", "España"],
  ["Galimplant", "Galimplant", "España"],
  ["Avinent", "Avinent", "España"],
  ["MIS", "MIS Implants Technologies", "Israel", ["MIS Seven", "MIS C1", "MIS V3"]],
  ["Alpha-Bio Tec", "Envista", "Israel", ["Alpha Bio", "Alpha-Bio"]],
  ["ADIN", "Adin Dental Implant Systems", "Israel", ["Adin Touareg"]],
  ["Paltop", "Paltop (Keystone Dental)", "Israel"],
  ["Noris Medical", "Noris Medical", "Israel", ["Noris"]],
  ["Sweden & Martina", "Sweden & Martina", "Italia", ["Sweden Martina"]],
  ["Geass", "Geass", "Italia"],
  ["Leader Italia", "Leader Italia", "Italia", ["Leader"]],
  ["Rhein83", "Rhein83", "Italia", ["Rhein 83"]],
  ["Lasak", "Lasak", "República Checa"],
  ["Southern Implants", "Southern Implants", "Sudáfrica"],
  // Estados Unidos
  ["Zimmer Biomet", "ZimVie / Zimmer Biomet Dental", "Estados Unidos", ["Zimmer", "Tapered Screw-Vent", "TSV", "Zimmer Dental", "ZimVie", "T3"]],
  ["Biomet 3i", "Zimmer Biomet", "Estados Unidos", ["3i", "Osseotite", "Certain"]],
  ["BioHorizons", "BioHorizons (Henry Schein)", "Estados Unidos", ["Bio Horizons", "Tapered Short"]],
  ["Implant Direct", "Envista", "Estados Unidos", ["Legacy", "Swish"]],
  ["Keystone Dental", "Keystone Dental Group", "Estados Unidos", ["PrimeTaper"]],
  ["Intra-Lock", "Intra-Lock (Henry Schein)", "Estados Unidos", ["Intralock"]],
  ["Bicon", "Bicon", "Estados Unidos"],
  ["Sterngold", "Sterngold Dental", "Estados Unidos"],
  ["Zest Dental Solutions", "Zest", "Estados Unidos", ["Zest", "LOCATOR"]],
  ["Glidewell", "Glidewell", "Estados Unidos", ["Hahn Tapered", "Hahn"]],
  ["Imtec", "Imtec (Dentsply Sirona)", "Estados Unidos", ["Imtec mini"]],
  ["Lifecore Biomedical", "Lifecore", "Estados Unidos", ["Lifecore", "RBT"]],
  ["Biolok", "Biolok International", "Estados Unidos"],
  ["ACE Surgical", "ACE Surgical Supply", "Estados Unidos", ["ACE"]],
  ["Dental Ventures of America", "Dental Ventures of America", "Estados Unidos", ["DVA"]],
  // Brasil
  ["Conexão", "Conexão Sistemas de Prótese", "Brasil", ["Conexao"]],
  ["SIN Implant System", "S.I.N. Sistema de Implante Nacional", "Brasil", ["SIN", "Sin Implante"]],
  ["Implacil De Bortoli", "Implacil De Bortoli", "Brasil", ["Implacil"]],
  ["Bionnovation", "Bionnovation Biomedical", "Brasil"],
  ["Arcsys", "FGM Produtos Odontológicos", "Brasil", ["FGM"]],
  ["Titanium Fix", "Titanium Fix", "Brasil"],
  ["Signo Vinces", "Signo Vinces", "Brasil"],
  ["Intra-Lock Brasil", "Intra-Lock", "Brasil"],
  ["Emfils", "Emfils", "Brasil"],
  ["Peclab", "Peclab", "Brasil"],
  // Corea del Sur, Japón y resto de Asia
  ["Osstem", "Osstem Implant", "Corea del Sur", ["Osstem TS", "TSIII", "TS III", "SS III", "Osstem SS"]],
  ["Dentium", "Dentium", "Corea del Sur", ["Implantium", "SuperLine", "Super Line"]],
  ["Hiossen", "Hiossen (Osstem)", "Corea del Sur", ["Hiossen ET", "ET III", "ET", "Implant Hiossen", "inCell"]],
  ["MegaGen", "MegaGen Implant", "Corea del Sur", ["Mega Gen", "AnyOne", "AnyRidge", "Any Ridge", "Any One"]],
  ["Neobiotech", "Neobiotech", "Corea del Sur", ["Neo Biotech", "IS II", "IS III"]],
  ["DIO", "DIO Implant", "Corea del Sur", ["Dio Implant", "UF II"]],
  ["Dentis", "Dentis", "Corea del Sur", ["Dentis SQ", "Dentis s-Clean"]],
  ["Warantec", "Warantec", "Corea del Sur"],
  ["Shinhung", "Shinhung", "Corea del Sur", ["Shin Hung"]],
  ["Cowellmedi", "Cowellmedi", "Corea del Sur", ["Cowell Medi"]],
  ["Biotem", "Biotem", "Corea del Sur"],
  ["Kyocera", "Kyocera Medical", "Japón", ["Bioceram"]],
  ["GC Implant", "GC Corporation", "Japón", ["GC"]],
  // Marcas dictadas por el profesional (empresa tal como se dijo; sin datos de origen verificados)
  ["Arxis", "FSM", "Dictada por el profesional", ["Arxis ET"]],
];

export const IMPLANT_BRANDS: ImplantBrand[] = ROWS.map(([brand, company, region, aliases]) => ({ brand, company, region, ...(aliases ? { aliases } : {}) }));

/** Marcas, alias y empresas, sin repetidos (para el diccionario del dictado). */
export const IMPLANT_BRAND_TERMS: string[] = [...new Set(IMPLANT_BRANDS.flatMap((item) => [item.brand, item.company.replace(/\s*\(.*?\)\s*/g, " ").trim(), ...(item.aliases ?? [])]))];

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Marca de implante nombrada en un texto (la primera de la lista que aparezca como palabra completa), o null. */
export function findImplantBrand(text: string): ImplantBrand | null {
  const plain = ` ${fold(text).replace(/[^a-z0-9&]+/g, " ")} `;
  let best: { item: ImplantBrand; length: number } | null = null;
  for (const item of IMPLANT_BRANDS) {
    for (const name of [item.brand, ...(item.aliases ?? [])]) {
      const key = ` ${fold(name).replace(/[^a-z0-9&]+/g, " ").trim()} `;
      if (key.trim().length >= 3 && plain.includes(key) && (!best || key.length > best.length)) best = { item, length: key.length };
    }
  }
  return best?.item ?? null;
}
