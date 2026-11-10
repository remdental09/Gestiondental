# Gestión Dental · Dr. Luis Rodríguez

Este repositorio contiene el código del sitio clínico privado. Usar `.openai/hosting.json` para identificar el proyecto; no copiar ni inventar IDs de proyecto.

## Datos y límites
- Las fichas y evoluciones viven en D1 mediante `app/api/clinical/route.ts`; las imágenes, en R2. El código y Git no son un respaldo de pacientes.
- No poner datos identificables o clínicos de pacientes en el repositorio, fixtures, capturas, descripciones de commits ni documentación de proyecto.
- No convertir una declaración del paciente en un diagnóstico confirmado. Mantener vacíos los datos no informados y distinguir “sin registrar” de “niega”.
- El respaldo en Drive solo se declara completo cuando se comprueba el archivo de destino. Un registro en D1 no prueba que Drive tenga una copia.
- La interfaz usa la zona horaria America/Santiago. Mostrar la nomenclatura FDI con punto (1.2, 1.3, 2.1), aunque el código interno compacto sea 12, 13, 21. Distinguir FDI, numeración nacional chilena y Universal estadounidense antes de convertir: FDI 3.6 = Chile 30 = EE. UU. 19; FDI 4.6 = Chile 19 = EE. UU. 30. Una referencia aislada ambigua requiere aclaración clínica; «pieza 12» sin etiqueta FDI se entiende como numeración nacional chilena según esta aplicación.
- El odontograma debe conservar dentición permanente y temporal, codificar las superficies con FDI, permitir su equivalencia chilena, y separar el registro de caries por superficie del estado general del diente. La caries se registra por profundidad (esmalte, dentina superficial, dentina profunda, compromiso pulpar), no por ICDAS; los registros anteriores con ICDAS y actividad se conservan y se muestran como registro anterior. Mantener profundidad, actividad y experiencia COP-D/ceo-d como conceptos separados; todo conteo derivado es revisable. Los códigos CIE-11 solo se agregan si están verificados en la fuente oficial de la OMS (`lib/icd11.ts`); nunca inventar códigos.
- El periodontograma diferencia el tamizaje MINSAL EPB de la evaluación periodontal completa. Registrar EPB por sextante, Löe-Silness por cuatro sitios, sondaje completo por seis sitios, nivel de inserción, sangrado, supuración, movilidad y furcación. No convertir puntajes o umbrales de revisión en diagnóstico automático; estadio/grado AAP-EFP es ingreso profesional.

## Trabajo en este sitio
- Consultar `docs/PROJECT_STATE.md` para decisiones y pendientes no clínicos. Actualizarlo cuando cambie una decisión duradera o quede un bloqueo relevante.
- Usar las skills de `.agents/skills/` para admisión, evolución, publicación y conciliación de respaldo. Para despliegues, combinar `publicar-ficha` con la skill oficial de Sites.
- Preservar la política de acceso privada y las vinculaciones D1/R2 del manifiesto. No enviar credenciales a archivos, argumentos de shell, logs ni respuestas.
- Ante cambios de esquema, generar una nueva migración Drizzle; no reescribir migraciones ya aplicadas. Comprobar tipos, compilar y probar el flujo afectado en el sitio publicado.
- Para asociar una operación a una ficha antigua con nombre incompleto, comparar los componentes del nombre dictado en orden y priorizar la coincidencia más completa; mostrar el nombre guardado, resolver empates con RUT/fecha de nacimiento y exigir identificador adicional si solo hay dos componentes. No inferir nombres ni datos clínicos.
- Antes de afirmar que una operación clínica se guardó, leer de nuevo la ficha y verificar los campos estructurados, la evolución y el odontograma que correspondan.

## Principios de diseño: comodidad del profesional
El usuario es un dentista que quiere dedicarse a la clínica, no a la administración. Toda función nueva se juzga con estas reglas:
1. **Escribir lo mínimo.** Si se puede dictar, elegir de una lista o autocompletar desde datos ya guardados (arancel, ficha, agenda), no se pide teclear.
2. **Todo a 2 toques de Inicio.** El acceso a una ficha, al dictado o a una cita debe ser rápido e intuitivo; evitar menús profundos y pantallas de configuración.
3. **La app propone, el profesional confirma.** Preparar la acción completa y pedir solo una confirmación; nada clínico se guarda sin ella.
4. **Lo administrativo corre solo.** Respaldos, sincronización de agenda, recordatorios y cobros pendientes no dependen de que el usuario se acuerde; si algo falla, la app avisa sola.
5. **Rápido y sin sorpresas.** Respuestas en segundos, estados de carga claros, nunca una pantalla pegada. Los efectos visuales son sutiles y respetan «reducir movimiento».
6. **Arreglar la causa, no el síntoma.** Ante un error clínico, corregir el modelo (reglas de coherencia, historial por fecha) y agregar un caso de prueba; no parchar caso por caso.

## Control de calidad (gate)
- `npm run check` (tipos + pruebas) debe pasar antes de abrir un PR; en GitHub, `.github/workflows/gate.yml` ejecuta tipos, pruebas y compilación en cada PR y el despliegue a Cloudflare repite tipos y pruebas antes de publicar.
- Todo cambio clínico lleva su caso en `tests/`. Los cambios al odontograma, COP-D, presupuestos o respaldos se validan con una segunda revisión independiente contra la especificación antes de fusionar.
- Fusionar a `main` solo cuando el usuario lo pida («fusiona»).
- `docs/PROJECT_STATE.md` guarda lo vigente; lo histórico se resume, no se acumula.

## Mapa
- `app/page.tsx`: interfaz clínica.
- `app/api/clinical/route.ts`: lecturas y acciones clínicas por propietario.
- `db/schema.ts` y `drizzle/`: esquema y migraciones.
- `.openai/hosting.json`: identidad y recursos de Sites.
- `docs/PROJECT_STATE.md`: decisiones técnicas y pendientes sin datos de pacientes.
