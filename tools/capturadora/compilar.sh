#!/bin/sh
# Compila la capturadora contra las bibliotecas que trae Windows (.NET Framework 4.8), no contra las de Mono:
# Mono tiene funciones de más y el programa fallaría al abrirlo en Windows.
#   sh compilar.sh            -> build/CapturadoraSpeakDent.exe, pruebas y paquete de descarga
set -eu
cd "$(dirname "$0")"
API="${NET_API:-/usr/lib/mono/4.8-api}"
test -f "$API/mscorlib.dll" || { echo "Falta $API (instala mono-devel)"; exit 1; }
REFS="-nostdlib -noconfig -r:$API/mscorlib.dll -r:$API/System.dll -r:$API/System.Core.dll -r:$API/System.Drawing.dll -r:$API/System.Windows.Forms.dll"
mkdir -p build
mcs $REFS -target:winexe -optimize+ -warn:4 -warnaserror -win32manifest:app.manifest -out:build/CapturadoraSpeakDent.exe Capturadora.cs Puente.cs
mcs $REFS -target:exe -warn:4 -main:Pruebas -out:build/Pruebas.exe Capturadora.cs Puente.cs Pruebas.cs
XDG_CONFIG_HOME="$(mktemp -d)" mono build/Pruebas.exe build/CapturadoraSpeakDent.exe
python3 - <<'PY'
import zipfile
with zipfile.ZipFile("../../public/descargas/capturadora-speakdent-prueba.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.write("build/CapturadoraSpeakDent.exe", "CapturadoraSpeakDent.exe")
    z.write("LEEME.txt", "LEEME.txt")
PY
echo "Paquete actualizado."
