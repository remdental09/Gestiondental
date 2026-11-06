#!/usr/bin/env python3
"""Agrega al catálogo CIE-11 local los grupos maxilofaciales que faltaban, leyendo SOLO el archivo oficial
de la OMS (SimpleTabulation-ICD-11-MMS-es.txt, versión 2026-01). Código, título ES/EN, id y padre salen de ese archivo;
los sinónimos y «recordSeparately» son propuestas clínicas locales (no contenido OMS).

Uso:  python3 scripts/cie11-agregar-grupos.py RUTA/SimpleTabulation-ICD-11-MMS-es.txt [--dry]
Es idempotente: no vuelve a agregar un código que ya está en lib/icd11-catalog.ts.
"""
import csv, json, re, sys

SRC = sys.argv[1]
DRY = "--dry" in sys.argv
CATALOG = "lib/icd11-catalog.ts"
PREFIX = "http://id.who.int/icd/entity/"

rows, by_fid = [], {}
with open(SRC, encoding="utf-8-sig", newline="") as f:
    reader = csv.reader(f, delimiter="\t", quotechar='"')
    hdr = next(reader)
    for r in reader:
        r += [""] * (len(hdr) - len(r))
        d = dict(zip(hdr, r))
        d["fid"] = d["Foundation URI"].replace(PREFIX, "")
        d["es"] = re.sub(r"^(- )+", "", d["Title"]).strip()
        d["en"] = re.sub(r"^(- )+", "", d["TitleEN"]).strip()
        rows.append(d)
        if d["fid"]:
            by_fid[d["fid"]] = d
by_code = {d["Code"]: d for d in rows if d["Code"]}

G_NEO, G_FRAC, G_FIS = "Neoplasias bucales y maxilofaciales", "Fracturas y luxaciones maxilofaciales", "Fisuras y malformaciones craneofaciales"

# Familias (código + todos sus descendientes) o códigos sueltos que se incorporan.
FAMILIES = {
    G_NEO: ["2B60", "2B61", "2B62", "2B64", "2B65", "2B66", "2B67", "2B68", "2B6E", "2B51.0", "2B55.0", "2E60.0", "2E83.1", "2E90.0", "2E90.1", "2E90.2", "2E90.3", "2E91", "2F70.0"],
    G_FRAC: ["NA02.2", "NA02.3", "NA02.4", "NA02.5", "NA02.7", "NA02.8"],
    G_FIS: ["LA40", "LA41", "LA42", "LA4Y", "LA4Z", "LA51", "LA52", "LB71"],
}

# Fuera de alcance (no son de cavidad bucal ni maxilofaciales): amígdala lingual y faringe.
EXCLUDE_PREFIXES = ("2B62.1",)

REC = {
    G_NEO: ["localización anatómica (extensión CIE-11 de sitio)", "tamaño (mm)", "resultado de biopsia / informe histológico", "estadificación (TNM)"],
    G_FRAC: ["lado (derecho / izquierdo)", "abierta o cerrada", "desplazamiento", "hallazgo imagenológico", "piezas dentarias comprometidas"],
    G_FIS: ["lado (unilateral / bilateral)", "extensión (labio, alvéolo, paladar duro / blando)", "tratamiento previo"],
}
NOTES = {
    G_NEO: "Solo si el profesional lo dicta como diagnóstico; una sospecha o a descartar no se codifica. El diagnóstico histológico requiere informe de biopsia.",
    G_FRAC: "Registrar solo lo informado por el profesional; el lado, el desplazamiento y si es abierta o cerrada se anotan por separado.",
    G_FIS: "Anomalía del desarrollo. «Fisura labial» sin precisar mantiene su equivalencia previa con DA00.3; para la fisura congénita usar «labio leporino» o «fisura labial unilateral/bilateral».",
}

# Sinónimos propuestos (locales). Solo en hojas del catálogo; los genéricos van en el residual «sin especificación».
SYN = {
    "2B60.0": ["carcinoma basocelular de labio", "carcinoma basocelular del labio"],
    "2B60.1": ["carcinoma escamoso de labio", "carcinoma espinocelular de labio", "carcinoma epidermoide de labio"],
    "2B60.Z": ["cáncer de labio", "neoplasia maligna de labio"],
    "2B61.0": ["carcinoma escamoso de la base de lengua", "carcinoma epidermoide de la base de la lengua"],
    "2B62.0": ["carcinoma escamoso de lengua", "carcinoma espinocelular de lengua", "carcinoma epidermoide de lengua"],
    "2B62.Z": ["cáncer de lengua", "neoplasia maligna de lengua"],
    "2B64.0": ["carcinoma escamoso del piso de boca", "carcinoma epidermoide del piso de la boca"],
    "2B64.Z": ["cáncer de piso de boca", "cáncer del piso de la boca"],
    "2B65.0": ["adenocarcinoma de paladar"],
    "2B65.1": ["carcinoma escamoso de paladar", "carcinoma epidermoide de paladar"],
    "2B65.Z": ["cáncer de paladar"],
    "2B66.0": ["carcinoma escamoso de la boca", "carcinoma epidermoide de la boca", "carcinoma escamoso oral"],
    "2B66.Z": ["cáncer de boca", "cáncer oral", "cáncer de la cavidad bucal"],
    "2B67.0": ["adenocarcinoma de parótida"],
    "2B67.1": ["carcinoma escamoso de parótida"],
    "2B67.Z": ["cáncer de parótida"],
    "2E60.0": ["carcinoma in situ de labio", "carcinoma in situ de la cavidad bucal", "carcinoma in situ de cavidad oral"],
    "2E90.0": ["tumor benigno de labio"],
    "2E90.1": ["tumor benigno de lengua"],
    "2E90.2": ["tumor benigno del piso de boca"],
    "2E90.3": ["neoplasia benigna de la boca", "tumor benigno de la boca", "tumor benigno de la cavidad oral"],
    "2E91.0": ["tumor benigno de parótida"],
    "NA02.20": ["fractura del techo de la órbita"],
    "NA02.21": ["fractura del piso de la órbita", "fractura del suelo orbitario"],
    "NA02.2Z": ["fractura orbitaria", "fractura de órbita"],
    "NA02.3": ["fractura nasal", "fractura de nariz", "fractura de huesos propios de la nariz"],
    "NA02.40": ["fractura Le Fort I", "fractura Le Fort 1", "Le Fort I", "Le Fort 1"],
    "NA02.41": ["fractura Le Fort II", "fractura Le Fort 2", "Le Fort II", "Le Fort 2"],
    "NA02.42": ["fractura Le Fort III", "fractura Le Fort 3", "Le Fort III", "Le Fort 3"],
    "NA02.4Z": ["fractura maxilar", "fractura del maxilar superior", "fractura de maxilar superior"],
    "NA02.5": ["fractura cigomática", "fractura malar", "fractura del hueso malar"],
    "NA02.70": ["fractura condilar mandibular", "fractura de cóndilo mandibular", "fractura condílea", "fractura condilar"],
    "NA02.71": ["fractura subcondilar", "fractura subcondilar mandibular"],
    "NA02.72": ["fractura de apófisis coronoides", "fractura coronoides"],
    "NA02.73": ["fractura de rama mandibular", "fractura de la rama de la mandíbula"],
    "NA02.74": ["fractura de ángulo mandibular", "fractura del ángulo mandibular", "fractura angular mandibular"],
    "NA02.76": ["fractura de sínfisis mandibular", "fractura sinfisaria"],
    "NA02.7Z": ["fractura mandibular", "fractura de mandíbula", "fractura del maxilar inferior"],
    "NA02.8": ["fracturas faciales múltiples", "fracturas múltiples de huesos faciales"],
    "LA40.0": ["fisura labial unilateral", "labio leporino unilateral"],
    "LA40.1": ["fisura labial bilateral", "labio leporino bilateral"],
    "LA40.Z": ["labio leporino"],
    "LA41.0": ["fisura labioalveolar unilateral"],
    "LA41.1": ["fisura labioalveolar bilateral"],
    "LA41.Z": ["fisura labioalveolar"],
    "LA42.0": ["fisura de paladar duro", "paladar hendido duro"],
    "LA42.1": ["fisura de paladar blando", "paladar hendido blando", "fisura del velo palatino"],
    "LA42.2": ["úvula bífida", "fisura uvular"],
    "LA42.Z": ["fisura palatina", "paladar hendido"],
    "LA51": ["fisura facial"],
    "LA52": ["asimetría facial"],
}

def code_of(d):
    return d["Code"] or d["BlockId"]

def parent_code(d):
    p = by_fid.get(d["Parent"].replace(PREFIX, ""))
    return code_of(p) if p else None

def in_family(code, fam):
    return code == fam or code.startswith(fam + ".") or (fam[-1] in "YZ" and len(fam) == 4 and code == fam) or (re.fullmatch(r"[A-Z0-9]{4}", fam) and code.startswith(fam + ".")) or (len(fam) > 4 and code.startswith(fam))

existing = open(CATALOG, encoding="utf-8").read()
have = set(re.findall(r'"code": "([^"]+)"', existing))

entries, missing = [], []
for group, fams in FAMILIES.items():
    for fam in fams:
        found = [d for d in rows if d["ClassKind"] == "category" and d["Code"] and in_family(d["Code"], fam)]
        if not found:
            missing.append(fam)
        for d in found:
            if d["Code"].startswith(EXCLUDE_PREFIXES):
                continue
            if d["Code"] in have or any(e["code"] == d["Code"] for e in entries):
                continue
            res = d["IsResidual"] == "True"
            pf = d["Parent"].replace(PREFIX, "")
            suffix = "" if not res else ("/other" if d["Code"].endswith("Y") else "/unspecified")
            e = {
                "code": d["Code"], "title": d["es"], "titleEn": d["en"],
                "id": (d["fid"] if not res else pf + suffix),
                "group": group, "kind": "stem", "parent": parent_code(d),
                "isLeaf": d["isLeaf"] == "True", "isResidual": res,
                "synonyms": SYN.get(d["Code"], []),
                "recordSeparately": REC[group],
            }
            e["notes"] = "Categoría residual (otra especificada / no especificada)." if res else NOTES[group]
            entries.append(e)

if missing:
    sys.exit("Familias sin entradas en el archivo OMS: " + ", ".join(missing))
unknown_syn = [c for c in SYN if c not in {e["code"] for e in entries} and c not in have]
if unknown_syn:
    sys.exit("Sinónimos para códigos que no existen: " + ", ".join(unknown_syn))
patched = [c for c in SYN if c in have]

by_group = {}
for e in entries:
    by_group[e["group"]] = by_group.get(e["group"], 0) + 1
print("Nuevas entradas:", len(entries), by_group)
if DRY:
    sys.exit(0)

text = existing
for code in patched:
    pattern = re.compile(r'^  (\{"code": "' + re.escape(code) + r'",.*\}),$', re.M)
    m = pattern.search(text)
    entry = json.loads(m.group(1))
    entry["synonyms"] = list(dict.fromkeys(entry["synonyms"] + SYN[code]))
    text = text[:m.start()] + "  " + json.dumps(entry, ensure_ascii=False) + "," + text[m.end():]
if patched:
    print("Sinónimos agregados a entradas existentes:", ", ".join(patched))
existing = text
lines = ["  " + json.dumps(e, ensure_ascii=False) + "," for e in entries]
marker = "\n];\n\n/** Mismo formato que `ICD11`"
assert marker in existing, "No se encontró el cierre de ICD11_CATALOG"
open(CATALOG, "w", encoding="utf-8").write(existing.replace(marker, "\n" + "\n".join(lines) + marker, 1))
print("Catálogo actualizado.")
