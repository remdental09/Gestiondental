# Banco de pruebas de dictado

Sirve para decidir con datos si otro motor de transcripción (ElevenLabs Scribe, Deepgram Nova-3) reconoce mejor el dictado odontológico que el motor actual (OpenAI `gpt-transcribe`).

## Qué mide
- **WER**: porcentaje de palabras mal transcritas (menos es mejor). Los números hablados y escritos se igualan («pieza doce» = «pieza 12»).
- **Términos dentales**: de los términos clave de cada dictado (fármacos, materiales, marcas de implantes, diagnósticos), cuántos aparecen. Es la métrica que más importa.
- **Piezas correctas**: las piezas dichas («pieza 14», «piezas 3 y 14») deben salir iguales.
- Resultados por especialidad y los términos que más falla cada motor.

## Contenido
- `tests/stt-bench/guion.json`: 40 dictados ficticios (operatoria, endodoncia, implantología, periodoncia, cirugía, rehabilitación, ortodoncia, administrativo). Sin datos de pacientes. Los marcados `real` son los 10 que conviene grabar en consulta con ruido real.
- `scripts/stt-bench-lib.mjs`: puntuación (con pruebas en `tests/stt-bench.test.mjs`).
- `scripts/stt-bench.mjs`: transcribe con cada motor y arma el informe.

## Cómo se usa
1. Hoja de lectura: `node --experimental-strip-types scripts/stt-bench.mjs --guion --out ./stt-bench-out` → `guion-lectura.md`.
2. Grabar cada texto (celular o PC) y guardar el audio con el id: `op01.m4a`, `en03.wav`… en una carpeta. Los ⭐ en consulta, con el ruido real. Los audios no se suben al repositorio.
3. Claves en variables de entorno (no en archivos ni en el chat): `OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY`.
4. Correr:
   - `node --experimental-strip-types scripts/stt-bench.mjs --audio ./audios --engines openai,elevenlabs`
   - Con glosario dental como pistas: agregar `--keyterms` (se guarda aparte, para compararlo contra la misma corrida sin glosario).
   - `--only op01,en03` para probar pocos; las transcripciones quedan en caché en `--out`, repetir no vuelve a cobrar.
   - `--score-only` vuelve a puntuar lo ya guardado.
5. Resultado: tabla en pantalla y en `informe.md`.

## Pendiente de verificar con la primera corrida
- ID del modelo médico de ElevenLabs (`--el-model`); la documentación pública solo confirma `scribe_v2`.
- Deepgram Nova-3 en español con `keyterm`: su documentación no confirma el idioma; si responde error se prueba sin `--keyterms`.
- Costos: ElevenLabs suma 20 % con keyterms; Deepgram limita las pistas a 500 tokens por solicitud (el script manda 60 frases).
- Los números de los proveedores son propios; este banco existe para medirlos con dictado dental chileno.
