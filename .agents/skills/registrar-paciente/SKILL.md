---
name: registrar-paciente
description: Registrar o actualizar pacientes en la aplicación Gestión Dental de Luis Rodríguez. Usar cuando el clínico dicta una nueva ficha, corrige identificación, teléfono, correo, alergias o antecedentes, o pide comprobar que los datos quedaron guardados.
---

# Registrar paciente

1. Al crear una ficha nueva, solicitar los dos nombres y los dos apellidos cuando estén disponibles; no inventar componentes. Para una ficha existente, aceptar una coincidencia con menos componentes guardados cuando estos aparezcan en el nombre dictado, en el mismo orden, y elegir solo la coincidencia con mayor número de componentes. Mostrar el nombre registrado antes del cambio. Si la mejor coincidencia empata, pedir RUT o fecha de nacimiento; si la ficha guarda solo dos componentes, exigir también uno de esos identificadores. Buscar antes de crear y no escoger por ficha activa o historial reciente.
2. Separar lo dicho por el paciente, lo observado por el clínico y lo aún no informado. No inventar RUT, correo, teléfono, medicamentos, diagnósticos o ausencia de alergias. Dejar los opcionales vacíos si faltan.
3. Normalizar la fecha a AAAA-MM-DD y comprobar edad en America/Santiago. Conservar el teléfono tal como fue confirmado; no añadir prefijo de país por inferencia.
4. Completar los campos estructurados de contacto, alergias y antecedentes. Si el usuario pide una evolución u odontograma, usar además `registrar-evolucion-dental`; no confiar en una nota narrativa como sustituto de campos editables.
5. Guardar mediante la interfaz o herramienta clínica autorizada. Reabrir la ficha y verificar nombre, nacimiento, teléfono, correo, alergias y antecedentes afectados. Ante error, informar qué quedó guardado y qué no.
6. Indicar el estado real del respaldo. Si no hay confirmación de Drive, decir que está pendiente y usar `conciliar-respaldo` cuando se solicite verificarlo.

Mantener datos de pacientes dentro de la aplicación clínica; no escribirlos en código, archivos de skills, documentación del repositorio ni ejemplos de prueba.
