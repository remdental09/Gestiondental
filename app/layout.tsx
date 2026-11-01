import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gestión Dental · Dr. Luis Rodríguez",
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
  themeColor: "#f4f7f8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-CL">
      <body className="antialiased">{children}</body>
    </html>
  );
}
