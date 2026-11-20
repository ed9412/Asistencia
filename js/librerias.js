// ===============================
// LIBRERÍAS EXTERNAS BAJO DEMANDA
// Las más pesadas (escáner, QR, gráficos, PDF, captura) ya no se descargan al abrir la app:
// se piden la primera vez que una pantalla las necesita. Primero se usa la copia local de la carpeta libs/; si falla, se pide al CDN.
// ===============================

const LIBRERIAS = {
  lector:  { local: "libs/html5-qrcode.min.js", url: "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js", listo: () => typeof Html5Qrcode !== "undefined" },
  qr:      { local: "libs/qrcode.min.js", url: "https://cdn.jsdelivr.net/npm/qrcode@1.4.4/build/qrcode.min.js", listo: () => typeof QRCode !== "undefined" },
  grafico: { local: "libs/chart.umd.js", url: "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js", listo: () => typeof Chart !== "undefined" },
  captura: { local: "libs/html2canvas.min.js", url: "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", listo: () => typeof html2canvas !== "undefined" },
  pdf:     { local: "libs/jspdf.umd.min.js", url: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", listo: () => !!window.jspdf }
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
      // Pide un script; llama a ok si carga y la librería queda lista, y a mal si no
      const pedir = (src, ok, mal) => {
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        s.onload = () => (lib.listo() ? ok() : mal());
        s.onerror = mal;
        document.head.appendChild(s);
      };
      // 1.º copia local; 2.º CDN
      const cdn = () => pedir(lib.url, resolve, fallar);
      if (lib.local) pedir(lib.local, resolve, cdn); else cdn();
    });
  }
  return libreriasPendientes[clave];
}

// Calienta una librería sin esperar ni molestar si falla (se vuelve a intentar cuando haga falta)
function precargarLibreria(clave) {
  cargarLibreria(clave).catch(() => {});
}

const TEXTO_ERROR_LIBRERIA = "No se pudo cargar un componente. Revisa tu conexión e inténtalo de nuevo.";
