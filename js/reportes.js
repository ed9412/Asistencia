
// ===============================
// CONSULTA DE ASISTENCIAS SEGÚN EL ROL
// ===============================

// Devuelve los registros que cumplen los filtros.
//  - Admin: puede consultar todas las materias o una selección.
//  - Docente: SIEMPRE se consulta materia por materia (solo las suyas); así lo exigen las reglas.
// Con materia + rango de fechas se usa el índice compuesto (materia, fecha desc).
async function consultarAsistencias({ materiaIds = null, cedula = "", desde = "", hasta = "" } = {}) {
  const esAdmin = currentUserRole === "admin";
  let ids = materiaIds;

  if (!esAdmin) {
    ids = (ids && ids.length ? ids : materiasLista.map(m => m.id)).filter(id => materiasMap[id]);
  }

  const enRango = r => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta);
  const consultas = [];

  if (ids === null) {
    // Admin, todas las materias
    let q = db.collection("asistencias");
    if (cedula) {
      q = q.where("cedula", "==", cedula);
    } else {
      if (desde) q = q.where("fecha", ">=", desde);
      if (hasta) q = q.where("fecha", "<=", hasta);
    }
    consultas.push(q.get());
  } else {
    ids.forEach(id => {
      let q = db.collection("asistencias").where("materia", "==", id);
      if (cedula) {
        q = q.where("cedula", "==", cedula);        // solo igualdades: no necesita índice
      } else if (desde || hasta) {
        if (desde) q = q.where("fecha", ">=", desde);
        if (hasta) q = q.where("fecha", "<=", hasta);
        q = q.orderBy("fecha", "desc");
      }
      consultas.push(q.get());
    });
  }

  const snaps = await Promise.all(consultas);
  const registros = [];
  snaps.forEach(snap => snap.forEach(doc => {
    const r = { id: doc.id, ...doc.data() };
    if (enRango(r)) registros.push(r);
  }));
  return registros;
}

function etiquetaEstado(registro) {
  const e = estadoDe(registro);
  return `${ESTADOS[e].icono} ${ESTADOS[e].texto}`;
}

// ===============================
// HISTORIAL (paginado)
// ===============================

async function cargarHistorial(reiniciar = true) {
  if (reiniciar) {
    if (!validarRangoFechas()) return;
    const materia = $("materiaHistorial").value;
    if (currentUserRole !== "admin" && !materia) {
      return showMessage("Selecciona una materia.", "error");
    }
    histFiltro = { materia, inicio: $("filtroFechaInicio").value, fin: $("filtroFechaFin").value };
    histCursor = null;
    limpiarLista("historialLista");
    $("btnHistMas").style.display = "none";
  }
  if (!histFiltro) return;

  try {
    let query = db.collection("asistencias");

    if (histFiltro.materia) query = query.where("materia", "==", histFiltro.materia);
    if (histFiltro.inicio && histFiltro.fin) {
      query = query.where("fecha", ">=", histFiltro.inicio).where("fecha", "<=", histFiltro.fin);
    }

    query = query.orderBy("fecha", "desc").limit(HIST_PAGE);
    if (histCursor) query = query.startAfter(histCursor);

    const snap = await query.get();
    const ul = $("historialLista");

    if (snap.empty && reiniciar) {
      ul.innerHTML = "<li>No hay registros para mostrar con estos filtros.</li>";
      return;
    }

    const esAdmin = currentUserRole === "admin";

    snap.forEach(doc => {
      const d = doc.data();
      const estado = estadoDe(d);
      const li = document.createElement("li");

      li.innerHTML = `
        ${esc(d.cedula)}<br>
        <strong>${esc(d.nombres || "")} ${esc(d.apellidos || "")}</strong><br>
        <strong>Materia: ${esc(nombreMateria(d))}</strong><br>
        <strong>Fecha: ${esc(formatarFechaUI(d.fecha))}</strong><br>
        Estado: ${esc(etiquetaEstado(d))}<br>
        ${d.motivo ? `Motivo: ${esc(d.motivo)}<br>` : ""}
        Hora: ${esc(d.hora || "Sin hora")}<br>
        Docente: ${esc(d.profesor || "No registrado")}
      `;

      // Un docente solo corrige faltas; el admin puede cambiar cualquier estado
      if (estado === "falta" || esAdmin) {
        const b = document.createElement("button");
        b.className = "secondary";
        b.textContent = estado === "falta" ? "Corregir registro" : "Cambiar estado";
        b.onclick = () => abrirCorreccion({
          tipo: "historial",
          docId: doc.id,
          materia: d.materia,
          fecha: d.fecha,
          nombre: `${d.nombres || ""} ${d.apellidos || ""}`.trim(),
          estadoActual: estado
        });
        li.appendChild(b);
      }

      ul.appendChild(li);
    });

    if (snap.docs.length > 0) histCursor = snap.docs[snap.docs.length - 1];
    $("btnHistMas").style.display = snap.size === HIST_PAGE ? "block" : "none";

  } catch (error) {
    showMessage("No se pudo cargar el historial: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// REPORTES
// ===============================

function textoResumen(r) {
  const partes = [`✅ ${r.presente} presentes`, `⏰ ${r.tardanza} tardanzas`, `📝 ${r.justificado} justificadas`, `❌ ${r.falta} faltas`];
  const pct = r.porcentaje === null ? "sin datos" : `${r.porcentaje.toFixed(1)}%`;
  return { partes: partes.join(" · "), pct };
}

async function generarReporte() {
  const contenedor = $("reporte");
  clearFieldError("cedulaReporte");

  const ced = $("cedulaReporte").value.trim();
  const matId = $("materiaReporte").value || "todas";
  const fInicio = $("fechaInicioReporte").value;
  const fFin = $("fechaFinReporte").value;

  if (ced && !validarCedula(ced)) {
    showFieldError("cedulaReporte", "Cédula inválida.");
    return;
  }

  if (!ced && matId === "todas" && !fInicio && !fFin) {
    contenedor.innerHTML = "<p style='color:red'>Indica al menos una cédula, una materia o un rango de fechas.</p>";
    return;
  }

  if (fInicio && fFin && fInicio > fFin) {
    contenedor.innerHTML = "<p style='color:red'>La fecha de inicio no puede ser mayor que la de fin.</p>";
    return;
  }

  contenedor.innerHTML = "<p>Buscando...</p>";

  try {
    const registros = await consultarAsistencias({
      materiaIds: matId === "todas" ? null : [matId],
      cedula: ced,
      desde: fInicio,
      hasta: fFin
    });

    const resultados = registros.sort((a, b) =>
      b.fecha.localeCompare(a.fecha) || (a.apellidos || "").localeCompare(b.apellidos || "")
    );
    resultadosBusquedaActual = resultados;

    if (resultados.length === 0) {
      contenedor.innerHTML = "<p>No se encontraron registros con esos criterios.</p>";
      return;
    }

    const resumen = resumenEstados(resultados);
    const { partes, pct } = textoResumen(resumen);
    const MAX_FILAS = 200;

    let html = `<hr>
      <p><strong>${resultados.length}</strong> registros · asistencia <strong>${pct}</strong></p>
      <p class="subtitle">${partes}</p>
      <button class="secondary" onclick="exportarBusqueda()">Exportar a CSV</button><ul>`;

    resultados.slice(0, MAX_FILAS).forEach(x => {
      html += `<li>
        <strong>${esc(x.cedula)}</strong> - ${esc(x.nombres || "")} ${esc(x.apellidos || "")}<br>
        <strong>Materia:</strong> ${esc(nombreMateria(x))} | <strong>Fecha:</strong> ${esc(formatarFechaUI(x.fecha))}<br>
        <strong>Estado:</strong> ${esc(etiquetaEstado(x))}${x.motivo ? `<br><strong>Motivo:</strong> ${esc(x.motivo)}` : ""}
      </li>`;
    });
    html += "</ul>";

    if (resultados.length > MAX_FILAS) {
      html += `<p class="subtitle">Se muestran ${MAX_FILAS} de ${resultados.length}. El CSV incluye todos.</p>`;
    }

    contenedor.innerHTML = html;
  } catch (e) {
    contenedor.innerHTML = "<p style='color:red'>Error al obtener datos: " + esc(traducirErrorFirebase(e)) + "</p>";
  }
}

// ===============================
// EXPORTACIÓN CSV
// ===============================

// Protege contra comillas y contra fórmulas de Excel (=, +, -, @)
function csvCelda(valor) {
  let s = String(valor === null || valor === undefined ? "" : valor);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function construirCSV(registros) {
  const cabecera = ["Cedula", "Nombres", "Apellidos", "Fecha", "Materia", "Estado", "Motivo", "Hora", "Docente"];
  const filas = registros.map(x => [
    x.cedula, x.nombres, x.apellidos, x.fecha, nombreMateria(x),
    ESTADOS[estadoDe(x)].texto, x.motivo, x.hora, x.profesor
  ].map(csvCelda).join(";"));
  return "﻿" + cabecera.join(";") + "\n" + filas.join("\n");
}

function descargarCSV(contenido, nombreArchivo) {
  const blob = new Blob([contenido], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportarBusqueda() {
  if (!resultadosBusquedaActual || resultadosBusquedaActual.length === 0) {
    return showMessage("No hay datos para exportar.", "error");
  }
  descargarCSV(construirCSV(resultadosBusquedaActual), "reporte_busqueda.csv");
  showMessage("Reporte exportado exitosamente.", "success");
}

// Exporta según la materia y las fechas del historial (o todo, con confirmación)
async function exportar() {
  if (!validarRangoFechas()) return;
  const materia = $("materiaHistorial").value;
  const inicio = $("filtroFechaInicio").value;
  const fin = $("filtroFechaFin").value;

  if (currentUserRole !== "admin" && !materia) return showMessage("Selecciona una materia.", "error");
  if (!inicio && !fin && !confirm("No elegiste fechas: se exportará TODO el historial. ¿Continuar?")) return;

  try {
    const registros = await consultarAsistencias({
      materiaIds: materia ? [materia] : null,
      desde: inicio,
      hasta: fin
    });
    if (registros.length === 0) return showMessage("Sin datos para exportar.", "error");

    registros.sort((a, b) => b.fecha.localeCompare(a.fecha));
    descargarCSV(construirCSV(registros), inicio && fin ? `asistencias_${inicio}_${fin}.csv` : "asistencias_completo.csv");
    showMessage(`Exportados ${registros.length} registros.`, "success");
  } catch (e) {
    showMessage("Error al exportar: " + traducirErrorFirebase(e), "error");
  }
}

// ===============================
// ALERTAS (por estudiante y materia)
// ===============================

async function generarAlertas() {
  const ul = $("alertas");
  ul.innerHTML = "<li>Calculando...</li>";

  const periodo = $("alertasPeriodo").value;
  const umbral = Number($("alertasUmbral").value);

  try {
    const registros = await consultarAsistencias({
      materiaIds: null,
      desde: periodo !== "todo" ? fechaHaceDias(Number(periodo)) : ""
    });

    const grupos = new Map();
    registros.forEach(x => {
      const clave = `${x.cedula}|${x.materia}`;
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(x);
    });

    const alertas = [];
    grupos.forEach(lista => {
      const r = resumenEstados(lista);
      if (r.base >= MIN_REGISTROS_ALERTA && r.porcentaje < umbral) alertas.push({ r, ref: lista[0] });
    });
    alertas.sort((a, b) => a.r.porcentaje - b.r.porcentaje);

    ul.innerHTML = "";

    if (alertas.length === 0) {
      ul.innerHTML = "<li>Sin alertas en este periodo.</li>";
      return;
    }

    alertas.forEach(({ r, ref }) => {
      const li = document.createElement("li");
      li.innerHTML = `⚠️ <strong>${esc(ref.cedula)}</strong><br>${esc((ref.nombres || "") + " " + (ref.apellidos || ""))}<br>
        ${esc(nombreMateria(ref))}<br>
        Asistencia: ${r.porcentaje.toFixed(1)}% (${r.asistidas}/${r.base})${r.justificado ? ` · ${r.justificado} justificada(s) aparte` : ""}`;
      ul.appendChild(li);
    });
  } catch (e) {
    ul.innerHTML = "";
    showMessage("No se pudieron calcular las alertas: " + traducirErrorFirebase(e), "error");
  }
}

// ===============================
// DASHBOARD
// ===============================

async function cargarDashboard(manual = false) {
  const periodo = $("dashboardRango").value;
  const matSel = $("dashboardMateria").value || "todas";

  if (typeof Chart === "undefined") {
    return showMessage("No se pudo cargar la librería de gráficos.", "error");
  }

  try {
    // Lee los resúmenes diarios (pocos documentos) en lugar de todas las asistencias
    const docs = await consultarResumenes({
      materiaIds: matSel === "todas" ? null : [matSel],
      desde: periodo !== "todo" ? fechaHaceDias(Number(periodo)) : ""
    });

    const r = resumenDeConteos(sumarResumenes(docs));
    const { pct } = textoResumen(r);
    $("dashResumen").textContent = r.total
      ? `${r.total} registros · asistencia ${pct}${JUSTIFICADO_CUENTA_EN_CONTRA ? "" : " (las justificadas no cuentan en contra)"}`
      : (currentUserRole === "admin"
          ? "Sin resúmenes en este periodo. Si ya había asistencias guardadas, pulsa «Recalcular resúmenes» en Admin."
          : "Sin registros en este periodo.");

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart($("grafico"), {
      type: "pie",
      options: { color: colorTextoGrafico() },
      data: {
        labels: ["Presentes", "Tardanzas", "Justificadas", "Faltas"],
        datasets: [{
          data: [r.presente, r.tardanza, r.justificado, r.falta],
          backgroundColor: ["#16a34a", "#f59e0b", "#2563eb", "#dc2626"]
        }]
      }
    });

    if (manual) showMessage("Dashboard actualizado.", "success");
  } catch (e) {
    showMessage("No se pudo cargar el dashboard: " + traducirErrorFirebase(e), "error");
  }
}

