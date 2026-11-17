// ===============================
// HISTORIAL DE LISTAS
// Muestra las listas de asistencia (una por materia y fecha), permite abrirlas,
// corregir errores, continuarlas y, si eres admin, anularlas.
// El listado sale de los resúmenes diarios (pocas lecturas); el detalle de una
// lista lee solo los registros de esa materia y fecha.
// ===============================

const HIST_DIAS_POR_DEFECTO = 30;
let histListas = [];          // resúmenes del listado actual (ordenados)
let histMostrar = HIST_PAGE;  // cuántas tarjetas se enseñan
let detalleCtx = null;        // { materia, fecha } de la lista abierta
let detalleRegistros = [];    // registros de la lista abierta

function textoConteos(c) {
  return `✅ ${c.presente || 0} · ⏰ ${c.tardanza || 0} · 📝 ${c.justificado || 0} · ❌ ${c.falta || 0}`;
}

// Avisa si hay una lista sin guardar en este dispositivo
function pintarListaEnCurso() {
  const cont = $("historialEnCurso");
  if (!cont) return;
  cont.innerHTML = "";
  if (!listaActiva || !listaCtx) return;

  const p = document.createElement("div");
  p.className = "info-activa";
  p.innerHTML = `<p>🟢 <strong>Lista en curso:</strong> ${esc(listaCtx.materiaNombre)} · ${esc(formatarFechaUI(listaCtx.fecha))}</p>` +
    (hayCambiosSinGuardar() ? "<p>Tiene cambios sin guardar.</p>" : "");
  const b = document.createElement("button");
  b.className = "small";
  b.textContent = "Volver a la lista";
  b.onclick = () => mostrar("lista");
  p.appendChild(b);
  cont.appendChild(p);
}

async function cargarHistorial() {
  if (!validarRangoFechas()) return;

  const materia = $("materiaHistorial").value;
  let inicio = $("filtroFechaInicio").value;
  let fin = $("filtroFechaFin").value;

  // Sin fechas: los últimos 30 días (evita cargar todo el historial)
  if (!inicio && !fin) {
    inicio = fechaHaceDias(HIST_DIAS_POR_DEFECTO);
    $("filtroFechaInicio").value = inicio;
  }

  cerrarDetalleHistorial();
  pintarListaEnCurso();
  limpiarLista("historialLista");
  $("btnHistMas").style.display = "none";

  try {
    let docs = await consultarResumenes({ materiaIds: materia ? [materia] : null, desde: inicio });
    if (fin) docs = docs.filter(d => d.fecha <= fin);

    docs.sort((a, b) => b.fecha.localeCompare(a.fecha) || nombreMateria(a).localeCompare(nombreMateria(b)));
    histListas = docs;
    histMostrar = HIST_PAGE;
    pintarListasHistorial();

    if (docs.length === 0) {
      $("historialLista").innerHTML = "<li>No hay listas en este periodo." +
        (currentUserRole === "admin" ? " Si ya pasaste listas antes de actualizar, pulsa «Recalcular resúmenes» en Admin." : "") + "</li>";
    }
  } catch (e) {
    showMessage("No se pudo cargar el historial: " + traducirErrorFirebase(e), "error");
  }
}

function pintarListasHistorial() {
  const ul = $("historialLista");
  ul.innerHTML = "";
  const hoy = fechaLocalISO();

  histListas.slice(0, histMostrar).forEach(d => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>${esc(nombreMateria(d))}</strong><br>
      📅 ${esc(formatarFechaUI(d.fecha))}${d.fecha === hoy ? " · <span class='acento'>Hoy</span>" : ""}<br>
      <small>${esc(textoConteos(d))}</small><br>`;
    const b = document.createElement("button");
    b.className = "small";
    b.textContent = "Ver / corregir";
    b.onclick = () => abrirListaHistorial(d.materia, d.fecha);
    li.appendChild(b);
    ul.appendChild(li);
  });

  $("btnHistMas").style.display = histListas.length > histMostrar ? "block" : "none";
}

function historialMostrarMas() {
  histMostrar += HIST_PAGE;
  pintarListasHistorial();
}

// ---------- Detalle de una lista ----------

async function abrirListaHistorial(materiaId, fecha) {
  detalleCtx = { materia: materiaId, fecha };
  await refrescarDetalleHistorial();
  const el = $("historialDetalle");
  if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function refrescarDetalleHistorial() {
  if (!detalleCtx) return;
  const { materia, fecha } = detalleCtx;
  try {
    const snap = await db.collection("asistencias")
      .where("materia", "==", materia)
      .where("fecha", "==", fecha)
      .get();

    detalleRegistros = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.apellidos || "").localeCompare(b.apellidos || "") || (a.nombres || "").localeCompare(b.nombres || ""));

    if (listaSinRegistros()) return;
    pintarDetalleHistorial();
    actualizarTarjetaDeLista(materia, fecha);
  } catch (e) {
    showMessage("No se pudo abrir la lista: " + traducirErrorFirebase(e), "error");
  }
}

// Si la lista ya no tiene registros (p. ej. fue anulada) se cierra el detalle
function listaSinRegistros() {
  if (detalleRegistros.length > 0) return false;
  cerrarDetalleHistorial();
  showMessage("Esa lista no tiene registros.", "info");
  return true;
}

// Mantiene al día los contadores de la tarjeta sin volver a leer el listado
function actualizarTarjetaDeLista(materia, fecha) {
  const d = histListas.find(x => x.materia === materia && x.fecha === fecha);
  if (!d) return;
  const c = { presente: 0, tardanza: 0, justificado: 0, falta: 0 };
  detalleRegistros.forEach(r => { c[estadoDe(r)]++; });
  Object.assign(d, c);
  pintarListasHistorial();
}

function pintarDetalleHistorial() {
  const { materia, fecha } = detalleCtx;
  const esAdmin = currentUserRole === "admin";
  const resumen = resumenEstados(detalleRegistros);
  const { pct } = textoResumen(resumen);

  $("detalleTitulo").textContent = `${materiasMap[materia] || detalleRegistros[0].materiaNombre || materia} · ${formatarFechaUI(fecha)}`;
  $("detalleResumen").textContent = `${textoConteos(resumen)} · asistencia ${pct}`;

  const aviso = $("detalleAviso");
  if (!esAdmin && fecha !== fechaLocalISO()) {
    aviso.textContent = "Lista de una fecha anterior: puedes cambiar las faltas (por ejemplo para justificarlas). Otros cambios los hace un administrador.";
    aviso.style.display = "block";
  } else {
    aviso.style.display = "none";
  }

  const ul = $("detalleLista");
  ul.innerHTML = "";

  detalleRegistros.forEach(r => {
    const estado = estadoDe(r);
    const nombre = `${r.nombres || ""} ${r.apellidos || ""}`.trim();
    const li = document.createElement("li");
    li.innerHTML = `${ESTADOS[estado].icono} <strong>${esc(r.cedula)}</strong> · ${esc(ESTADOS[estado].texto)}<br>${esc(nombre)}<br>` +
      (r.motivo ? `<small>Motivo: ${esc(r.motivo)}</small><br>` : "") +
      (r.hora ? `<small>Hora: ${esc(r.hora)}</small><br>` : "") +
      `<small>Docente: ${esc(nombreDocente(r))}</small>` +
      (r.corregido ? `<br><small>Corregido por: ${esc(nombreDeEmail(r.corregidoPor) || r.corregidoPor || "")}</small>` : "") +
      "<br>";

    if (puedeCorregirRegistro(r)) {
      const ctx = { tipo: "historial", docId: r.id, materia: r.materia, fecha: r.fecha, nombre, estadoActual: estado };
      if (estado !== "justificado") {
        const bj = document.createElement("button");
        bj.className = "small";
        bj.textContent = "📝 Justificar";
        bj.onclick = () => abrirCorreccion({ ...ctx, estadoSugerido: "justificado" });
        li.appendChild(bj);
      }
      const bc = document.createElement("button");
      bc.className = "small secondary";
      bc.textContent = "Cambiar estado";
      bc.onclick = () => abrirCorreccion({ ...ctx });
      li.appendChild(bc);
    }
    ul.appendChild(li);
  });

  $("btnAnularLista").style.display = esAdmin ? "block" : "none";
  $("historialDetalle").style.display = "block";
}

function cerrarDetalleHistorial() {
  detalleCtx = null;
  detalleRegistros = [];
  const el = $("historialDetalle");
  if (el) el.style.display = "none";
}

// Abre la lista en "Pasar lista" para completarla (añade a quien no tenga registro)
async function continuarListaDesdeHistorial() {
  if (!detalleCtx) return;
  const { materia, fecha } = detalleCtx;
  if (listaActiva) return showMessage("Ya tienes una lista en curso: termínala o cancélala primero.", "error");
  if (!materiasMap[materia]) return showMessage("Esa materia no está entre tus materias.", "error");

  await mostrar("lista");
  $("materiaLista").value = materia;
  $("fechaLista").value = fecha;
  await iniciarLista();
}

// Solo admin: elimina todos los registros de una lista (y su resumen)
async function anularLista() {
  if (currentUserRole !== "admin") return showMessage("Solo un administrador puede anular listas.", "error");
  if (!detalleCtx || detalleRegistros.length === 0) return;
  if (listaActiva) return showMessage("Termina o cancela la lista en curso antes de anular otra.", "error");

  const { materia, fecha } = detalleCtx;
  const nombreMat = materiasMap[materia] || materia;
  const n = detalleRegistros.length;

  if (!confirm(`Vas a ANULAR la lista de «${nombreMat}» del ${formatarFechaUI(fecha)}.\n\nSe eliminarán sus ${n} registros y no se puede deshacer.\n\n¿Continuar?`)) return;

  const password = await pedirPassword();
  if (!password) return;
  try {
    await reautenticar(password);
  } catch (e) {
    return showMessage("Contraseña incorrecta.", "error");
  }

  try {
    const ids = detalleRegistros.map(r => r.id);
    for (let i = 0; i < ids.length; i += 400) {
      const batch = db.batch();
      ids.slice(i, i + 400).forEach(id => batch.delete(db.collection("asistencias").doc(id)));
      if (i + 400 >= ids.length) batch.delete(db.collection("resumenes_dia").doc(`${materia}_${fecha}`));
      await batch.commit();
    }

    try {
      await db.collection("auditoria").add({
        accion: "anular_lista", materia, materiaNombre: nombreMat, fecha, cantidad: n,
        por: auth.currentUser.email, en: serverTs()
      });
    } catch (e) { /* la auditoría no es crítica */ }

    histListas = histListas.filter(d => !(d.materia === materia && d.fecha === fecha));
    cerrarDetalleHistorial();
    pintarListasHistorial();
    showMessage(`Lista anulada (${n} registros eliminados).`, "success");
  } catch (e) {
    showMessage("No se pudo anular la lista: " + traducirErrorFirebase(e), "error");
  }
}

// ---------- Exportar lo que muestra el filtro del historial ----------

async function exportar() {
  if (!validarRangoFechas()) return;
  const materia = $("materiaHistorial").value;
  let inicio = $("filtroFechaInicio").value;
  const fin = $("filtroFechaFin").value;
  if (!inicio && !fin) inicio = fechaHaceDias(HIST_DIAS_POR_DEFECTO);

  try {
    if (currentUserRole === "admin") await cargarUsuariosCache();
    const registros = await consultarAsistencias({
      materiaIds: materia ? [materia] : null,
      desde: inicio,
      hasta: fin
    });
    if (registros.length === 0) return showMessage("Sin datos para exportar.", "error");

    registros.sort((a, b) => b.fecha.localeCompare(a.fecha));
    descargarCSV(construirCSV(registros), `asistencias_${inicio || "inicio"}_${fin || "hoy"}.csv`);
    showMessage(`Exportados ${registros.length} registros.`, "success");
  } catch (e) {
    showMessage("Error al exportar: " + traducirErrorFirebase(e), "error");
  }
}
