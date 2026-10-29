# Gestión Dental · Dr. Luis Rodríguez

Este repositorio contiene el código del sitio clínico privado. Usar `.openai/hosting.json` para identificar el proyecto; no copiar ni inventar IDs de proyecto.

## Datos y límites
- Las fichas y evoluciones viven en D1 mediante `app/api/clinical/route.ts`; las imágenes, en R2. El código y Git no son un respaldo de pacientes.
- No poner datos identificables o clínicos de pacientes en el repositorio, fixtures, capturas, descripciones de commits ni documentación de proyecto.
- No convertir una declaración del paciente en un diagnóstico confirmado. Mantener vacíos los datos no informados y distinguir “sin registrar” de “niega”.
- El respaldo en Drive solo se declara completo cuando se comprueba el archivo de destino. Un registro en D1 no prueba que Drive tenga una copia.
- La interfaz usa la zona horaria America/Santiago. Mostrar la nomenclatura FDI con punto (1.2, 1.3, 2.1), aunque el código interno compacto sea 12, 13, 21. Distinguir FDI, numeración nacional chilena y Universal estadounidense antes de convertir: FDI 3.6 = Chile 30 = EE. UU. 19; FDI 4.6 = Chile 19 = EE. UU. 30. Una referencia aislada ambigua requiere aclaración clínica; «pieza 12» sin etiqueta FDI se entiende como numeración nacional chilena según esta aplicación.
- El odontograma debe conservar dentición permanente y temporal, codificar las superficies con FDI, permitir su equivalencia chilena, y separar el registro de caries por superficie del estado general del diente. Mantener ICDAS, actividad de lesión y experiencia COP-D/ceo-d como conceptos separados; todo conteo derivado es revisable.
- El periodontograma diferencia el tamizaje MINSAL EPB de la evaluación periodontal completa. Registrar EPB por sextante, Löe-Silness por cuatro sitios, sondaje completo por seis sitios, nivel de inserción, sangrado, supuración, movilidad y furcación. No convertir puntajes o umbrales de revisión en diagnóstico automático; estadio/grado AAP-EFP es ingreso profesional.

## Trabajo en este sitio
- Consultar `docs/PROJECT_STATE.md` para decisiones y pendientes no clínicos. Actualizarlo cuando cambie una decisión duradera o quede un bloqueo relevante.
- Usar las skills de `.agents/skills/` para admisión, evolución, publicación y conciliación de respaldo. Para despliegues, combinar `publicar-ficha` con la skill oficial de Sites.
- Preservar la política de acceso privada y las vinculaciones D1/R2 del manifiesto. No enviar credenciales a archivos, argumentos de shell, logs ni respuestas.
- Ante cambios de esquema, generar una nueva migración Drizzle; no reescribir migraciones ya aplicadas. Comprobar tipos, compilar y probar el flujo afectado en el sitio publicado.
- Para asociar una operación a una ficha antigua con nombre incompleto, comparar los componentes del nombre dictado en orden y priorizar la coincidencia más completa; mostrar el nombre guardado, resolver empates con RUT/fecha de nacimiento y exigir identificador adicional si solo hay dos componentes. No inferir nombres ni datos clínicos.
- Antes de afirmar que una operación clínica se guardó, leer de nuevo la ficha y verificar los campos estructurados, la evolución y el odontograma que correspondan.

## Mapa
- `app/page.tsx`: interfaz clínica.
- `app/api/clinical/route.ts`: lecturas y acciones clínicas por propietario.
- `db/schema.ts` y `drizzle/`: esquema y migraciones.
- `.openai/hosting.json`: identidad y recursos de Sites.
- `docs/PROJECT_STATE.md`: decisiones técnicas y pendientes sin datos de pacientes.
