// ===============================
// NAVEGACIÓN POR PANTALLAS
// Rutas con # (por ejemplo #/estudiantes/12345678), historial del navegador
// (el botón «atrás» del móvil funciona) y botón «Atrás» en la barra superior.
// Se carga después de nucleo.js: envuelve a mostrar() sin cambiar su lógica.
// ===============================

// Pantallas principales: tienen su opción en la barra inferior y no llevan «Atrás»
const PANTALLAS_RAIZ = ["hoy", "estudiantes", "historial", "mas"];

// id de pantalla -> tramo de la dirección (#/tramo)
const RUTA_DE = {
  hoy: "hoy", estudiantes: "estudiantes", historial: "asistencias", mas: "mas",
  lista: "lista", reportes: "reportes", alertasScreen: "alertas", dashboard: "panel",
  materiasScreen: "materias", adminScreen: "admin", estudianteNuevo: "estudiantes/nuevo"
};

const TITULO_DE = {
  lista: "Pasar lista", reportes: "Reportes", alertasScreen: "Alertas de asistencia",
  dashboard: "Panel", materiasScreen: "Materias", adminScreen: "Administración",
  estudianteNuevo: "Nuevo estudiante", ficha: "Estudiante"
};

// A dónde lleva «Atrás» si no hay historial dentro de la app (por ejemplo, al abrir un enlace directo)
const PADRE_DE = {
  lista: "hoy", ficha: "estudiantes", estudianteNuevo: "estudiantes",
  reportes: "mas", alertasScreen: "mas", dashboard: "mas", materiasScreen: "mas", adminScreen: "mas"
};

// Pestaña de la barra inferior que queda marcada para cada pantalla
function raizDe(id) {
  if (PANTALLAS_RAIZ.includes(id)) return id;
  if (id === "lista") return "hoy";
  if (id === "ficha" || id === "estudianteNuevo") return "estudiantes";
  return "mas";
}

let pantallaActual = "";
let paramActual = "";
let fichaCedula = "";      // estudiante mostrado (en pantalla propia o en el panel de PC)
let detalleCedula = "";    // estudiante abierto en el panel de detalle (solo PC)
const posicionesScroll = {};

function rutaDePantalla(id, param) {
  if (id === "ficha") return `#/estudiantes/${encodeURIComponent(param || "")}`;
  return `#/${RUTA_DE[id] || "hoy"}`;
}

// Lee la dirección actual: { id, param }
function leerRuta(hash) {
  const partes = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (partes[0] === "estudiantes" && partes[1] === "nuevo") return { id: "estudianteNuevo", param: "" };
  if (partes[0] === "estudiantes" && partes[1]) {
    let ced = partes[1];
    try { ced = decodeURIComponent(ced); } catch (e) { /* se deja tal cual */ }
    return { id: "ficha", param: ced };
  }
  const id = Object.keys(RUTA_DE).find(k => RUTA_DE[k] === partes[0]);
  return { id: id || "hoy", param: "" };
}

// Pantalla con la que arranca la app tras iniciar sesión
function rutaInicial() {
  return leerRuta(location.hash);
}

function marcarNavActivo(id) {
  const raiz = raizDe(id);
  const exacta = id === "ficha" || id === "estudianteNuevo" ? "estudiantes" : id;
  document.querySelectorAll(".navmovil button").forEach(b => {
    b.classList.toggle("activo", b.dataset.ir === raiz);
  });
  document.querySelectorAll(".navlateral button").forEach(b => {
    b.classList.toggle("activo", b.dataset.ir === exacta);
  });
}

function actualizarBarraSuperior(id) {
  const barra = $("appbar");
  if (!barra) return;
  const conBarra = !PANTALLAS_RAIZ.includes(id) && id !== "pendienteScreen" && id !== "loginScreen";
  barra.style.display = conBarra ? "" : "none";
  document.body.classList.toggle("con-appbar", conBarra);
  if (conBarra) $("appbarTitulo").textContent = TITULO_DE[id] || "";

  const fab = $("fabNuevoEst");
  if (fab) fab.style.display = (id === "estudiantes" && fab.dataset.admin === "1") ? "" : "none";
}

// Vuelve a la pantalla anterior de la app (o a la pantalla «padre» si no hay historial propio)
function volver() {
  const n = (history.state && history.state.n) || 0;
  if (n > 0) {
    history.back();
  } else {
    mostrar(PADRE_DE[pantallaActual] || "hoy", { reemplazar: true });
  }
}

const mostrarBase = mostrar;

// Misma función que usa todo el código (menús, botones…), ahora con historial
mostrar = async function (id, opts = {}) {
  const desdeHistorial = !!opts.desdeHistorial;
  const param = opts.param || "";

  if (pantallaActual) posicionesScroll[pantallaActual + "|" + paramActual] = window.scrollY;

  const ok = await mostrarBase(id, {
    conservar: desdeHistorial || id === "ficha" || !!opts.conservar
  });
  if (ok === false) return false;

  const ruta = rutaDePantalla(id, param);
  if (!desdeHistorial) {
    const n = (history.state && history.state.n) || 0;
    const estado = { id, param };
    if (opts.reemplazar || !pantallaActual) {
      history.replaceState({ ...estado, n: opts.reemplazar ? 0 : n }, "", ruta);
    } else if (ruta !== location.hash) {
      history.pushState({ ...estado, n: PANTALLAS_RAIZ.includes(id) ? 0 : n + 1 }, "", ruta);
    }
  }

  if (id !== "estudiantes" && id !== "ficha") detalleCedula = "";
  if (id === "estudiantes" && !desdeHistorial) { detalleCedula = ""; vaciarDetalle(); }
  pantallaActual = id;
  paramActual = param;
  marcarNavActivo(id);
  actualizarBarraSuperior(id);

  if (id === "hoy") cargarHoy();
  else if (id === "mas") pintarMas();
  else if (id === "ficha") await pintarFicha(param);

  const guardado = desdeHistorial ? posicionesScroll[id + "|" + param] : 0;
  window.scrollTo(0, guardado || 0);
  return true;
};

// Botón «atrás» del navegador o del móvil
window.addEventListener("popstate", ev => {
  if ($("app").style.display === "none") return;
  const e = ev.state && ev.state.id ? ev.state : leerRuta(location.hash);
  mostrar(e.id, { param: e.param, desdeHistorial: true });
});

// ===============================
// PANTALLA «HOY»
// ===============================

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function iniciales(nombres, apellidos) {
  const a = (normalizarTexto(nombres)[0] || "");
  const b = (normalizarTexto(apellidos)[0] || "");
  return (a + b).toUpperCase() || "?";
}

function inicialesUsuario() {
  const nombre = normalizarTexto(typeof nombreActor === "function" ? nombreActor() : "");
  if (nombre) {
    const p = nombre.split(" ");
    return ((p[0][0] || "") + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  }
  const mail = (auth.currentUser && auth.currentUser.email) || "?";
  return mail[0].toUpperCase();
}

let hoyToken = 0;

async function cargarHoy() {
  const d = new Date();
  $("hoyFecha").textContent = `${DIAS[d.getDay()][0].toUpperCase()}${DIAS[d.getDay()].slice(1)} ${d.getDate()} de ${MESES[d.getMonth()]}`;
  $("hoyAvatar").textContent = inicialesUsuario();

  const cont = $("hoyMaterias");
  if (!materiasLista.length) {
    const esAdmin = currentUserRole === "admin";
    cont.innerHTML = `<div class="vacio"><p>${esAdmin
      ? "Todavía no hay materias. Crea la primera para empezar a pasar lista."
      : "Todavía no tienes materias asignadas. Pide a un administrador que te asigne una."}</p>${esAdmin
      ? `<button onclick="mostrar('materiasScreen')">Ir a Materias</button>` : ""}</div>`;
    return;
  }

  const hoy = fechaLocalISO();
  const token = ++hoyToken;

  const pintar = estados => {
    cont.innerHTML = materiasLista.map(m => {
      const en = listaActiva && listaCtx && listaCtx.materiaId === m.id;
      const r = estados[m.id];
      let chip = `<span class="chip chip-gris">Comprobando…</span>`;
      let boton = `<button onclick="pasarListaDe('${esc(m.id)}')">Pasar lista</button>`;
      if (en) {
        chip = `<span class="chip chip-acento">En curso</span>`;
        boton = `<button onclick="pasarListaDe('${esc(m.id)}')">Continuar lista</button>`;
      } else if (r === null) {
        chip = `<span class="chip chip-gris">Sin pasar</span>`;
      } else if (r === "error") {
        chip = `<span class="chip chip-gris">Sin datos</span>`;
      } else if (r) {
        const p = (r.presente || 0) + (r.tardanza || 0) + (r.justificado || 0);
        const t = p + (r.falta || 0);
        chip = `<span class="chip chip-ok">Guardada · ${p} de ${t}</span>`;
        boton = `<button class="secondary" onclick="pasarListaDe('${esc(m.id)}')">Abrir lista</button>`;
      }
      return `<section class="tarjeta-materia"><div class="tarjeta-cab"><h3>${esc(m.nombre)}</h3>${chip}</div>${boton}</section>`;
    }).join("");
  };

  const estados = {};
  materiasLista.forEach(m => { estados[m.id] = undefined; });
  pintar(estados);

  await Promise.all(materiasLista.map(async m => {
    try {
      const snap = await db.collection("resumenes_dia").doc(`${m.id}_${hoy}`).get();
      estados[m.id] = snap.exists ? snap.data() : null;
    } catch (e) {
      estados[m.id] = "error";
    }
  }));
  if (token === hoyToken && pantallaActual === "hoy") pintar(estados);
}

// Abre la lista de una materia directamente desde «Hoy»
async function pasarListaDe(materiaId) {
  const continuar = listaActiva;
  await mostrar("lista");
  if (continuar) return;
  $("materiaLista").value = materiaId;
  $("fechaLista").value = fechaLocalISO();
  await iniciarLista();
}

// Las materias llegan después de abrir la app: se repinta «Hoy» cuando están
function alCargarMaterias() {
  if (pantallaActual === "hoy") cargarHoy();
}

// ===============================
// PANTALLA «MÁS»
// ===============================

function pintarMas() {
  $("masAvatar").textContent = inicialesUsuario();
  const nombre = typeof nombreActor === "function" ? nombreActor() : "";
  $("masRol").textContent = `${nombre ? nombre + " · " : ""}${textoRol(currentUserRole)}`;
}

// ===============================
// FICHA DEL ESTUDIANTE
// ===============================

function hayPanelDetalle() {
  return typeof window.matchMedia === "function" && window.matchMedia("(min-width: 1100px)").matches;
}

// En PC la ficha se abre en el panel de la derecha; en móvil, en su propia pantalla
function abrirFicha(cedula) {
  if (pantallaActual === "estudiantes" && hayPanelDetalle()) {
    detalleCedula = cedula;
    marcarFilaSeleccionada();
    return pintarFicha(cedula, "estDetalle");
  }
  return mostrar("ficha", { param: cedula });
}

function vaciarDetalle() {
  const d = $("estDetalle");
  if (d) d.innerHTML = `<div class="detalle-vacio"><p>Elige un estudiante de la lista para ver su ficha.</p></div>`;
}

function marcarFilaSeleccionada() {
  const ul = $("listaEstudiantes");
  if (!ul) return;
  Array.from(ul.children).forEach(li => {
    if (li.dataset) li.classList.toggle("seleccionada", !!detalleCedula && li.dataset.ced === detalleCedula);
  });
}

function buscarEstudianteEnCache(cedula) {
  return cacheEst.estudiantes.find(e => e.cedula === cedula) || null;
}

async function pintarFicha(cedula, destino = "fichaContenido") {
  const cont = $(destino);
  fichaCedula = cedula;
  try {
    await cargarCacheEstudiantes();
  } catch (e) {
    cont.innerHTML = `<div class="card"><p>No se pudo cargar el estudiante: ${esc(traducirErrorFirebase(e))}</p></div>`;
    return;
  }

  const est = buscarEstudianteEnCache(cedula);
  const rels = cacheEst.relaciones.filter(r => r.cedula === cedula && materiasMap[r.materiaId]);
  // Un docente solo ve estudiantes de sus propias materias
  if (!est || (currentUserRole !== "admin" && !rels.length)) {
    cont.innerHTML = `<div class="card vacio"><p>Este estudiante no está disponible.</p><button class="secondary" onclick="volver()">Volver</button></div>`;
    return;
  }

  const nombre = `${est.nombres} ${est.apellidos}`;
  const esAdmin = currentUserRole === "admin";

  const fila = (icono, etiqueta, valor) => `
    <div class="dato"><div class="dato-icono">${icono}</div><div><div class="dato-etiqueta">${etiqueta}</div><div class="dato-valor">${valor}</div></div></div>`;
  const iTel = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h3l1.5 4-2 1.5a11 11 0 005 5l1.5-2 4 1.5v3a2 2 0 01-2 2A13 13 0 014 6a2 2 0 012-2z"/></svg>`;
  const iMail = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7l8 6 8-6"/></svg>`;
  const iRep = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="9" r="3"/><path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5M16 6.5a3 3 0 010 5.5M18 14.5c1.7.6 2.8 2 3.2 4.5"/></svg>`;

  let contacto = "";
  if (est.telefono) contacto += fila(iTel, "Teléfono", `<a href="tel:${esc(est.telefono)}">${esc(est.telefono)}</a>`);
  if (est.correo) contacto += fila(iMail, "Correo", `<a href="mailto:${esc(est.correo)}">${esc(est.correo)}</a>`);
  if (est.representante) contacto += fila(iRep, "Representante", esc(est.representante));
  if (!contacto) contacto = `<p class="subtitle">Sin datos de contacto${esAdmin ? ". Usa «Editar» para añadirlos" : ""}.</p>`;

  const materias = rels.map(r => materiasMap[r.materiaId]).sort((a, b) => a.localeCompare(b));
  const chips = materias.length
    ? materias.map(m => `<span class="chip chip-acento">${esc(m)}</span>`).join("")
    : `<p class="subtitle">Sin materias asignadas.</p>`;

  cont.innerHTML = `
    <div class="ficha-cab">
      <span class="avatar avatar-enorme" aria-hidden="true">${esc(iniciales(est.nombres, est.apellidos))}</span>
      <div class="ficha-id">
        <h2>${esc(nombre)}</h2>
        <p class="subtitle">${esc(est.grado || "Sin grado")} · Cédula ${esc(est.cedula)}</p>
      </div>
      <div class="ficha-acciones">
        <button class="secondary" onclick="verQRFicha()">Ver QR</button>
        ${esAdmin ? `<button onclick="editarFicha()">Editar</button>` : ""}
      </div>
    </div>
    <section class="card"><h4>Contacto</h4>${contacto}</section>
    <section class="card"><h4>Materias</h4><div class="chips">${chips}</div></section>
    <section class="card">
      <h4>Asistencia · últimos 30 días</h4>
      <div id="asist-${destino}"><button class="secondary" onclick="cargarAsistenciaFicha('${destino}')">Ver asistencia</button></div>
    </section>
    ${esAdmin ? `<button class="danger ficha-eliminar" onclick="eliminarFicha()">Eliminar estudiante</button>` : ""}
  `;
}

// Tras editar o eliminar, buscarEstudiantes() avisa: se repinta la ficha o se vuelve a la lista
function refrescarFichaSiAbierta() {
  if (pantallaActual === "ficha") {
    if (!buscarEstudianteEnCache(paramActual)) { volver(); return; }
    pintarFicha(paramActual);
  } else if (pantallaActual === "estudiantes" && detalleCedula) {
    if (!buscarEstudianteEnCache(detalleCedula)) { detalleCedula = ""; vaciarDetalle(); }
    else pintarFicha(detalleCedula, "estDetalle");
  }
  marcarFilaSeleccionada();
}

// Porcentaje de asistencia del estudiante por materia (se calcula al pulsar el botón: son lecturas)
async function cargarAsistenciaFicha(destino) {
  const cont = $("asist-" + destino);
  const cedula = fichaCedula;
  if (!cont || !cedula) return;
  cont.innerHTML = `<p class="subtitle">Calculando…</p>`;
  try {
    const materiaIds = cacheEst.relaciones.filter(r => r.cedula === cedula && materiasMap[r.materiaId]).map(r => r.materiaId);
    if (!materiaIds.length) { cont.innerHTML = `<p class="subtitle">Sin materias asignadas.</p>`; return; }
    const registros = await consultarAsistencias({ materiaIds, cedula, desde: fechaHaceDias(30) });
    if (fichaCedula !== cedula) return;   // se abrió otro estudiante mientras tanto
    if (!registros.length) { cont.innerHTML = `<p class="subtitle">Sin registros en los últimos 30 días.</p>`; return; }

    const filas = materiaIds
      .map(id => ({ id, regs: registros.filter(r => r.materia === id) }))
      .filter(g => g.regs.length)
      .sort((a, b) => materiasMap[a.id].localeCompare(materiasMap[b.id]))
      .map(g => {
        const r = resumenEstados(g.regs);
        const pct = Math.round(r.porcentaje);
        const nivel = pct >= 85 ? "nivel-ok" : pct >= 70 ? "nivel-medio" : "nivel-bajo";
        const nota = r.base < MIN_REGISTROS_ALERTA ? " · pocas clases para valorar" : "";
        const just = r.justificado ? ` · ${r.justificado} justificada(s) aparte` : "";
        return `<div class="asist-fila ${nivel}">
          <div class="asist-cab"><span>${esc(materiasMap[g.id])}</span><strong>${pct} %</strong></div>
          <div class="asist-pista"><div class="asist-relleno" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>
          <small>${r.asistidas} de ${r.base} clases${just}${nota}</small>
        </div>`;
      });
    cont.innerHTML = filas.join("") || `<p class="subtitle">Sin registros en los últimos 30 días.</p>`;
  } catch (e) {
    cont.innerHTML = `<button class="secondary" onclick="cargarAsistenciaFicha('${destino}')">Reintentar</button>`;
    showMessage("No se pudo calcular la asistencia: " + traducirErrorFirebase(e), "error");
  }
}

function verQRFicha() {
  const e = buscarEstudianteEnCache(fichaCedula);
  if (e) mostrarQR(e.cedula, `${e.nombres} ${e.apellidos}`);
}
function editarFicha() { abrirEditarEstudiante(fichaCedula); }
function eliminarFicha() { eliminarEstudiante(fichaCedula); }
