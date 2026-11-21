// Plantillas de consentimiento informado por especialidad. Son BORRADORES para revisión clínica: el profesional las adapta
// al caso (el documento sigue siendo totalmente editable antes de emitirse) y las explica al paciente antes de la firma.
// Los riesgos se describen de forma cualitativa; no se inventan porcentajes ni cifras.

export type ConsentTemplate = {
  id: string;
  specialty: string;
  procedure: string;
  descripcion: string;
  riesgos: string;
  alternativas: string;
  declaracion: string;
};

const DECLARACION_BASE = "El profesional me explicó el procedimiento, sus riesgos y las alternativas con palabras que pude entender. Tuve la oportunidad de hacer preguntas y fueron respondidas. Informé al profesional mis antecedentes de salud, alergias y medicamentos con veracidad. Entiendo que este consentimiento es voluntario, que puedo retirarlo antes de que el procedimiento comience, y que negarme no afecta el resto de mi atención.";
const DECLARACION_MENOR = "El profesional explicó el procedimiento, sus riesgos y las alternativas a la persona que firma, con palabras que pudo entender. Quien firma declara ser el padre, la madre o el representante legal del paciente menor de edad o sin capacidad de decidir por sí mismo, y que tuvo la oportunidad de hacer preguntas, que fueron respondidas. Se informaron los antecedentes de salud, alergias y medicamentos del paciente con veracidad. El consentimiento es voluntario y puede retirarse antes de que el procedimiento comience, sin afectar el resto de la atención.";
const ANESTESIA = "Anestesia local: puede causar adormecimiento prolongado de labio, lengua o mejilla, mordedura accidental de los tejidos adormecidos, hematoma en el punto de inyección y, rara vez, reacción alérgica o alteración prolongada de la sensibilidad.";

export const CONSENT_TEMPLATES: ConsentTemplate[] = [
  {
    id: "operatoria-obturacion", specialty: "Operatoria y restauradora", procedure: "Obturación (restauración directa con resina u otro material)",
    descripcion: "Retiro del tejido dental dañado por caries o fractura y reconstrucción de la pieza con un material restaurador (resina compuesta, vidrio ionómero u otro, según el caso). Puede requerir anestesia local. No incluye tratamientos de conducto ni coronas, salvo que se indiquen aparte.",
    riesgos: `${ANESTESIA}\nSensibilidad al frío, calor o masticación durante días o semanas tras la restauración. Si la caries es profunda, puede comprometerse el nervio de la pieza y requerirse un tratamiento de conductos. Posibilidad de fractura, desalojo o filtración de la restauración con el tiempo, y de caries recurrente si la higiene no es adecuada. Pequeños ajustes de mordida pueden ser necesarios.`,
    alternativas: "Restauración indirecta (incrustación, onlay o corona), observación y control si la lesión es incipiente, o extracción de la pieza. No tratar puede permitir que la caries avance, con dolor, infección y pérdida de la pieza.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "operatoria-estetica", specialty: "Operatoria y restauradora", procedure: "Blanqueamiento dental",
    descripcion: "Aclaramiento del color de los dientes con agentes blanqueadores, en consulta o con férulas de uso en casa, según lo indicado. No modifica restauraciones, coronas ni carillas existentes, por lo que puede quedar diferencia de color con ellas.",
    riesgos: "Sensibilidad dental transitoria y molestias o irritación en la encía. El resultado varía entre personas y no es permanente: el color puede retornar con el tiempo, según hábitos como café, té, vino o tabaco. No se puede garantizar un tono específico. Si existen caries, grietas o recesión de encía, pueden aumentar las molestias y deben tratarse antes.",
    alternativas: "Profilaxis y pulido para remover manchas superficiales, microabrasión, carillas o coronas, o no realizar tratamiento.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "endodoncia-conductos", specialty: "Endodoncia", procedure: "Tratamiento de conductos (endodoncia)",
    descripcion: "Remoción del tejido pulpar inflamado, infectado o necrótico, limpieza, desinfección y relleno del sistema de conductos de la pieza, habitualmente en una o más sesiones, con anestesia local y aislamiento con goma. Luego la pieza requiere una restauración definitiva (obturación o corona) que no está incluida salvo que se indique; su costo es independiente y debe realizarse lo antes posible. Ante dolor intenso, hinchazón o dudas entre sesiones, el paciente debe contactar a la clínica.",
    riesgos: `${ANESTESIA}\nDolor o inflamación posoperatoria transitoria. Conductos calcificados, curvos o con anatomía compleja pueden impedir su limpieza completa. Fractura de un instrumento dentro del conducto, perforación de la raíz o de la cámara, extrusión de material más allá del ápice y, rara vez, alteración de la sensibilidad. Una pieza tratada es más frágil y puede fracturarse. El tratamiento puede fracasar y requerir retratamiento, cirugía apical o extracción. El éxito no puede garantizarse. Pueden presentarse reacciones inesperadas a la anestesia, y cambio de color de la pieza que podría requerir un tratamiento estético. Puede requerirse cirugía oral adicional, con costos y riesgos propios.`,
    alternativas: "Extracción de la pieza, con o sin reposición posterior (implante, puente o prótesis), o no tratar. Dejar una infección sin tratar puede causar dolor, absceso, diseminación de la infección y pérdida del hueso que rodea la raíz.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "endodoncia-retratamiento", specialty: "Endodoncia", procedure: "Retratamiento de conductos",
    descripcion: "Remoción del material de relleno de una endodoncia previa, nueva limpieza y desinfección de los conductos y un nuevo relleno, con anestesia local y aislamiento. Puede requerir retirar total o parcialmente la corona, el perno o la restauración actual, lo que puede dañarlos y obligar a rehacerlos.",
    riesgos: `${ANESTESIA}\nLos mismos riesgos de una endodoncia: dolor o inflamación transitoria, fractura de instrumento, perforación y fractura de la raíz. Es más complejo que el primer tratamiento y su tasa de éxito puede ser menor. Si hay perno o corona, retirarlos puede fracturar la raíz y llevar a la extracción. Puede requerirse cirugía apical posterior.`,
    alternativas: "Cirugía apical (apicectomía), extracción con reposición posterior, o control sin tratamiento. No tratar puede permitir que la infección persista o avance.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "cirugia-exodoncia", specialty: "Cirugía oral", procedure: "Extracción dental (exodoncia)",
    descripcion: "Extracción de una o más piezas dentales con anestesia local, con o sin sutura. Tras la extracción se entregan indicaciones de cuidado, y puede indicarse medicación. Se explicará si la pieza requiere reposición posterior.",
    riesgos: `${ANESTESIA}\nDolor, inflamación y hematoma durante los primeros días. Sangrado, que suele controlarse con medidas locales. Alveolitis (dolor intenso por pérdida o falta del coágulo), infección, fractura de la raíz o de la pieza y, a veces, necesidad de una cirugía más amplia. Posible lesión de dientes vecinos o de sus restauraciones. En piezas superiores, comunicación con el seno maxilar; en piezas inferiores, cercanía a nervios, con posible alteración temporal o, rara vez, permanente de la sensibilidad del labio, el mentón o la lengua. Reabsorción del hueso de la zona con el tiempo.`,
    alternativas: "Tratamiento de conductos y restauración, si la pieza es recuperable, o control sin tratamiento. No extraer una pieza con infección o fractura irreparable puede producir dolor, absceso y daño al hueso y a piezas vecinas.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "cirugia-tercer-molar", specialty: "Cirugía oral", procedure: "Cirugía de tercer molar (muela del juicio) incluido o retenido",
    descripcion: "Extracción quirúrgica de uno o más terceros molares que pueden estar incluidos o parcialmente erupcionados, con anestesia local (o la que se acuerde), incisión en la encía, eventual remoción de hueso o división de la pieza, y sutura. Se indican medicación y cuidados posoperatorios.",
    riesgos: `${ANESTESIA}\nDolor, inflamación facial, hematoma y limitación para abrir la boca durante varios días. Sangrado, infección y alveolitis. Lesión de los nervios dentario inferior o lingual, con alteración temporal o, rara vez, permanente de la sensibilidad del labio, el mentón o la lengua. En el maxilar superior, comunicación con el seno maxilar. Fractura de la pieza, de la raíz o, raramente, de la mandíbula. Daño a dientes vecinos. Enfermedades previas, alergias, trastornos de la coagulación o medicación habitual pueden aumentar la frecuencia o gravedad de las complicaciones y deben informarse. Durante la cirugía pueden surgir hallazgos imprevistos que obliguen a modificar la técnica; el material extraído podría enviarse a estudio (biopsia). El tiempo de recuperación varía y puede requerirse reposo.`,
    alternativas: "Control periódico con radiografías si la pieza no presenta patología, o tratamiento de la complicación (por ejemplo, de la inflamación recurrente de la encía) sin extraer. Dejar piezas con patología puede originar infección, quistes, caries y daño en la pieza vecina. No se recomienda operar si la pieza erupciona bien y funciona, si no hay evidencia de patología asociada o si el riesgo quirúrgico es alto.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "cirugia-apical", specialty: "Cirugía oral", procedure: "Cirugía apical (apicectomía)",
    descripcion: "Acceso quirúrgico al extremo de la raíz de una pieza con infección persistente, remoción de la lesión y del extremo de la raíz, sellado del conducto desde el extremo y sutura. Se realiza con anestesia local.",
    riesgos: `${ANESTESIA}\nDolor, inflamación y hematoma posoperatorio. Infección, sangrado y cicatrización incompleta con persistencia de la lesión. Retracción de la encía, que puede dejar visible el margen de una corona. Cercanía a nervios y al seno maxilar, con posible alteración de la sensibilidad o comunicación sinusal. La pieza puede igualmente requerir extracción posterior. El éxito no puede garantizarse.`,
    alternativas: "Retratamiento de conductos, extracción de la pieza con reposición posterior, o control sin tratamiento.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "implantologia-implante", specialty: "Implantología", procedure: "Colocación de implante dental",
    descripcion: "Colocación quirúrgica de uno o más implantes de titanio (u otro material) en el hueso maxilar o mandibular, con anestesia local (o la que se acuerde). Tras un período de cicatrización (osteointegración), cuya duración se explicará, se confecciona la prótesis sobre el implante. Puede combinarse con injerto óseo o regeneración si el hueso es insuficiente.",
    riesgos: `${ANESTESIA}\nDolor, inflamación, hematoma y sangrado posoperatorio. Infección. Falta de integración del implante con el hueso, con necesidad de retirarlo y, eventualmente, reponerlo. Lesión de nervios (alteración temporal o, rara vez, permanente de la sensibilidad) o perforación del seno maxilar. Exposición del implante o de la membrana del injerto. A largo plazo, inflamación de los tejidos que lo rodean (periimplantitis) y pérdida de hueso, que se relacionan con higiene, tabaco, diabetes y controles. Fracturas o aflojamiento de componentes protésicos. El resultado estético y funcional no puede garantizarse.`,
    alternativas: "Prótesis fija sobre dientes vecinos (puente), prótesis removible, o no reponer la pieza. Existen distintos materiales y técnicas, que el profesional explicará.",
    declaracion: `${DECLARACION_BASE} Me comprometo a mantener la higiene y los controles indicados. Declaro haber informado mis enfermedades (por ejemplo diabetes, osteoporosis, alteraciones de la coagulación), medicamentos (por ejemplo bifosfonatos, anticoagulantes), radioterapia previa y hábitos (por ejemplo tabaco, alcohol) que puedan influir en el resultado.`,
  },
  {
    id: "implantologia-injerto", specialty: "Implantología", procedure: "Injerto óseo / regeneración ósea o elevación de seno maxilar",
    descripcion: "Aumento del volumen de hueso o de encía en un sitio donde se colocará un implante, usando hueso propio, de banco, de origen animal o sintético y, si corresponde, una membrana. Puede hacerse en el mismo acto del implante o antes. El material se explicará al paciente.",
    riesgos: `${ANESTESIA}\nDolor, inflamación y hematoma. Infección y pérdida parcial o total del injerto, con necesidad de repetir el procedimiento. Exposición de la membrana o del material. En el seno maxilar, perforación de la membrana o sinusitis. Alteración temporal o, rara vez, permanente de la sensibilidad. Si se usa material de origen animal o de banco, existe el riesgo teórico de reacción al material.`,
    alternativas: "Implantes más cortos o inclinados, prótesis sobre dientes u otra, o no realizar el procedimiento.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "periodoncia-raspado", specialty: "Periodoncia", procedure: "Raspado y alisado radicular",
    descripcion: "Limpieza profunda de las raíces de los dientes bajo la encía, para remover sarro y placa bacteriana, habitualmente por sectores y en varias sesiones, con anestesia local. Es parte del tratamiento de la enfermedad periodontal y requiere control y mantención periódicos.",
    riesgos: `${ANESTESIA}\nSensibilidad dental, molestias y sangrado de encías durante los días siguientes. Retracción de la encía al desinflamarse, que deja más visible la raíz y los espacios entre dientes. Aumento de la movilidad dental temporal. El resultado depende de la higiene diaria y de los controles; la enfermedad puede reactivarse. Algunas piezas con pérdida avanzada de soporte pueden no ser recuperables.`,
    alternativas: "Cirugía periodontal, uso de antimicrobianos como complemento, extracción de piezas sin pronóstico, o no tratar. No tratar la enfermedad periodontal puede causar pérdida progresiva del hueso y de las piezas.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "periodoncia-cirugia", specialty: "Periodoncia", procedure: "Cirugía periodontal (colgajo, injerto de encía o alargamiento de corona)",
    descripcion: "Procedimiento quirúrgico sobre la encía y el hueso que los rodea, para acceder a las raíces, corregir defectos, aumentar la encía o exponer más estructura de la pieza, según el caso. Se realiza con anestesia local y se sutura. Se entregan indicaciones de higiene y cuidados.",
    riesgos: `${ANESTESIA}\nDolor, inflamación, hematoma y sangrado. Infección o cicatrización incompleta. Retracción de la encía, mayor sensibilidad y exposición de raíces. En injertos, pérdida parcial o total del injerto y la zona donde se tomó puede doler y cicatrizar más lento. Aumento de movilidad temporal. Resultado estético variable, que no puede garantizarse. Dependiente de higiene, tabaco y controles.`,
    alternativas: "Tratamiento no quirúrgico, extracción de piezas sin pronóstico, o no realizar el procedimiento.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "rehabilitacion-corona", specialty: "Rehabilitación oral y prótesis", procedure: "Corona o puente fijo",
    descripcion: "Tallado de una o más piezas para cubrirlas con una corona, o para sostener un puente que reponga piezas ausentes. Incluye provisorio, toma de impresiones, prueba y cementado definitivo. El material (metal-cerámica, zirconio, cerámica u otro) se acordará con el paciente. Puede requerir anestesia local.",
    riesgos: `${ANESTESIA}\nEl tallado elimina tejido dental sano de forma irreversible. Sensibilidad durante días o semanas, o compromiso del nervio de la pieza con necesidad de tratamiento de conductos, incluso tiempo después. Caída o fractura del provisorio. Fractura, descementado o desajuste de la corona o del puente. Caries en el margen de la pieza tallada. Retracción de la encía con exposición del margen. Diferencia de color con piezas vecinas. Pueden requerirse ajustes de mordida.`,
    alternativas: "Restauración directa o incrustación, implante, prótesis removible, o no tratar. Los materiales distintos tienen ventajas y limitaciones que el profesional explicará.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "rehabilitacion-removible", specialty: "Rehabilitación oral y prótesis", procedure: "Prótesis removible (parcial o total)",
    descripcion: "Confección de una prótesis removible, con toma de impresiones, registros de mordida, pruebas y entrega. Puede requerir preparar el soporte de piezas remanentes. Se entregan instrucciones de uso, higiene y controles.",
    riesgos: "Período de adaptación con molestias, aumento de salivación, dificultad al hablar y masticar. Lesiones o úlceras por roce, que se ajustan en controles. Con el tiempo el hueso y la encía cambian y la prótesis requiere rebase o reemplazo. Caries y enfermedad de la encía en las piezas que sostienen ganchos si la higiene es insuficiente. Fractura de la prótesis. Una prótesis removible no tiene la estabilidad ni la fuerza de masticación de los dientes naturales o de un implante.",
    alternativas: "Prótesis fija sobre dientes o implantes, o no reponer las piezas ausentes.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "ortodoncia-tratamiento", specialty: "Ortodoncia", procedure: "Tratamiento de ortodoncia (aparatos fijos o alineadores)",
    descripcion: "Movimiento planificado de los dientes mediante aparatos fijos, alineadores u otros dispositivos, con controles periódicos. La duración estimada y el plan se explicarán y pueden variar según la respuesta del paciente. Puede requerir extracciones, desgaste interproximal o aparatos adicionales. Al terminar se indica un período de retención.",
    riesgos: "Molestias o dolor por los ajustes, y lesiones en mejillas o labios por los aparatos. Aumento del riesgo de caries, manchas del esmalte y enfermedad de la encía si la higiene no es muy cuidadosa. Reabsorción de las raíces, que suele ser leve y rara vez compromete la pieza. Retracción de la encía. Dolor o alteraciones de la articulación de la mandíbula. Aparatos que se despegan o se rompen. Resultado y duración que dependen de la colaboración del paciente (higiene, uso de elásticos o alineadores, asistencia a controles). Sin retención adecuada, los dientes pueden volver a moverse. No se puede garantizar un resultado específico.",
    alternativas: "Tratamiento con otro tipo de aparato, tratamiento parcial o restaurador para mejorar la estética, o no realizar tratamiento.",
    declaracion: `${DECLARACION_BASE} Me comprometo a mantener la higiene, usar los elementos indicados y asistir a los controles.`,
  },
  {
    id: "odontopediatria-tratamiento", specialty: "Odontopediatría", procedure: "Tratamiento odontológico en paciente menor de edad",
    descripcion: "Procedimiento odontológico indicado en el paciente menor de edad (por ejemplo, obturación, pulpotomía, extracción de pieza temporal, sellante o aplicación de flúor), con anestesia local y técnicas de manejo de conducta cuando corresponde. El procedimiento específico se detalla en el campo «Procedimiento propuesto».",
    riesgos: `${ANESTESIA} En niños es importante cuidar que no se muerdan los labios, la lengua o las mejillas mientras dura el adormecimiento.\nSensibilidad o dolor posteriores, hinchazón, sangrado y, rara vez, infección. En piezas temporales, el tratamiento busca mantener el espacio y la función hasta la erupción de la pieza permanente. Una pieza temporal con caries profunda puede requerir tratamiento de la pulpa o extracción. La colaboración del niño influye en el resultado y en la seguridad del procedimiento.`,
    alternativas: "Observación y control, otro tipo de tratamiento o extracción de la pieza, según el caso. No tratar puede causar dolor, infección y alterar la erupción de las piezas permanentes.",
    declaracion: DECLARACION_MENOR,
  },
  {
    id: "periodoncia-profilaxis", specialty: "Periodoncia", procedure: "Profilaxis y destartraje (limpieza dental)",
    descripcion: "Remoción de sarro, placa y manchas superficiales de los dientes sobre y justo bajo el borde de la encía, con instrumental manual o ultrasónico, y pulido. Puede aplicarse anestesia tópica o local si hay sensibilidad. Se indican técnicas de higiene y frecuencia de controles.",
    riesgos: "Sensibilidad dental transitoria y sangrado de encías, sobre todo si hay inflamación previa. Molestias en la encía durante los días siguientes. Al remover el sarro puede quedar más visible la retracción de la encía o los espacios entre dientes. Los resultados dependen de la higiene diaria y de los controles. En pacientes con ciertas condiciones cardíacas o inmunosupresión puede requerirse profilaxis antibiótica previa, que debe informarse.",
    alternativas: "Raspado y alisado radicular si hay enfermedad periodontal, higiene profesional parcial, o no realizar el procedimiento. No removerlo puede favorecer la inflamación de la encía y la pérdida de hueso.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "operatoria-carillas", specialty: "Operatoria y restauradora", procedure: "Carillas (resina o cerámica)",
    descripcion: "Cobertura de la cara visible de uno o más dientes con una lámina de resina o cerámica para modificar color, forma o posición. Puede requerir desgaste de esmalte (irreversible), provisorios, toma de impresiones, prueba y cementado. Se acordará el material y el diseño con el paciente.",
    riesgos: "Desgaste irreversible de tejido dental sano. Sensibilidad durante días o semanas. Descementado, fractura o fisura de la carilla, y manchas o filtración en el borde con el tiempo. Diferencia de color con piezas vecinas o restauraciones existentes. Retracción de la encía. Hábitos como el rechinamiento (bruxismo) o morder objetos duros aumentan el riesgo de fractura y pueden requerir una férula. La duración no es indefinida y pueden requerirse reemplazos. No se puede garantizar el resultado estético exacto.",
    alternativas: "Blanqueamiento, resinas directas, coronas, ortodoncia, o no realizar tratamiento.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "ttm-ferula", specialty: "Trastornos temporomandibulares", procedure: "Férula oclusal / manejo de trastorno temporomandibular",
    descripcion: "Confección y control de una férula de uso, habitualmente nocturno, para proteger los dientes y disminuir la carga sobre la articulación y los músculos de la mandíbula, junto con indicaciones de autocuidado y controles. Puede requerir ajustes y complementarse con otras terapias.",
    riesgos: "Molestias de adaptación, aumento de salivación, dificultad para hablar al inicio y ajustes frecuentes. La mejoría es variable y gradual, y los síntomas pueden persistir o reaparecer. Cambios en la mordida si se usa de forma inadecuada. Caries o irritación de la encía si la férula no se mantiene limpia. Fractura o desgaste de la férula. No se puede garantizar la desaparición del dolor.",
    alternativas: "Fisioterapia, medicación indicada por el profesional, ajuste de hábitos, otros tratamientos, o control sin tratamiento.",
    declaracion: `${DECLARACION_BASE} Me comprometo a usar la férula según lo indicado y asistir a los controles.`,
  },
  {
    id: "cirugia-biopsia", specialty: "Cirugía oral", procedure: "Biopsia de tejidos bucales",
    descripcion: "Toma de una muestra de tejido de la boca (o extirpación de una lesión) con anestesia local, para su estudio en laboratorio de anatomía patológica y obtener un diagnóstico. Se sutura la zona y se entregan indicaciones de cuidado. El resultado se informa cuando el laboratorio lo entrega.",
    riesgos: `${ANESTESIA}
Dolor, inflamación, hematoma y sangrado. Infección o apertura de los puntos. Cicatriz o alteración de la sensibilidad de la zona. La muestra puede no ser suficiente o requerir repetir la biopsia, y el resultado puede indicar otros estudios o tratamientos. El costo del estudio de laboratorio puede ser aparte.`,
    alternativas: "Control periódico de la lesión, otros exámenes, o no realizar el procedimiento. No estudiar una lesión puede retrasar el diagnóstico y el tratamiento.",
    declaracion: DECLARACION_BASE,
  },
  {
    id: "urgencia-dolor", specialty: "Urgencia", procedure: "Atención de urgencia (dolor, infección o trauma dental)",
    descripcion: "Atención destinada a aliviar el dolor, controlar una infección o estabilizar una lesión: por ejemplo, apertura de la pieza para drenar, drenaje de un absceso, medicación, o estabilización de una pieza golpeada. Es un tratamiento inicial; el tratamiento definitivo se planifica en una cita posterior.",
    riesgos: `${ANESTESIA}\nEl alivio puede ser parcial o transitorio y el dolor puede volver. La infección puede persistir o extenderse y requerir otros tratamientos o derivación. Los medicamentos pueden producir reacciones o interacciones; el paciente informó sus alergias y fármacos en uso. Una pieza lesionada puede perder vitalidad o fracturarse con el tiempo.`,
    alternativas: "Derivación a un servicio de urgencia, tratamiento definitivo inmediato si es posible, o no realizar el procedimiento. No tratar puede empeorar el cuadro.",
    declaracion: DECLARACION_BASE,
  },
];

export const CONSENT_SPECIALTIES: string[] = Array.from(new Set(CONSENT_TEMPLATES.map(template => template.specialty)));

export const consentTemplatesOf = (specialty: string): ConsentTemplate[] => CONSENT_TEMPLATES.filter(template => template.specialty === specialty);

export const consentTemplateById = (id: string): ConsentTemplate | undefined => CONSENT_TEMPLATES.find(template => template.id === id);

/** Campos del documento que rellena la plantilla (el profesional los puede editar a mano antes de guardar). */
export const consentTemplateContent = (template: ConsentTemplate) => ({
  procedimiento: template.procedure, descripcion: template.descripcion, riesgos: template.riesgos, alternativas: template.alternativas, declaracion: template.declaracion,
});
