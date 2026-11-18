// ===============================
// INDICADORES DE CARGA
// - Acciones que escriben o preparan una pantalla: velo + animación y la app queda bloqueada
//   (evita doble clic y estados a medias).
// - Consultas que solo muestran datos: barra fina arriba, sin bloquear (se puede seguir navegando).
// Ambos esperan un instante antes de aparecer, para que lo rápido no parpadee.
// ===============================

const CARGA_RETRASO_MS = 180;
const cargaEstado = { bloqueos: 0, ligeras: 0, timerBloqueo: null, timerBarra: null };

function cargaBloquear(activar, texto) {
  const velo = $("cargando");
  const app = $("app");
  if (!velo) return;
  if (activar) {
    if ($("cargandoTexto")) $("cargandoTexto").textContent = texto || "Cargando";
    velo.classList.add("visible");
    velo.setAttribute("aria-hidden", "false");
    if (app) { app.inert = true; app.setAttribute("aria-busy", "true"); }
  } else {
    velo.classList.remove("visible");
    velo.setAttribute("aria-hidden", "true");
    if (app) { app.inert = false; app.removeAttribute("aria-busy"); }
  }
}

function cargaBarra(activar) {
  const barra = $("barraCarga");
  if (!barra) return;
  if (activar) barra.classList.add("activa"); else barra.classList.remove("activa");
}

// Devuelve la función que hay que llamar al terminar
function iniciarCarga({ bloquear = false, texto = "Cargando" } = {}) {
  let terminada = false;

  if (bloquear) {
    cargaEstado.bloqueos++;
    if (cargaEstado.bloqueos === 1) {
      cargaEstado.timerBloqueo = setTimeout(() => cargaBloquear(true, texto), CARGA_RETRASO_MS);
    } else if ($("cargandoTexto")) {
      $("cargandoTexto").textContent = texto;
    }
  } else {
    cargaEstado.ligeras++;
    if (cargaEstado.ligeras === 1) {
      cargaEstado.timerBarra = setTimeout(() => cargaBarra(true), CARGA_RETRASO_MS);
    }
  }

  return function terminarCarga() {
    if (terminada) return;
    terminada = true;
    if (bloquear) {
      cargaEstado.bloqueos = Math.max(0, cargaEstado.bloqueos - 1);
      if (cargaEstado.bloqueos === 0) {
        clearTimeout(cargaEstado.timerBloqueo);
        cargaBloquear(false);
      }
    } else {
      cargaEstado.ligeras = Math.max(0, cargaEstado.ligeras - 1);
      if (cargaEstado.ligeras === 0) {
        clearTimeout(cargaEstado.timerBarra);
        cargaBarra(false);
      }
    }
  };
}

async function conCarga(opciones, tarea) {
  const terminar = iniciarCarga(opciones);
  try {
    return await tarea();
  } finally {
    terminar();
  }
}

// Envuelve funciones globales ya definidas (las llamadas desde el HTML y desde otras funciones
// buscan el nombre en el ámbito global al ejecutarse, así que usan la versión envuelta).
function envolverConCarga(nombre, opciones) {
  const original = globalThis[nombre];
  if (typeof original !== "function" || original.__conCarga) return;
  const envuelta = function (...args) {
    return conCarga(opciones, () => original.apply(this, args));
  };
  envuelta.__conCarga = true;
  globalThis[nombre] = envuelta;
}

(function instalarIndicadoresDeCarga() {
  // Bloquean: escriben datos o dejan lista una pantalla
  const bloquean = {
    login: "Entrando",
    initApp: "Abriendo tu sesión",
    iniciarLista: "Preparando la lista",
    cerrarLista: "Guardando la lista",
    confirmarCorreccion: "Guardando el cambio",
    continuarListaDesdeHistorial: "Abriendo la lista",
    importarConfirmar: "Importando estudiantes",
    recalcularTodosResumenes: "Recalculando resúmenes",
    crearDocente: "Creando la cuenta",
    guardarDocentesMateria: "Guardando",
    guardarMiNombre: "Guardando",
    crearMateria: "Guardando",
    guardarEdicionMateria: "Guardando",
    abrirEditarEstudiante: "Abriendo el estudiante",
    crearEstudiante: "Guardando",
    guardarEdicionEstudiante: "Guardando",
    asignar: "Asignando",
    descargarCarnetsMateria: "Generando los carnets",
    exportarQRPNG: "Preparando la imagen",
    exportarQRPDF: "Preparando el PDF"
  };
  Object.keys(bloquean).forEach(n => envolverConCarga(n, { bloquear: true, texto: bloquean[n] }));

  // No bloquean: consultas que rellenan una pantalla
  ["cargarHistorial", "abrirListaHistorial", "generarReporte", "generarAlertas", "cargarDashboard",
   "buscarEstudiantes", "cargarMaterias", "cargarUsuarios", "exportar", "exportarBusqueda"
  ].forEach(n => envolverConCarga(n, { bloquear: false }));
})();
