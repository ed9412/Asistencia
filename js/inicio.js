// ===============================
// INICIO DE LA APLICACIÓN
// Este archivo se carga el último: todas las funciones ya existen cuando
// Firebase avisa de que hay (o no) una sesión abierta.
// ===============================

auth.onAuthStateChanged(async user => {
  if (user && $("app").style.display === "none") {
    await initApp();
  }
});

// ===============================
// EVENTOS
// ===============================

document.addEventListener("DOMContentLoaded", () => {
  aplicarTema(temaVigente);   // pone el icono correcto en el botón de tema

  // Campos numéricos: solo dígitos
  ["cedula", "cedulaAsignar", "manualCedula", "cedulaReporte"].forEach(id => {
    if ($(id)) $(id).addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); });
  });

  // Enter para enviar
  ["email", "password"].forEach(id => {
    if ($(id)) $(id).addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  });
  if ($("manualCedula")) {
    $("manualCedula").addEventListener("keydown", e => { if (e.key === "Enter") registrarManual(); });
  }
  // Enter ejecuta la acción del campo (búsquedas y formularios de un solo campo)
  const alPulsarEnter = {
    searchEstudianteText: () => buscarEstudiantes(),
    cedulaReporte: () => generarReporte(),
    fechaInicioReporte: () => generarReporte(),
    fechaFinReporte: () => generarReporte(),
    filtroFechaInicio: () => cargarHistorial(),
    filtroFechaFin: () => cargarHistorial(),
    fechaLista: () => iniciarLista(),
    materiaNombre: () => crearMateria(),
    miNombre: () => guardarMiNombre()
  };
  Object.keys(alPulsarEnter).forEach(id => {
    if ($(id)) $(id).addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); alPulsarEnter[id](); }
    });
  });

  // Estudiantes: se filtra mientras se escribe (usa datos ya cargados, sin lecturas nuevas)
  let esperaBusqueda;
  if ($("searchEstudianteText")) {
    $("searchEstudianteText").addEventListener("input", () => {
      clearTimeout(esperaBusqueda);
      esperaBusqueda = setTimeout(() => buscarEstudiantes(), 250);
    });
  }
  if ($("searchEstudianteMateria")) {
    $("searchEstudianteMateria").addEventListener("change", () => buscarEstudiantes());
  }

  if ($("correccionPassword")) {
    $("correccionPassword").addEventListener("keydown", e => { if (e.key === "Enter") confirmarCorreccion(); });
  }
});


// ===============================
// MODO SIN CONEXIÓN (PWA)
// ===============================

function actualizarAvisoConexion() {
  const el = document.getElementById("avisoSinConexion");
  if (el) el.style.display = (typeof navigator !== "undefined" && navigator.onLine === false) ? "block" : "none";
}
if (typeof window.addEventListener === "function") window.addEventListener("online", actualizarAvisoConexion);
window.addEventListener("offline", actualizarAvisoConexion);
actualizarAvisoConexion();

if (typeof navigator !== "undefined" && "serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => { /* sin soporte: la app funciona igual, solo con red */ });
  });
}
