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
  materiasScreen: "materias", adminScreen: "admin", estudianteNuevo: "estudiantes/nuevo",
  historialDetalle: "asistencias/lista",
  materiaNueva: "materias/nueva", materiaAsignar: "materias/asignar",
  materiasMasivo: "estudiantes/materias", pasoCurso: "estudiantes/pasar-curso",
  adminUsuarios: "admin/usuarios", usuarioNuevo: "admin/usuarios/nuevo", adminMantenimiento: "admin/mantenimiento"
};

const TITULO_DE = {
  lista: "Pasar lista", reportes: "Reportes", alertasScreen: "Alertas de asistencia",
  dashboard: "Gráfico", materiasScreen: "Materias", adminScreen: "Administración",
  estudianteNuevo: "Nuevo estudiante", materiasMasivo: "Materias en masa", pasoCurso: "Pasar de curso", ficha: "Estudiante", historialDetalle: "Lista guardada",
  materiaNueva: "Nueva materia", materiaAsignar: "Asignar estudiante", materiaDetalle: "Materia",
  adminUsuarios: "Usuarios y roles", usuarioNuevo: "Nuevo usuario", usuarioDetalle: "Usuario", adminMantenimiento: "Mantenimiento"
};

// A dónde lleva «Atrás» si no hay historial dentro de la app (por ejemplo, al abrir un enlace directo)
const PADRE_DE = {
  lista: "hoy", ficha: "estudiantes", estudianteNuevo: "estudiantes", materiasMasivo: "estudiantes", pasoCurso: "estudiantes", historialDetalle: "historial",
  reportes: "mas", alertasScreen: "mas", dashboard: "mas", materiasScreen: "mas", adminScreen: "mas",
  materiaNueva: "materiasScreen", materiaAsignar: "materiasScreen", materiaDetalle: "materiasScreen",
  adminUsuarios: "adminScreen", usuarioNuevo: "adminUsuarios", usuarioDetalle: "adminUsuarios", adminMantenimiento: "adminScreen"
};

// Pestaña de la barra inferior que queda marcada para cada pantalla
function raizDe(id) {
  if (PANTALLAS_RAIZ.includes(id)) return id;
  if (id === "lista") return "hoy";
  if (id === "ficha" || id === "estudianteNuevo" || id === "materiasMasivo" || id === "pasoCurso") return "estudiantes";
  if (id === "historialDetalle") return "historial";
  return "mas";
}

let pantallaActual = "";
let paramActual = "";
let fichaCedula = "";      // estudiante mostrado (en pantalla propia o en el panel de PC)
let detalleCedula = "";    // estudiante abierto en el panel de detalle (solo PC)
const posicionesScroll = {};

function rutaDePantalla(id, param) {
  if (id === "ficha") return `#/estudiantes/${encodeURIComponent(param || "")}`;
  if (id === "materiaDetalle") return `#/materias/${encodeURIComponent(param || "")}`;
  if (id === "usuarioDetalle") return `#/admin/usuarios/${encodeURIComponent(param || "")}`;
  return `#/${RUTA_DE[id] || "hoy"}`;
}

// Lee la dirección actual: { id, param }
function leerRuta(hash) {
  const partes = String(hash || "").replace(/^#\/?/, "").split("/").filter(Boolean);
  if (partes[0] === "estudiantes" && partes[1] === "nuevo") return { id: "estudianteNuevo", param: "" };
  if (partes[0] === "estudiantes" && partes[1] === "materias") return { id: "materiasMasivo", param: "" };
  if (partes[0] === "estudiantes" && partes[1] === "pasar-curso") return { id: "pasoCurso", param: "" };
  if (partes[0] === "estudiantes" && partes[1]) {
    let ced = partes[1];
    try { ced = decodeURIComponent(ced); } catch (e) { /* se deja tal cual */ }
    return { id: "ficha", param: ced };
  }
  if (partes[0] === "materias" && partes[1] && !["nueva", "asignar"].includes(partes[1])) {
    let mid = partes[1];
    try { mid = decodeURIComponent(mid); } catch (e) { /* se deja tal cual */ }
    return { id: "materiaDetalle", param: mid };
  }
  if (partes[0] === "admin" && partes[1] === "usuarios" && partes[2] && partes[2] !== "nuevo") {
    let uid = partes[2];
    try { uid = decodeURIComponent(uid); } catch (e) { /* se deja tal cual */ }
    return { id: "usuarioDetalle", param: uid };
  }
  const completa = partes.join("/");
  const exacto = Object.keys(RUTA_DE).find(k => RUTA_DE[k] === completa);
  if (exacto) return { id: exacto, param: "" };
  if (partes[0] === "asistencias") return { id: "historial", param: "" };
  const id = Object.keys(RUTA_DE).find(k => RUTA_DE[k] === partes[0]);
  return { id: id || "hoy", param: "" };
}

// Pantalla con la que arranca la app tras iniciar sesión
function rutaInicial() {
  return leerRuta(location.hash);
}

function marcarNavActivo(id) {
  const raiz = raizDe(id);
  const exacta = id === "ficha" || id === "estudianteNuevo" || id === "materiasMasivo" || id === "pasoCurso" ? "estudiantes" : id === "lista" ? "hoy" : id === "historialDetalle" ? "historial" : id;
  document.querySelectorAll(".navmovil button").forEach(b => {
    b.classList.toggle("activo", b.dataset.ir === raiz);
  });
  document.querySelectorAll(".navlateral button").forEach(b => {
    b.classList.toggle("activo", b.dataset.ir === exacta);
  });
}

// Cabecera común de las pantallas principales: fecha o dato de apoyo, título e iniciales del usuario
function tituloRaiz(id) {
  if (id === "hoy") return "Pasar lista";
  if (id === "estudiantes") return currentUserRole === "admin" ? "Estudiantes" : "Mis estudiantes";
  if (id === "historial") return "Asistencias";
  return "Más";
}

function actualizarCabeceraRaiz(id) {
  const cab = $("cabRaiz");
  if (!cab) return;
  const raiz = PANTALLAS_RAIZ.includes(id);
  cab.style.display = raiz ? "" : "none";
  document.body.classList.toggle("con-cabraiz", raiz);
  const ini = inicialesUsuario();
  $("appbarAvatar").textContent = ini;
  if (!raiz) return;
  $("cabRaizTitulo").textContent = tituloRaiz(id);
  $("cabRaizAvatar").textContent = ini;
  $("btnFechaHoy").style.display = id === "hoy" ? "" : "none";
  let sub;
  if (id === "hoy") sub = textoFecha(fechaEfectiva());
  else if (id === "mas") {
    const nombre = typeof nombreActor === "function" ? nombreActor() : "";
    sub = `${nombre ? nombre + " · " : ""}${textoRol(currentUserRole)}`;
  } else sub = textoFecha(fechaLocalISO());
  $("cabRaizSub").textContent = sub;
}

function actualizarBarraSuperior(id) {
  const barra = $("appbar");
  if (!barra) return;
  const conBarra = !PANTALLAS_RAIZ.includes(id) && id !== "pendienteScreen" && id !== "loginScreen";
  barra.style.display = conBarra ? "" : "none";
  document.body.classList.toggle("con-appbar", conBarra);
  if (conBarra) $("appbarTitulo").textContent = TITULO_DE[id] || "";

  actualizarCabeceraRaiz(id);

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
  // El detalle de una lista solo existe mientras haya una lista abierta
  if (id === "historialDetalle" && !detalleCtx) { id = "historial"; opts = { ...opts, conservar: false }; }
  if (id !== "historialDetalle") { detalleCtx = null; detalleRegistros = []; }
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

  // La selección múltiple solo vive en la lista y en la pantalla de materias en masa
  if (id !== "estudiantes" && id !== "materiasMasivo" && (modoSel || seleccion.size)) salirSeleccion(false);
  if (id !== "estudiantes" && id !== "ficha") detalleCedula = "";
  if (id === "estudiantes" && !desdeHistorial) { detalleCedula = ""; vaciarDetalle(); }
  if (id === "hoy" && !desdeHistorial) fechaSel = "";
  if (id !== "hoy" && typeof cerrarMenuUsuario === "function") cerrarMenuUsuario();
  pantallaActual = id;
  paramActual = param;
  marcarNavActivo(id);
  actualizarBarraSuperior(id);
  actualizarBarraSel();

  if (id === "lista") sincronizarModoRegistro();
  if (id === "hoy") cargarHoy();
  else if (id === "mas") pintarMas();
  else if (id === "ficha") await pintarFicha(param);
  else if (id === "materiaDetalle") pintarMateriaDetalle(param);
  else if (id === "materiasMasivo") await pintarMateriasMasivo();
  else if (id === "pasoCurso") await pintarPasoCurso();
  else if (id === "adminUsuarios") cargarUsuarios();
  else if (id === "usuarioDetalle") pintarUsuarioDetalle(param);
  else if (id === "usuarioNuevo") $("nuevoUsuarioRol").value = "profesor";

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
let fechaSel = "";   // fecha de la lista; vacío = hoy

function fechaEfectiva() {
  return fechaSel || fechaLocalISO();
}

function textoFecha(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  const f = new Date(a, m - 1, d);
  const dia = DIAS[f.getDay()];
  return `${dia[0].toUpperCase()}${dia.slice(1)} ${d} de ${MESES[m - 1]}`;
}

// El calendario queda escondido: casi siempre se pasa lista el mismo día
function alternarFechaHoy() {
  const panel = $("hoyFechaPanel");
  const abrir = panel.style.display === "none";
  panel.style.display = abrir ? "" : "none";
  $("btnFechaHoy").setAttribute("aria-expanded", abrir ? "true" : "false");
  if (abrir) {
    const inp = $("hoyFechaSel");
    inp.value = fechaEfectiva();
    inp.max = fechaLocalISO();
    if (typeof inp.focus === "function") inp.focus();
  }
}

function cambiarFechaHoy(valor) {
  if (!valor) return;
  if (valor > fechaLocalISO()) {
    showMessage("No se puede pasar lista de una fecha futura.", "error");
    $("hoyFechaSel").value = fechaEfectiva();
    return;
  }
  fechaSel = valor === fechaLocalISO() ? "" : valor;
  cargarHoy();
}

function fechaHoyVolver() {
  fechaSel = "";
  $("hoyFechaSel").value = fechaLocalISO();
  cargarHoy();
}

async function cargarHoy() {
  const fecha = fechaEfectiva();
  const esHoy = fecha === fechaLocalISO();
  actualizarCabeceraRaiz("hoy");
  const aviso = $("hoyAviso");
  aviso.style.display = esHoy ? "none" : "";
  aviso.innerHTML = esHoy ? "" : `<span>Estás pasando lista de otro día.</span><button class="small secondary" onclick="fechaHoyVolver()">Volver a hoy</button>`;
  $("btnFechaHoy").classList.toggle("activo", !esHoy);

  const cont = $("hoyMaterias");
  if (!materiasLista.length) {
    const esAdmin = currentUserRole === "admin";
    cont.innerHTML = `<div class="vacio"><p>${esAdmin
      ? "Todavía no hay materias. Crea la primera para empezar a pasar lista."
      : "Todavía no tienes materias asignadas. Pide a un administrador que te asigne una."}</p>${esAdmin
      ? `<button onclick="mostrar('materiasScreen')">Ir a Materias</button>` : ""}</div>`;
    return;
  }

  const token = ++hoyToken;

  const pintar = estados => {
    cont.innerHTML = materiasLista.map(m => {
      const en = listaActiva && listaCtx && listaCtx.materiaId === m.id;
      const r = estados[m.id];
      let chip = `<span class="chip chip-gris">Comprobando…</span>`;
      let boton = `<button onclick="pasarListaDe(${escJs(m.id)})">Pasar lista</button>`;
      if (en) {
        chip = `<span class="chip chip-acento">En curso · ${esc(listaCtx.fecha)}</span>`;
        boton = `<button onclick="pasarListaDe(${escJs(m.id)})">Continuar lista</button>`;
      } else if (r === null) {
        chip = `<span class="chip chip-gris">Sin pasar</span>`;
      } else if (r === "error") {
        chip = `<span class="chip chip-gris">Sin datos</span>`;
      } else if (r) {
        const p = (r.presente || 0) + (r.tardanza || 0) + (r.justificado || 0);
        const t = p + (r.falta || 0);
        chip = `<span class="chip chip-ok">Guardada · ${p} de ${t}</span>`;
        boton = `<button class="secondary" onclick="pasarListaDe(${escJs(m.id)})">Abrir lista</button>`;
      }
      return `<section class="tarjeta-materia"><div class="tarjeta-cab"><h3>${esc(m.nombre)}</h3>${chip}</div>${boton}</section>`;
    }).join("");
  };

  const estados = {};
  materiasLista.forEach(m => { estados[m.id] = undefined; });
  pintar(estados);

  await Promise.all(materiasLista.map(async m => {
    try {
      const snap = await db.collection("resumenes_dia").doc(`${m.id}_${fecha}`).get();
      estados[m.id] = snap.exists ? snap.data() : null;
    } catch (e) {
      estados[m.id] = "error";
    }
  }));
  if (token === hoyToken && pantallaActual === "hoy") pintar(estados);
}

// Abre la lista de una materia directamente desde «Hoy»
async function pasarListaDe(materiaId) {
  const fecha = fechaEfectiva();
  const continuar = listaActiva;
  await mostrar("lista");
  if (continuar) return;
  $("materiaLista").value = materiaId;
  $("fechaLista").value = fecha;
  await iniciarLista();
}

// Las materias llegan después de abrir la app: se repinta «Hoy» cuando están
function alCargarMaterias() {
  if (pantallaActual === "hoy") cargarHoy();
}

// ===============================
// PANTALLA «MÁS»
// ===============================

// ===============================
// MATERIAS: DETALLE
// ===============================

let materiaDetalleId = "";

function nombreMateriaDetalle() {
  const m = materiasLista.find(x => x.id === materiaDetalleId);
  return m ? m.nombre : "";
}

function pintarMateriaDetalle(id) {
  materiaDetalleId = id || materiaDetalleId;
  const m = materiasLista.find(x => x.id === materiaDetalleId);
  if (!m) { if (pantallaActual === "materiaDetalle") volver(); return; }
  const docentes = (m.profesores || []).map(uid => {
    const u = usuariosMap[uid];
    return u ? (u.nombre || u.email) : "cuenta desconocida";
  });
  $("matDetNombre").textContent = m.nombre;
  $("matDetInfo").textContent = "Docentes: " + (docentes.length ? docentes.join(", ") : "ninguno");
}

function pintarMas() {
  actualizarCabeceraRaiz("mas");
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
      <div id="asist-${destino}"><button class="secondary" onclick="cargarAsistenciaFicha(${escJs(destino)})">Ver asistencia</button></div>
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
    cont.innerHTML = `<button class="secondary" onclick="cargarAsistenciaFicha(${escJs(destino)})">Reintentar</button>`;
    showMessage("No se pudo calcular la asistencia: " + traducirErrorFirebase(e), "error");
  }
}

function verQRFicha() {
  const e = buscarEstudianteEnCache(fichaCedula);
  if (e) mostrarQR(e.cedula, `${e.nombres} ${e.apellidos}`, e.grado);
}
function editarFicha() { abrirEditarEstudiante(fichaCedula); }
function eliminarFicha() { eliminarEstudiante(fichaCedula); }

// ===============================
// MENÚ DEL USUARIO (círculo con las iniciales)
// ===============================

function abrirMenuUsuario(ev) {
  const menu = $("menuUsuario");
  if (menu.style.display !== "none") { cerrarMenuUsuario(); return; }
  const nombre = typeof nombreActor === "function" ? nombreActor() : "";
  $("menuUsuarioNombre").textContent = nombre || (auth.currentUser && auth.currentUser.email) || "";
  $("menuUsuarioRol").textContent = `${nombre && auth.currentUser ? auth.currentUser.email + " · " : ""}${textoRol(currentUserRole)}`;
  $("menuUsuarioFondo").style.display = "";
  menu.style.display = "";
  // Se coloca justo debajo del círculo, alineado a su borde derecho
  const btn = ev && (ev.currentTarget || ev.target);
  if (btn && btn.getBoundingClientRect && typeof window.innerWidth === "number") {
    const r = btn.getBoundingClientRect();
    menu.style.top = `${Math.round(r.bottom + 8)}px`;
    menu.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  }
}

function cerrarMenuUsuario() {
  const menu = $("menuUsuario");
  if (menu) menu.style.display = "none";
  const fondo = $("menuUsuarioFondo");
  if (fondo) fondo.style.display = "none";
}

document.addEventListener("keydown", e => { if (e.key === "Escape") cerrarMenuUsuario(); });

// ===============================
// PANTALLA «PASAR LISTA» (lista en curso): progreso, pestañas y modo de registro
// Se apoya en las funciones de lista.js sin cambiar su lógica.
// ===============================

function verPanelLista(nombre) {
  ["presentes", "faltantes", "justificados"].forEach(n => {
    const panel = $("panel-" + n);
    if (panel) panel.classList.toggle("activo", n === nombre);
  });
  document.querySelectorAll("#listaTabs button").forEach(b => {
    b.classList.toggle("activo", b.dataset.panel === nombre);
  });
}

function sincronizarModoRegistro() {
  const modo = $("modoRegistro").value || "presente";
  document.querySelectorAll("#modoSegmento button").forEach(b => {
    b.classList.toggle("activo", b.dataset.modo === modo);
  });
}

function elegirModoRegistro(modo) {
  $("modoRegistro").value = modo;
  sincronizarModoRegistro();
}

// Progreso de la lista en curso y números de las pestañas
function actualizarProgresoLista() {
  const total = estudiantesMateria.length;
  let asisten = 0, justif = 0;
  marcas.forEach(m => {
    if (ESTADOS_ASISTE.includes(m.estado)) asisten++;
    if (m.estado === "justificado") justif++;
  });
  const faltan = estudiantesMateria.filter(e => estadoEnLista(e.cedula) === "falta").length;
  $("tabPresentes").textContent = String(asisten);
  $("tabFaltantes").textContent = String(faltan);
  $("tabJustificados").textContent = String(justif);
  $("progresoTexto").textContent = total ? `${asisten} de ${total} presentes` : "";
  $("progresoRelleno").style.width = total ? `${Math.round((asisten / total) * 100)}%` : "0%";
}

["actualizarPresentes", "actualizarJustificados", "actualizarFaltantes"].forEach(nombre => {
  const original = globalThis[nombre];
  globalThis[nombre] = function () {
    const r = original.apply(this, arguments);
    actualizarProgresoLista();
    return r;
  };
});

// Al reiniciar la pantalla de lista vuelve la pestaña «Presentes» y el modo «Presente»
const resetUIListaBase = resetUILista;
resetUILista = function () {
  resetUIListaBase();
  verPanelLista("presentes");
  actualizarProgresoLista();
  sincronizarModoRegistro();
};
