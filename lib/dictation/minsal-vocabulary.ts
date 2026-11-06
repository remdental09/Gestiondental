/**
 * Vocabulario clínico extraído de las guías de salud bucal del MINSAL (términos y variantes;
 * no se copian definiciones ni recomendaciones). Fuentes consultadas:
 * - Urgencia odontológica ambulatoria (2011) y GES 46.
 * - Salud oral integral del adulto de 60 años (2010) y caries radiculares (2015).
 * - Salud oral integral de la embarazada (2013).
 * - Salud oral integral de niños y niñas de 6 años (GES 23).
 * - Patología pulpar y periapical en dentición permanente (GPC No GES, 2019).
 * - Salud oral en adolescentes: enfermedad periodontal (2017).
 *   https://diprece.minsal.cl/programas-de-salud/salud-bucal/informacion-al-profesional-salud-bucal/guias-clinicas/
 *
 * Sirve para que el reconocimiento y la redacción conserven la palabra que dicta el profesional.
 * No agrega tratamientos ni diagnósticos: la conducta clínica siempre viene del odontólogo.
 * Las siglas (GUN, TDA, ADAA…) se conservan tal como se dictan.
 */
export const MINSAL_VOCABULARY = {
  urgencia_e_infecciones: [
    "pericoronaritis aguda", "capuchón pericoronario", "desbridamiento del capuchón pericoronario",
    "pulpitis irreversible sintomática", "pulpitis irreversible asintomática", "pulpa no vital", "diente vital",
    "diente previamente tratado", "diente con terapia previamente iniciada", "infección odontogénica",
    "absceso dentoalveolar agudo", "absceso subperióstico", "absceso submucoso", "absceso de espacios fasciales",
    "celulitis", "flegmón", "osteoflegmón", "adenoflegmón", "osteomielitis", "osteítis condensante",
    "granuloma apical", "granuloma periapical", "absceso periapical con fístula", "absceso periapical sin fístula",
    "periodontitis apical aguda", "gangrena pulpar", "gingivitis úlcero necrótica", "gingivitis necrosante",
    "enfermedad periodontal necrosante", "periodontitis necrosante", "estomatitis necrosante",
    "gingivoestomatitis herpética primaria", "absceso periodontal", "complicaciones post exodoncia",
    "alveolitis seca", "alveolitis húmeda", "hemorragia post exodoncia", "comunicación orosinusal",
    "comunicación oronasal", "dolor post obturación", "dolor postoperatorio",
    "espacio pterigomandibular", "espacio submandibular", "espacio maseterino", "espacio láterofaríngeo",
    "trismus", "disfagia", "tumefacción", "fístula", "exudado purulento", "linfadenopatía", "edema facial",
    "asimetría facial",
  ],
  traumatismo_dentoalveolar: [
    "traumatismo dentoalveolar", "luxación intrusiva", "luxación extrusiva", "luxación lateral", "subluxación",
    "avulsión", "diente avulsionado", "fractura coronaria complicada", "fractura coronaria no complicada",
    "fractura radicular", "fractura alveolar", "fractura de la restauración", "férula flexible", "reimplante",
  ],
  signos_y_pruebas: [
    "dolor espontáneo", "dolor irradiado", "dolor referido", "dolor pulsátil", "dolor lancinante",
    "dolor a la percusión", "dolor a la palpación", "dolor a la masticación", "dolor en decúbito",
    "sensibilidad a la percusión", "movilidad dentaria", "prueba de sensibilidad térmica",
    "prueba de sensibilidad eléctrica", "prueba de vitalidad", "percusión vertical", "percusión horizontal",
    "palpación apical", "examen extraoral", "examen intraoral", "anamnesis", "examen clínico",
    "radiografía retroalveolar", "radiografía bitewing", "radiografía periapical", "radiografía panorámica",
    "radiografía oclusal", "tomografía computarizada", "transiluminación por fibra óptica",
    "ligamento periodontal ensanchado", "línea periodontal apical",
  ],
  endodoncia_guia_minsal: [
    "pulpitis reversible", "pulpotomía parcial", "pulpotomía total", "biopulpectomía", "trepanación de urgencia",
    "acceso cavitario de urgencia", "cavidad de acceso", "acceso endodóntico", "recubrimiento pulpar directo",
    "recubrimiento pulpar indirecto", "protección pulpodentinaria", "remoción selectiva de caries",
    "remoción total de caries", "eliminación parcial de caries", "mota estéril", "pasta temporal",
    "recambio de pasta", "sellado inmediato", "sellado de la perforación", "perforación", "material biocerámico",
    "hidróxido de calcio", "MTA", "formocresol", "sulfato férrico", "aislamiento absoluto", "dique de goma",
    "grapa", "arco de Young", "diente permanente joven", "diente permanente inmaduro", "discromía",
    "tratamiento de conducto", "tratamiento del conducto radicular", "pulpa cameral", "pulpa radicular",
  ],
  caries_y_prevencion: [
    "caries limitada al esmalte", "caries incipiente", "caries de la dentina", "caries detenida",
    "caries radicular", "caries de cemento", "caries de cuello", "caries secundaria", "caries cavitada",
    "lesión no cavitada", "lesión activa", "lesión detenida", "mancha blanca", "desmineralización",
    "remineralización", "terapia remineralizadora", "odontología mínimamente invasiva", "inactivación de la lesión",
    "barniz de flúor", "aplicación profesional de flúor", "gel de fluoruro de sodio", "enjuagatorio fluorado",
    "pasta dental fluorada", "flúor fosfato acidulado", "fluoruro de estaño", "xilitol", "sellante",
    "aplicación de sellantes", "sellado con vidrio ionómero", "hipoplasia del esmalte", "hipersensibilidad dentinaria",
    "erosión dentaria", "abrasión dental", "atrición", "abfracción", "perimolisis", "trizadura",
    "índice CPOD", "índice ceod", "índice de higiene oral simplificado", "índice de placa de Silness y Löe",
    "índice gingival", "evaluación de riesgo de caries", "CAMBRA", "Cariogram",
  ],
  periodoncia_guia_minsal: [
    "gingivitis marginal simple", "gingivitis hiperplásica", "gingivitis inducida por biofilm",
    "periodontitis crónica", "periodontitis agresiva", "periodontitis como manifestación de enfermedad sistémica",
    "peri-implantitis", "compromiso de furca", "lesión de furca", "defecto óseo angular", "defecto óseo vertical",
    "bolsa periodontal", "saco periodontal", "recesión gingival", "exposición radicular", "pérdida de inserción clínica",
    "examen periodontal básico", "examen periodontal completo", "sondaje de boca completa", "sonda periodontal",
    "sonda de la OMS", "profundidad al sondaje", "sangrado al sondaje", "terapia periodontal no quirúrgica",
    "raspado y alisado radicular", "alisado radicular", "terapia de desinfección bucal total",
    "terapia periodontal de soporte", "terapia por cuadrantes", "terapia por sextantes", "profilaxis dental",
    "copa de profilaxis", "pulido coronario", "pulido radicular", "control de placa", "higiene interdental",
    "cepillo interdental", "seda dental", "colutorio de clorhexidina", "clorhexidina al 0,12%",
    "cálculo supragingival", "cálculo subgingival", "tinciones", "biofilm", "placa bacteriana",
  ],
  adulto_mayor_y_protesis: [
    "desdentado parcial", "desdentado total", "desdentado en riesgo", "prótesis parcial removible",
    "prótesis total", "prótesis removible", "prótesis fija", "prótesis implantosoportada",
    "sobredentadura implantosoportada", "estomatitis subprotésica", "higiene de prótesis",
    "pérdida de dimensión vertical", "reabsorción ósea", "reborde alveolar", "clasificación de Kennedy",
    "corona clínica", "erupción pasiva", "oclusión", "ajuste oclusal", "trastorno temporomandibular",
    "disfunción temporomandibular", "xerostomía", "hiposalivación", "flujo salival", "saliva artificial",
    "candidiasis", "queilitis angular", "leucoplasia", "eritroleucoplasia", "displasia", "síndrome de boca urente",
    "liquen plano", "penfigoide", "mucositis oral", "examen funcional del adulto mayor",
  ],
  materiales_y_farmacos: [
    "cemento de vidrio ionómero", "vidrio ionómero", "resina compuesta", "composite", "amalgama", "amalgama adhesiva",
    "grabado ácido", "biselado del esmalte", "gelatina reabsorbible", "hemostático local", "algodón", "gasa",
    "suero fisiológico", "agua oxigenada", "lidocaína al 2%", "epinefrina 1:100.000", "anestesia local con vasoconstrictor",
    "anestesia local sin vasoconstrictor", "bloqueo del nervio dentario inferior", "nervio mentoniano", "nervio lingual",
    "nervio infraorbitario", "amoxicilina", "amoxicilina con ácido clavulánico", "metronidazol", "clindamicina",
    "azitromicina", "claritromicina", "cefalosporina", "penicilina", "eritromicina", "ibuprofeno", "ketoprofeno",
    "meloxicam", "paracetamol", "acetaminofeno", "nistatina", "miconazol", "clotrimazol", "fluconazol",
    "incisión y drenaje", "curetaje", "sutura", "retiro de sutura", "exodoncia", "exodoncia del antagonista",
  ],
  gestion_ges_y_aps: [
    "GES", "atención primaria de salud", "APS", "nivel primario", "nivel secundario", "interconsulta", "derivación",
    "contrarreferencia", "garantía de oportunidad", "alta odontológica integral", "alta odontológica educativa",
    "alta odontológica preventiva", "urgencia odontológica ambulatoria", "salud oral integral", "salud oral de los 6 años",
    "salud oral de la embarazada", "salud oral del adulto de 60 años", "prestación trazadora", "canasta de prestaciones",
    "cierre de caso", "término de tratamiento", "diagnóstico y tratamiento preventivo", "refuerzo educativo",
    "terapia de desinfección total", "dentición mixta", "primeros molares definitivos", "exfoliación natural",
  ],
} as const;
