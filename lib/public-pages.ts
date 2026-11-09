/** Páginas públicas (sin inicio de sesión) exigidas por Google para publicar la app de OAuth: descripción y política de privacidad. */
export const PUBLIC_CONTACT_EMAIL = "remdental09@gmail.com";
export const PUBLIC_UPDATED = "9 de noviembre de 2026";

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

function layout(title: string, body: string) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} · Gestión Dental</title>
<meta name="robots" content="index,follow">
<style>
body{margin:0;font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#20343b;background:#f4f7f8}
main{max-width:760px;margin:0 auto;padding:32px 20px 64px}
.card{background:#fff;border:1px solid #dce5e7;border-radius:16px;padding:28px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:20px;margin:28px 0 8px;color:#145b60}
p,li{color:#33494f}a{color:#087f83}small{color:#71858b}
nav{margin-bottom:16px;font-size:14px}
</style></head><body><main><nav><a href="/acerca">Gestión Dental</a> · <a href="/privacidad">Política de privacidad</a></nav><div class="card">${body}</div></main></body></html>`;
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
</ul>
<h2>Acceso</h2>
<p>El uso es para profesionales registrados. Cada profesional ingresa con su cuenta de Google o con un código enviado a su correo, y ve únicamente sus propias fichas.</p>
<p>Más información sobre el tratamiento de datos en la <a href="/privacidad">Política de privacidad</a>. Contacto: <a href="mailto:${PUBLIC_CONTACT_EMAIL}">${PUBLIC_CONTACT_EMAIL}</a>.</p>`);
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
<li><strong>Google Drive (opcional):</strong> si lo autorizas, la aplicación solicita el permiso <em>drive.file</em>, que solo le permite crear y leer los archivos y carpetas que ella misma crea. Con él crea una carpeta «Pacientes» en tu Drive y guarda allí una copia de cada ficha. No accede a ningún otro archivo de tu Drive.</li>
<li>El token de acceso a tu Drive se guarda cifrado y se usa solo para ese respaldo.</li>
<li>El uso que la aplicación hace de la información recibida de las APIs de Google cumple con la <a href="https://developers.google.com/terms/api-services-user-data-policy">Política de Datos de Usuario de los Servicios de API de Google</a>, incluidos los requisitos de uso limitado. Esos datos no se transfieren a terceros, salvo lo necesario para operar el servicio, ni se usan para publicidad ni para entrenar modelos de IA de uso general.</li>
</ul>

<h2>4. Proveedores que procesan datos</h2>
<ul>
<li><strong>Cloudflare:</strong> aloja la aplicación, controla el acceso y almacena la base de datos y las imágenes.</li>
<li><strong>OpenAI:</strong> recibe el audio y el texto de los dictados para transcribirlos y estructurarlos mediante su API, únicamente para generar la evolución solicitada.</li>
<li><strong>Google:</strong> inicio de sesión y, si se autoriza, almacenamiento de los respaldos en tu propio Drive.</li>
</ul>

<h2>5. Seguridad y aislamiento</h2>
<p>El acceso exige autenticación. Cada profesional ve solo sus propias fichas. Las conexiones usan HTTPS y los tokens de Drive se almacenan cifrados. Ningún sistema es infalible; ante un incidente que afecte tus datos te avisaremos.</p>

<h2>6. Conservación y eliminación</h2>
<p>Los datos se conservan mientras uses el servicio. Puedes solicitar la eliminación de tu cuenta y de tus datos escribiendo a <a href="mailto:${PUBLIC_CONTACT_EMAIL}">${PUBLIC_CONTACT_EMAIL}</a>. Algunos datos clínicos pueden requerir conservarse por el plazo que la normativa chilena exija al profesional. Puedes revocar en cualquier momento el acceso a tu Drive desde tu cuenta de Google, en «Seguridad → Aplicaciones con acceso a tu cuenta».</p>

<h2>7. Tus derechos</h2>
<p>Puedes pedir acceso, rectificación o eliminación de tus datos personales, y oponerte a su tratamiento, escribiendo al correo de contacto. Si eres paciente, tu ficha es responsabilidad de tu profesional tratante; dirígete a él.</p>

<h2>8. Cambios</h2>
<p>Si esta política cambia, se actualizará esta página con una nueva fecha.</p>`);
}
