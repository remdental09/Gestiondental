import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gestión Dental",
  description: "Prototipo privado de ficha odontológica, presupuestos y agenda.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

// Ancho del dispositivo sin bloquear el zoom (accesibilidad); el color acompaña la barra de Safari.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f3f0fa",
};

const RECOVER = `(function(){var K="gd-recover",now=Date.now();function again(){try{var last=+sessionStorage.getItem(K)||0;if(now-last<60000)return;sessionStorage.setItem(K,String(Date.now()))}catch(e){}location.reload()}
window.addEventListener("error",function(e){var t=e.target;if(t&&(t.tagName==="SCRIPT"||t.tagName==="LINK"))again()},true);
window.addEventListener("unhandledrejection",function(e){var m=String(e.reason&&(e.reason.message||e.reason)||"");if(/dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(m))again()});
setTimeout(function(){if(!window.__gdReady&&document.visibilityState==="visible"&&document.body.innerText.indexOf("Cargando fichas")>=0)again()},20000);})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-CL">
      <body className="antialiased">
        {children}
        {/* Si la página quedó de una versión anterior (tras una actualización) y no arrancó, se recarga sola una vez. */}
        <script dangerouslySetInnerHTML={{ __html: RECOVER }} />
      </body>
    </html>
  );
}
