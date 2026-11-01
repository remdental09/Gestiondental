# Catálogo de diagnósticos bucales CIE-11 — Gestión Dental (borrador verificado)

- **Release:** CIE-11 MMS **2026-01** (sello del archivo: 2026 Jan 17 - 05:30 UTC)
- **Fecha de verificación:** 2026-11-01
- **Entradas:** 345 (266 códigos troncales + 79 códigos de extensión), todas `verified: true`.

## Fuentes
| Fuente | URL | sha256 |
|---|---|---|
| Tabulación simplificada (inglés) | https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-en.zip | f1356588f40953a83e3af2b662deab47c5e269f944d1ea4ed0cfeb2007c7cd39 |
| Tabulación simplificada (español) | https://icdcdn.who.int/static/releasefiles/2026-01/SimpleTabulation-ICD-11-MMS-es.zip | 7c7e5a02706aefd6ff2c95675ad4d33e3f2b2a518a1cabc8bf9f10c07b33113f |
| Navegador OMS | https://icd.who.int/browse/2026-01/mms/es (latest-release redirige aquí) | — |

Código, título ES/EN, URI lineal, URI de fundación y padre salen **solo** de esos archivos (se cruzó EN↔ES por URI). Ningún código fue escrito a mano.
**Sinónimos (`synonyms_es`) y `record_separately` son PROPUESTAS clínicas para Chile, no contenido OMS.** Las inclusiones/índice de la OMS no se leyeron (requieren API con token).

## Archivos
- `catalogo-cie11.json` — `{meta, entries[]}`. Campos por entrada: code, title_es, title_en, uri, foundation_uri, browser_url, parent, parent_title_es, group, kind (stem/extension), chapter, is_leaf, is_residual, fdi (solo extensiones de pieza), synonyms_es, synonyms_status, record_separately, notes, verified, release.
- `catalogo-cie11.csv` — misma información (listas separadas por " | ").
- `catalogo_icd11.ts` — borrador compatible con `Icd11Entry` de lib/icd11.ts (`ICD11`, `ICD11_CATALOG`, `ICD11_TOOTH_BY_FDI`). Typecheck OK con tsc --strict.
- `fuente_release.txt`, `build.py`, `load.py` — para regenerar (`python3 build.py` con los zip en /workspace/catalogo-cie11/raw).

## Cobertura por grupo
| Grupo | Entradas | Hojas no residuales | Con sinónimos propuestos |
|---|---|---|---|
| Labios | 7 | 4 | 2 |
| Mucosa oral | 49 | 28 | 18 |
| Lengua | 9 | 6 | 4 |
| Glándulas salivales | 12 | 9 | 4 |
| Quistes orales | 5 | 2 | 2 |
| Maxilares | 9 | 6 | 5 |
| Desarrollo y erupción dentaria | 32 | 20 | 15 |
| Tejidos duros dentarios (caries, desgaste, fractura no traumática) | 14 | 10 | 9 |
| Pulpa y tejidos periapicales | 21 | 12 | 14 |
| Otros trastornos dentarios y de soporte (pérdida dentaria, restos radiculares) | 7 | 4 | 4 |
| Gingival | 22 | 14 | 14 |
| Periodontal | 13 | 7 | 8 |
| Dentofaciales, oclusión y ATM | 23 | 14 | 12 |
| Sensibilidad orofacial | 6 | 1 | 1 |
| Traumatismo dentario | 29 | 17 | 14 |
| Síntomas y factores (cap. 21/24) | 8 | 8 | 6 |
| Códigos de extensión (sitio dentario, superficie, pieza) | 79 | 72 | 0 |

## Reglas de uso
- Codificar siempre la hoja más específica (`is_leaf`). Las categorías padre (p. ej. DA09.6, DA09.7) tienen subcódigos; para "no especificado" usar el residual …Z.
- Pieza FDI, superficies, profundidad, estadio/grado, lado, etc. van en campos aparte (`record_separately`). Si se quiere poscoordinar en CIE-11: `DA08.0&XA6FX3` (caries en dentina), `&XA0TL3` (pieza 16), `&XA5DM8` (oclusal).
- Conceptos clínicos sin código específico verificado: ver `meta.unmapped_concepts` (gingivitis por placa, periodontitis 2017 estadio/grado, dentina superficial vs profunda, superficie palatina, HIM, maloclusión II/1 y III).
