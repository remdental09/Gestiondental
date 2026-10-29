---
name: publicar-ficha
description: Modificar y publicar el sitio privado Gestión Dental de Luis Rodríguez. Usar ante cambios de interfaz, API, esquema D1, voz, odontograma o errores del sitio, y para verificar que una versión nueva quedó activa sin ampliar el acceso.
---

# Publicar ficha

1. Leer `AGENTS.md`, `docs/PROJECT_STATE.md`, `.openai/hosting.json` y la skill oficial de Sites. Abrir la fuente remota del proyecto existente antes de editar; conservar su identidad y audiencia privada. Revisar cambios locales antes de tocar Git.
2. Implementar el cambio en código. Si cambia `db/schema.ts`, generar y revisar una migración nueva en `drizzle/`; no editar migraciones aplicadas ni usar datos de pacientes como seed.
3. Ejecutar comprobaciones pertinentes: tipos, compilación y prueba focalizada del flujo. Para cambios clínicos, verificar tanto validación del servidor como lectura posterior en la interfaz.
4. Sincronizar con el helper de Sites usando una credencial temporal por stdin oculto. Nunca imprimirla ni guardarla. Empaquetar el resultado del mismo commit enviado y publicar con las operaciones nativas de Sites, manteniendo D1/R2 y acceso privado.
5. Esperar un estado terminal del despliegue y probar el cambio en la URL publicada. Distinguir código compilado, commit enviado, versión guardada y sitio publicado; comunicar el punto exacto si se bloquea.
6. Actualizar `docs/PROJECT_STATE.md` si cambian decisiones o pendientes duraderos, sin datos de pacientes. No afirmar que un respaldo o migración funcionó solo porque la interfaz cargó.
