# Capturadora SpeakDent (Windows, prueba 0.2)

Programa de escritorio (C# WinForms, .NET Framework 4) que reconoce un visor DICOM abierto, guarda la imagen de su
ventana en `Imágenes\SpeakDent` y la entrega a la ficha de SpeakDent abierta en el mismo computador (F8, botón propio o
botón «Capturar de Blue Sky» de la ficha). Queda junto al reloj y puede iniciar con Windows. No usa internet.

## Conexión con la ficha (`Puente.cs` ↔ `lib/capture-bridge.ts`)

Servidor HTTP mínimo en `127.0.0.1:47821`. Solo acepta las direcciones de SpeakDent (`Origin`) y su propio `Host`.
Cada ficha de implante genera una sesión; una captura queda marcada para la sesión que escuchaba en ese momento,
solo esa sesión puede leerla y se descarta a los 5 minutos. El navegador pide una vez permiso para conectarse
con este computador. Si cambian las direcciones del sitio, actualizar `Puente.Origenes` y publicar de nuevo el programa.

## Compilar y probar (Linux con `mono-devel`)

```sh
sh compilar.sh
```

Compila contra las bibliotecas de .NET Framework 4.8 (no contra las de Mono, que tienen funciones que Windows no trae:
así falló la versión 0.1), ejecuta `Pruebas.cs` y deja el paquete en `public/descargas/capturadora-speakdent-prueba.zip`.
Si cambia el código, hay que ejecutar el script y subir el paquete. Las ventanas solo se pueden probar en Windows.
`FakeViewer.cs` es una ventana de ejemplo para probar a mano.

## Pendiente antes de ofrecerla a otros profesionales

Probar en Windows con Blue Sky Plan, firmar el ejecutable y resolver la actualización. Mientras tanto la descarga y la
conexión solo aparecen a la cuenta de desarrollo.
