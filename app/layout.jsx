import "./globals.css";

export const metadata = {
  title: "CRM Doc ROI Canal Estudiantes",
  description: "Seguimiento de envios, campañas y respuestas del canal estudiante Doc ROI."
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
