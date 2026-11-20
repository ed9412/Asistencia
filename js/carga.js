// ===============================
// INDICADORES DE CARGA
// - Acciones que escriben o preparan una pantalla: velo + animación y la app queda bloqueada
//   (evita doble clic y estados a medias).
// - Consultas que solo muestran datos: barra fina arriba, sin bloquear (se puede seguir navegando).
// Ambos esperan un instante antes de aparecer, para que lo rápido no parpadee.
// ===============================

const CARGA_RETRASO_MS = 180;
// Si una consulta tarda más que esto, además de la barra sale un aviso con texto
// (para que nadie piense que no pasa nada y vuelva a pulsar)
const CARGA_LARGA_MS = 1500;
const cargaEstado = { bloqueos: 0, ligeras: 0, timerBloqueo: null, timerBarra: null, avisos: new Map(), siguienteAviso: 1 };

function cargaAviso() {
  const el = $("avisoCarga");
  if (!el) return;
  const textos = Array.from(cargaEstado.avisos.values());
  if (textos.length) {
    if ($("avisoCargaTexto")) $("avisoCargaTexto").textContent = textos[textos.length - 1];
    el.classList.add("visible");
    el.setAttribute("aria-hidden", "false");
  } else {
    el.classList.remove("visible");
    el.setAttribute("aria-hidden", "true");
  }
}

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
function iniciarCarga({ bloquear = false, texto = "Cargando", textoLargo = "Cargando los datos… puede tardar unos segundos" } = {}) {
  let terminada = false;
  let idAviso = 0;
  let timerAviso = null;

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
    idAviso = cargaEstado.siguienteAviso++;
    timerAviso = setTimeout(() => {
      cargaEstado.avisos.set(idAviso, textoLargo);
      cargaAviso();
    }, CARGA_LARGA_MS);
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
      clearTimeout(timerAviso);
      cargaEstado.avisos.delete(idAviso);
      cargaAviso();
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
// Consultas sin bloqueo: nunca hay dos iguales a la vez.
// - modo "ignorar": si ya hay una en curso, el clic extra se descarta (botones y filas tocables).
// - modo "unir" (por defecto): si el usuario cambia un filtro mientras carga, se repite UNA vez al
//   terminar con lo último pedido; da igual cuántos clics haga, nunca se acumulan peticiones.
function envolverConCarga(nombre, opciones) {
  const original = globalThis[nombre];
  if (typeof original !== "function" || original.__conCarga) return;
  const enCurso = !opciones.bloquear;
  let corriendo = null;
  let pendiente = null;
  const envuelta = function (...args) {
    if (!enCurso) return conCarga(opciones, () => original.apply(this, args));
    if (corriendo) {
      if (opciones.repetidos !== "ignorar") pendiente = { esto: this, args };
      return corriendo;
    }
    const ejecutar = (esto, a) => {
      corriendo = conCarga(opciones, () => original.apply(esto, a)).finally(() => {
        corriendo = null;
        if (pendiente) {
          const p = pendiente;
          pendiente = null;
          ejecutar(p.esto, p.args).catch(() => {});
        }
      });
      return corriendo;
    };
    return ejecutar(this, args);
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
    crearUsuario: "Creando la cuenta",
    guardarNombreUsuario: "Guardando",
    guardarRolDetalle: "Guardando",
    enviarCorreoPasswordDetalle: "Enviando el correo",
    cambiarMiPassword: "Cambiando la contraseña",
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

  // No bloquean: consultas que rellenan una pantalla (con el aviso que sale si tardan)
  const ligeras = {
    cargarHistorial: "Cargando las listas… puede tardar unos segundos",
    abrirListaHistorial: "Abriendo la lista…",
    generarReporte: "Preparando el reporte… puede tardar unos segundos",
    generarAlertas: "Calculando las alertas… puede tardar unos segundos",
    cargarDashboard: "Cargando el gráfico… puede tardar unos segundos",
    verEstudiantesDeMateria: "Cargando los estudiantes…",
    buscarEstudiantes: "Cargando los estudiantes…",
    cargarMaterias: "Cargando las materias…",
    cargarUsuarios: "Cargando los usuarios…",
    exportar: "Preparando la exportación… puede tardar unos segundos",
    exportarBusqueda: "Preparando la exportación…"
  };
  // Estas se descartan si ya hay una igual en curso (clic repetido); las demás se unen en una sola repetición
  const ignorarRepetidos = ["abrirListaHistorial", "verEstudiantesDeMateria", "exportar", "exportarBusqueda"];
  Object.keys(ligeras).forEach(n => envolverConCarga(n, {
    bloquear: false, textoLargo: ligeras[n], repetidos: ignorarRepetidos.includes(n) ? "ignorar" : "unir"
  }));
})();
