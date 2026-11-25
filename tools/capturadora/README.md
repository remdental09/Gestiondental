# Capturadora SpeakDent (Windows, prueba 0.1)

Programa de escritorio (C# WinForms, .NET Framework 4) que reconoce un visor DICOM abierto y, con F8, guarda la imagen
de su ventana en `Imágenes\SpeakDent` y en el portapapeles. No usa internet ni envía nada a la ficha.
La imagen se pega en la pestaña Implantología (Ctrl+V).

## Compilar (Linux o Windows con Mono)

```sh
mcs -target:winexe -optimize+ -warn:4 -win32manifest:app.manifest \
  -r:System.dll -r:System.Drawing.dll -r:System.Windows.Forms.dll \
  -out:build/CapturadoraSpeakDent.exe Capturadora.cs
```

Pruebas de lógica: compilar como ejecutable de consola con `-main:Pruebas`, incluyendo `Pruebas.cs`, y ejecutar
`XDG_CONFIG_HOME=$(mktemp -d) mono Pruebas.exe build/CapturadoraSpeakDent.exe`.
`FakeViewer.cs` es una ventana de ejemplo para probar a mano.

La descarga publicada es `public/descargas/capturadora-speakdent-prueba.zip` (el `.exe` y `LEEME.txt`).
Si cambia el código, hay que recompilar y volver a empaquetar.

## Pendiente antes de ofrecerla a otros profesionales

Probar en Windows con Blue Sky Plan, firmar el ejecutable y resolver la actualización. Mientras tanto el botón de
descarga solo aparece a la cuenta de desarrollo.
