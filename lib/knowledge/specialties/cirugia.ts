import { defineSpecialty } from "../specialty.ts";

/** Cirugía bucal y cirugía y traumatología buco maxilofacial. */
export const CIRUGIA = defineSpecialty({
  id: "cirugia",
  nombre: "Cirugía bucal y maxilofacial",
  oficial: "Cirugía bucal · Cirugía y traumatología buco maxilofacial",
  senales: [
    "exodoncia", "extraccion", "extrae", "tercer molar", "cordal", "muela del juicio", "odontoseccion", "osteotomia", "ostectomia",
    "colgajo", "sutura", "botador", "forceps", "alveolitis", "biopsia", "quiste", "frenectomia", "apicectomia", "fractura mandibular",
    "osteosintesis", "drenaje", "absceso", "comunicacion bucosinusal", "comunicacion orosinusal", "anestesia troncular",
  ],
  notas: [
    "Exodoncia simple (con fórceps o botador) y exodoncia quirúrgica (con colgajo, ostectomía u odontosección) son prestaciones distintas: conserva cuál se dictó.",
    "Un tercer molar se describe por su posición (incluido, semiincluido, retenido, erupcionado) y angulación de Winter (mesioangular, distoangular, vertical, horizontal); no las infieras.",
    "Conserva la sutura con su material y calibre (p. ej. Vicryl 4-0, seda 3-0) y el número de puntos si se dictó.",
    "«Resto radicular» o «raíz» extraída no es lo mismo que la pieza completa; conserva lo dictado.",
  ],
  procedimientos: [
    "exodoncia simple", "exodoncia quirúrgica", "exodoncia de tercer molar", "exodoncia de resto radicular", "exodoncia múltiple",
    "odontosección", "ostectomía", "osteotomía", "alveoloplastia", "regularización de reborde", "colgajo mucoperióstico",
    "colgajo triangular", "colgajo envolvente", "colgajo trapezoidal", "despegamiento mucoperióstico", "curetaje del alvéolo",
    "irrigación con suero fisiológico", "sutura con puntos simples", "sutura continua", "punto colchonero", "punto en X",
    "retiro de puntos", "hemostasia", "compresión con gasa", "apicectomía", "obturación retrógrada", "cirugía periapical",
    "quistectomía", "enucleación de quiste", "marsupialización", "biopsia incisional", "biopsia excisional", "frenectomía labial",
    "frenectomía lingual", "frenotomía", "exéresis de lesión", "drenaje de absceso", "incisión y drenaje", "cierre de comunicación bucosinusal",
    "colgajo de avance vestibular", "colgajo de bola de Bichat", "fenestración y tracción de canino incluido", "exposición quirúrgica",
    "trasplante dentario", "reimplante dentario", "reducción de fractura", "osteosíntesis con placas", "bloqueo intermaxilar",
    "reducción de luxación de ATM", "cirugía ortognática", "osteotomía Le Fort I", "osteotomía sagital de rama", "genioplastia",
    "torectomía", "exéresis de torus", "tratamiento de alveolitis", "anestesia infiltrativa", "anestesia troncular",
    "bloqueo del nervio alveolar inferior", "técnica de Spix", "técnica de Gow-Gates", "técnica de Vazirani-Akinosi", "anestesia intraligamentaria",
  ],
  materiales: [
    "sutura reabsorbible", "sutura no reabsorbible", "Vicryl", "Vicryl Rapide", "poliglactina 910", "Monocryl", "poliglecaprone 25",
    "PDS", "polidioxanona", "Prolene", "polipropileno", "nylon", "seda quirúrgica", "catgut crómico", "calibre 3-0", "calibre 4-0",
    "calibre 5-0", "aguja atraumática", "aguja de sección triangular", "esponja de gelatina", "celulosa oxidada", "colágeno hemostático",
    "ácido tranexámico", "cera para hueso", "apósito alveolar", "placas de titanio", "tornillos de osteosíntesis", "arco de Erich",
    "tubete anestésico", "lidocaína al 2 % con epinefrina", "articaína al 4 % con epinefrina", "mepivacaína al 3 %", "prilocaína con felipresina",
  ],
  marcas: [
    ["Vicryl", "Ethicon"], ["Monocryl", "Ethicon"], ["Prolene", "Ethicon"], ["PDS", "Ethicon"], ["Spongostan", "Ethicon"],
    ["Surgicel", "Ethicon"], ["Gelita", "Gelita Medical"], ["Alvogyl", "Septodont"], ["Septocaine", "Septodont"], ["Scandonest", "Septodont"],
    ["Orabloc", "Pierrel"], ["Alveogyl", "Septodont"],
  ],
  instrumentos: [
    "fórceps", "fórceps superior", "fórceps inferior", "fórceps para restos radiculares", "botador recto", "botador de Winter",
    "botador de bandera", "elevador", "periostótomo", "periostótomo de Molt", "legra", "cureta de Lucas", "pinza gubia", "lima de hueso",
    "tijera de Metzenbaum", "tijera de Goldman-Fox", "porta agujas", "pinza Adson", "pinza mosquito", "separador de Minnesota",
    "separador de Farabeuf", "bisturí", "hoja de bisturí número 15", "hoja número 12", "pieza de mano quirúrgica", "fresa quirúrgica",
    "fresa redonda de carburo", "fresa de Lindemann", "jeringa carpule", "aspirador quirúrgico", "abrebocas",
  ],
  hallazgos: [
    "tercer molar incluido", "tercer molar semiincluido", "tercer molar retenido", "tercer molar impactado", "posición mesioangular",
    "posición distoangular", "posición vertical", "posición horizontal", "clase I de Pell y Gregory", "clase II de Pell y Gregory",
    "clase III de Pell y Gregory", "posición A", "posición B", "posición C", "relación con el conducto dentario inferior",
    "resto radicular", "raíz fracturada", "raíz dilacerada", "hipercementosis", "anquilosis", "pericoronaritis", "alveolitis seca",
    "alveolitis húmeda", "hemorragia post exodoncia", "comunicación bucosinusal", "comunicación orosinusal", "parestesia del nervio lingual",
    "parestesia del nervio alveolar inferior", "hipoestesia", "trismus", "edema", "equimosis", "hematoma", "absceso submucoso",
    "celulitis facial", "fractura de ángulo mandibular", "fractura de cóndilo", "fractura de sínfisis", "fractura de tuberosidad",
    "luxación de ATM", "torus palatino", "torus mandibular", "exostosis",
  ],
  medicamentos: [
    "amoxicilina", "amoxicilina con ácido clavulánico", "clindamicina", "azitromicina", "metronidazol", "ibuprofeno", "ketoprofeno",
    "ketorolaco", "naproxeno", "paracetamol", "tramadol", "dexametasona", "betametasona", "clorhexidina 0,12 %", "ácido tranexámico",
  ],
  sinonimos: [
    ["exodoncia", ["extracción dental", "extracción dentaria"]],
    ["tercer molar", ["cordal", "muela del juicio"]],
    ["comunicación bucosinusal", ["comunicación orosinusal"]],
    ["botador", ["elevador"]],
  ],
  oidoMal: [
    ["odontosección", ["odonto sección", "odonto seccion"]],
    ["ostectomía", ["os tectomía", "hostectomía"]],
    ["periostótomo", ["perióstomo", "periostomo"]],
    ["Vicryl", ["vicril", "bicril", "vícril"]],
    ["Alvogyl", ["alvojil", "alvogil", "albogil"]],
  ],
});
