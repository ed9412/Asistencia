// Service worker: guarda la app para abrirla sin conexión.
// Los datos de Firestore se guardan aparte (persistencia de Firestore en nucleo.js).
const VERSION = "asistencia-v18";
const ARCHIVOS = [
  "./libs/html5-qrcode.min.js",
  "./libs/qrcode.min.js",
  "./libs/chart.umd.js",
  "./libs/jspdf.umd.min.js",
  "./libs/html2canvas.min.js",
  "./", "./index.html", "./style.css?v=18", "./manifest.json", "./favicon.ico",
  "./iconos/icono-192.png", "./iconos/icono-512.png",
  "./js/tema.js?v=18", "./js/nucleo.js?v=18", "./js/librerias.js?v=18", "./js/sesion.js?v=18",
  "./js/materias-estudiantes.js?v=18", "./js/lista.js?v=18", "./js/reportes.js?v=18",
  "./js/historial.js?v=18", "./js/admin.js?v=18", "./js/resumenes.js?v=18", "./js/importar.js?v=18",
  "./js/carnets.js?v=18", "./js/masivo.js?v=18", "./js/navegacion.js?v=18", "./js/carga.js?v=18", "./js/inicio.js?v=18",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"
];

self.addEventListener("install", ev => {
  ev.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(ARCHIVOS.map(u => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", ev => {
  const req = ev.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const propio = url.origin === location.origin;
  const firebaseJs = url.hostname === "www.gstatic.com" && url.pathname.includes("/firebasejs/");
  if (!propio && !firebaseJs) return; // Firestore, Auth y demás van directos a la red

  if (req.mode === "navigate") {
    // Página: red primero (siempre la última versión) y, sin red, la guardada
    ev.respondWith(fetch(req).then(r => {
      const copia = r.clone(); caches.open(VERSION).then(c => c.put("./index.html", copia)); return r;
    }).catch(() => caches.match("./index.html")));
    return;
  }
  // Scripts, estilos e iconos: lo guardado primero; si no está, red y se guarda
  ev.respondWith(caches.match(req).then(g => g || fetch(req).then(r => {
    if (r.ok) { const copia = r.clone(); caches.open(VERSION).then(c => c.put(req, copia)); }
    return r;
  })));
});
