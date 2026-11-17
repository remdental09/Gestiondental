/** Páginas públicas (sin inicio de sesión) exigidas por Google para publicar y verificar la app de OAuth: descripción, política de privacidad y términos de uso. */
export const PUBLIC_CONTACT_EMAIL = "remdental09@gmail.com";
export const PUBLIC_UPDATED = "17 de noviembre de 2026";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Gestión Dental</title>
<meta name="robots" content="index,follow">
<style>
body{margin:0;font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f1b3a;background:#f3f0fa}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px}
.card{background:#fff;border:1px solid #ddd6f0;border-radius:16px;padding:28px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:28px 0 8px;color:#4b2a99}
p,li{color:#33494f}a{color:#6a3fc8}small{color:#6e6a8c}
nav{margin-bottom:16px;font-size:14px}
</style></head><body><main><nav><a href="/">Gestión Dental</a> · <a href="/acerca">Acerca</a> · <a href="/privacidad">Política de privacidad</a> · <a href="/terminos">Términos de uso</a></nav><div class="card">${body}</div></main></body></html>`;
}

export function aboutPage() {
  return layout("Acerca de", `
<h1>Gestión Dental</h1>
<p><small>Ficha clínica odontológica con dictado asistido por inteligencia artificial</small></p>
<p>Gestión Dental es una aplicación web para que profesionales odontólogos en Chile gestionen sus fichas clínicas: pacientes, odontograma, evoluciones, presupuestos, agenda e imágenes.</p>
<h2>Qué hace</h2>
<ul>
<li>Permite dictar por voz la atención del paciente y ordena el texto como evolución clínica, para que el profesional lo revise y confirme.</li>
<li>Mantiene el odontograma, los diagnósticos y las prestaciones del paciente.</li>
<li>Opcionalmente, guarda una copia de respaldo de cada ficha en el Google Drive del propio profesional.</li>
<li>Opcionalmente, muestra en su agenda las citas de su Google Calendar, crea en ese calendario las citas que agenda en la aplicación y envía desde su Gmail la confirmación de cita a sus pacientes.</li>
</ul>
<h2>Acceso</h2>
<p>El uso es para profesionales registrados. Cada profesional ingresa con su cuenta de Google y ve únicamente sus propias fichas. El uso es gratuito.</p>
<p>Más información sobre el tratamiento de datos en la <a href="/privacidad">Política de privacidad</a> y en los <a href="/terminos">Términos de uso</a>. Contacto: <a href="mailto:${PUBLIC_CONTACT_EMAIL}">${PUBLIC_CONTACT_EMAIL}</a>.</p>`);
}

export function privacyPage() {
  return layout("Política de privacidad", `
<h1>Política de privacidad</h1>
<p><small>Última actualización: ${PUBLIC_UPDATED}</small></p>
<p>Esta política explica qué datos trata <strong>Gestión Dental</strong> (la «aplicación»), para qué los usa y cómo puedes controlarlos. Responsable del servicio: Dr. Luis Rodríguez, Chile. Contacto: <a href="mailto:${PUBLIC_CONTACT_EMAIL}">${PUBLIC_CONTACT_EMAIL}</a>.</p>

<h2>1. Datos que se tratan</h2>
<ul>
<li><strong>Datos del profesional:</strong> correo electrónico y nombre de su cuenta de Google al iniciar sesión, y los datos que el propio profesional ingresa al registrarse: nombre, apellido, RUT y especialidad.</li>
<li><strong>Datos clínicos de pacientes</strong> que el profesional registra: identificación, odontograma, diagnósticos, evoluciones, presupuestos, pagos, agenda e imágenes. Son datos sensibles y se tratan con reserva.</li>
<li><strong>Dictados por voz:</strong> el audio y su transcripción, usados para redactar la evolución clínica.</li>
</ul>

<h2>2. Para qué se usan</h2>
<p>Únicamente para prestar el servicio al profesional: mantener su ficha clínica, transcribir y ordenar sus dictados, mostrar su agenda y, si lo autoriza, respaldar sus fichas. No se venden, no se usan para publicidad y no se comparten con terceros para fines propios de ellos.</p>

<h2>3. Datos de tu cuenta de Google</h2>
<ul>
<li><strong>Inicio de sesión:</strong> se usa el correo y el nombre de tu cuenta de Google solo para identificarte y separar tus fichas de las de otros profesionales.</li>
<li><strong>Google Drive (opcional, permiso <em>drive.file</em>):</strong> solo permite a la aplicación crear y leer los archivos y carpetas que ella misma crea. Con él crea una carpeta «Pacientes» en tu Drive y guarda allí una copia de cada ficha. No ve ni modifica ningún otro archivo de tu Drive.</li>
<li><strong>Google Calendar, lectura (opcional, permiso <em>calendar.readonly</em>):</strong> lee los eventos de los calendarios que elijas para mostrarlos en la agenda de la aplicación, actualizarlos periódicamente y avisarte de los cambios. No modifica nada con este permiso.</li>
<li><strong>Google Calendar, citas (opcional, permiso <em>calendar.events</em>):</strong> crea y actualiza en tu calendario las citas que agendas dentro de la aplicación, para que tu agenda de Google quede al día. No borra calendarios ni cambia su configuración.</li>
<li><strong>Gmail, solo envío (opcional, permiso <em>gmail.send</em>):</strong> envía desde la cuenta que elijas los correos de confirmación de cita a tus pacientes y la agenda semanal a tu personal, cuando activas esas funciones. No lee, no busca ni borra tus correos.</li>
<li>Cada permiso se pide por separado y solo cuando activas la función correspondiente. Los tokens de acceso se guardan cifrados y se usan únicamente para esa función.</li>
<li>Los datos obtenidos de Google se usan solo para mostrar o realizar estas funciones al propio profesional; no se leen por personas, salvo con tu consentimiento expreso, por seguridad o por obligación legal.</li>
<li>El uso que la aplicación hace de la información recibida de las APIs de Google cumple con la <a href="https://developers.google.com/terms/api-services-user-data-policy">Política de Datos de Usuario de los Servicios de API de Google</a>, incluidos los requisitos de uso limitado. Esos datos no se transfieren a terceros, salvo lo necesario para operar el servicio, ni se usan para publicidad ni para entrenar modelos de IA de uso general.</li>
</ul>

<h2>4. Proveedores que procesan datos</h2>
<ul>
<li><strong>Cloudflare:</strong> aloja la aplicación, controla el acceso y almacena la base de datos y las imágenes.</li>
<li><strong>OpenAI:</strong> recibe el audio y el texto de los dictados para transcribirlos y estructurarlos mediante su API, únicamente para generar la evolución solicitada.</li>
<li><strong>Google:</strong> inicio de sesión y, si los autorizas, respaldo en tu propio Drive, lectura y creación de citas en tu Calendar y envío de correos desde tu Gmail.</li>
</ul>

<h2>5. Seguridad y aislamiento</h2>
<p>El acceso exige autenticación. Cada profesional ve solo sus propias fichas. Las conexiones usan HTTPS y los tokens de Google se almacenan cifrados. Ningún sistema es infalible; ante un incidente que afecte tus datos te avisaremos.</p>

<h2>6. Conservación y eliminación</h2>
<p>Los datos se conservan mientras uses el servicio. Puedes solicitar la eliminación de tu cuenta y de tus datos escribiendo a <a href="mailto:${PUBLIC_CONTACT_EMAIL}">${PUBLIC_CONTACT_EMAIL}</a>. Algunos datos clínicos pueden requerir conservarse por el plazo que la normativa chilena exija al profesional. Puedes desconectar Drive, Calendar o Gmail desde la aplicación, o revocar en cualquier momento el acceso desde tu cuenta de Google (<a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>); al revocarlo, la aplicación deja de usar esos datos.</p>

<h2>7. Tus derechos</h2>
<p>Puedes pedir acceso, rectificación o eliminación de tus datos personales, y oponerte a su tratamiento, escribiendo al correo de contacto. Si eres paciente, tu ficha es responsabilidad de tu profesional tratante; dirígete a él.</p>

<h2>8. Cambios</h2>
<p>Si esta política cambia, se actualizará esta página con una nueva fecha.</p>`);
}


export function termsPage() {
  return layout("Términos de uso", `
<h1>Términos de uso</h1>
<p><small>Última actualización: ${PUBLIC_UPDATED}</small></p>
<p>Estos términos regulan el uso de <strong>Gestión Dental</strong> (la «aplicación»), disponible en speakdent.cl. Responsable del servicio: Dr. Luis Rodríguez, Chile. Contacto: <a href="mailto:${PUBLIC_CONTACT_EMAIL}">${PUBLIC_CONTACT_EMAIL}</a>.</p>

<h2>1. Quién puede usarla</h2>
<p>La aplicación está dirigida a profesionales de la odontología. Al registrarte declaras que los datos de tu registro (nombre, documento de identidad y especialidad) son verdaderos y que usarás la aplicación en el ejercicio de tu profesión.</p>

<h2>2. Servicio gratuito y en desarrollo</h2>
<p>El uso es gratuito y sin suscripción. La aplicación está en desarrollo activo: sus funciones pueden cambiar, y puede tener errores o interrupciones. Se entrega «tal como está», sin garantía de disponibilidad continua.</p>

<h2>3. Responsabilidad clínica</h2>
<p>La aplicación propone; el profesional confirma. La transcripción del dictado, la redacción de evoluciones, los diagnósticos sugeridos, las prestaciones y los cambios al odontograma o periodontograma son sugerencias que el profesional debe revisar antes de guardarlas. Las decisiones clínicas y el contenido final de la ficha son responsabilidad exclusiva del profesional tratante.</p>

<h2>4. Datos de los pacientes</h2>
<p>El profesional es responsable de contar con la base legal para registrar los datos de sus pacientes y de cumplir la normativa chilena aplicable a la ficha clínica y a los datos de salud. La aplicación trata esos datos solo para prestarle el servicio, según la <a href="/privacidad">Política de privacidad</a>.</p>

<h2>5. Respaldo</h2>
<p>El respaldo en Google Drive es una función opcional que depende de la conexión que autorices. Te recomendamos activarlo y revisar periódicamente que tus copias estén al día; la aplicación no reemplaza tus propias obligaciones de conservación de la ficha clínica.</p>

<h2>6. Uso adecuado</h2>
<p>No debes intentar acceder a fichas de otros profesionales, vulnerar la seguridad del servicio ni usarlo para fines ilícitos. Podemos suspender una cuenta que incumpla estos términos.</p>

<h2>7. Término de la cuenta</h2>
<p>Puedes dejar de usar la aplicación y pedir la eliminación de tu cuenta escribiendo al correo de contacto. Antes de eliminarla puedes exportar o respaldar tus fichas.</p>

<h2>8. Cambios</h2>
<p>Si estos términos cambian, se actualizará esta página con una nueva fecha. Se rigen por la legislación de Chile.</p>`);
}
