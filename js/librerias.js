// ===============================
// LIBRERÍAS EXTERNAS BAJO DEMANDA
// Las más pesadas (escáner, QR, gráficos, PDF, captura) ya no se descargan al abrir la app:
// se piden la primera vez que una pantalla las necesita. Mismas direcciones de siempre.
// ===============================

const LIBRERIAS = {
  lector:  { url: "https://unpkg.com/html5-qrcode", listo: () => typeof Html5Qrcode !== "undefined" },
  qr:      { url: "https://cdn.jsdelivr.net/npm/qrcode/build/qrcode.min.js", listo: () => typeof QRCode !== "undefined" },
  grafico: { url: "https://cdn.jsdelivr.net/npm/chart.js", listo: () => typeof Chart !== "undefined" },
  captura: { url: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", listo: () => typeof html2canvas !== "undefined" },
  pdf:     { url: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", listo: () => !!window.jspdf }
};

const libreriasPendientes = {};

// Devuelve una promesa que se cumple cuando la librería está lista (varias llamadas comparten la descarga)
function cargarLibreria(clave) {
  const lib = LIBRERIAS[clave];
  if (!lib) return Promise.reject(new Error("Librería desconocida: " + clave));
  if (lib.listo()) return Promise.resolve();

  if (!libreriasPendientes[clave]) {
    libreriasPendientes[clave] = new Promise((resolve, reject) => {
      const fallar = () => { delete libreriasPendientes[clave]; reject(new Error("No se pudo cargar la librería «" + clave + "»")); };
      const s = document.createElement("script");
      s.src = lib.url;
      s.async = true;
      s.onload = () => (lib.listo() ? resolve() : fallar());
      s.onerror = fallar;
      document.head.appendChild(s);
    });
  }
  return libreriasPendientes[clave];
}

// Calienta una librería sin esperar ni molestar si falla (se vuelve a intentar cuando haga falta)
function precargarLibreria(clave) {
  cargarLibreria(clave).catch(() => {});
}

const TEXTO_ERROR_LIBRERIA = "No se pudo cargar un componente. Revisa tu conexión e inténtalo de nuevo.";
