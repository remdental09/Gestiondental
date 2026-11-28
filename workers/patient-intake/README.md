# Formulario público de ingreso

Este Worker independiente sirve únicamente el formulario de datos básicos. Comparte el D1 del portal privado para validar enlaces de un solo uso y guardar pacientes. No sirve la interfaz clínica ni permite leer fichas.

- Enlace público: `https://speakdent.cl/api/ingreso-paciente?t=<token>` (respaldo técnico: `https://ingreso.speakdent.cl/?t=<token>`)
- La ficha privada crea tokens aleatorios de 24 bytes, guarda solo su SHA-256 y los vence a los 7 días.
- `observability` queda desactivado para que la query con el token no llegue a registros de invocación.
- Despliegue: `pnpm exec wrangler deploy --config workers/patient-intake/wrangler.jsonc`.

Mantén la política de un solo uso y no agregues preguntas clínicas a esta pantalla.
