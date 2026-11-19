
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

// ===============================
// REPORTES
// ===============================

function textoResumen(r) {
  const partes = [`✅ ${r.presente} presentes`, `⏰ ${r.tardanza} tardanzas`, `📝 ${r.justificado} justificadas`, `❌ ${r.falta} faltas`];
  const pct = r.porcentaje === null ? "sin datos" : `${r.porcentaje.toFixed(1)}%`;
  return { partes: partes.join(" · "), pct };
}

// ===============================
// REPORTE EN DOS NIVELES (para leer poco)
//  1) Resumen por materia: sale de los resúmenes diarios (un documento por materia y día).
//  2) Estudiantes: solo cuando se pide (botón «Estudiantes» de una materia o al buscar una cédula);
//     es lo único que lee los registros de asistencia, y se pinta por páginas.
// ===============================

const REPORTE_PAGINA = 50;
const REPORTE_DIAS_POR_DEFECTO = 30;

// ---------- Piezas visuales comunes de los reportes ----------

function claseNivel(pct) {
  if (pct === null || pct === undefined) return "nivel-vacio";
  return pct >= 85 ? "nivel-ok" : pct >= 70 ? "nivel-medio" : "nivel-bajo";
}

function textoPct(pct) {
  return pct === null || pct === undefined ? "–" : `${Math.round(pct)} %`;
}

// Etiquetas con los conteos (solo las que tienen datos; «presentes» siempre)
function chipsConteo(f) {
  return [
    [f.presente, "chip-ok", n => `${n} ${n === 1 ? "presente" : "presentes"}`, true],
    [f.tardanza, "chip-tarde", n => `${n} ${n === 1 ? "tardanza" : "tardanzas"}`],
    [f.justificado, "chip-justif", n => `${n} ${n === 1 ? "justificada" : "justificadas"}`],
    [f.falta, "chip-falta", n => `${n} ${n === 1 ? "falta" : "faltas"}`]
  ].filter(([n, , , siempre]) => n > 0 || siempre)
   .map(([n, clase, texto]) => `<span class="chip ${clase}">${texto(n || 0)}</span>`).join("");
}

function barraPct(pct) {
  const ancho = pct === null || pct === undefined ? 0 : Math.max(0, Math.min(100, pct));
  return `<div class="asist-pista"><div class="asist-relleno" style="width:${ancho}%"></div></div>`;
}

const FLECHA_FILA = `<svg class="fila-flecha" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>`;

async function generarReporte() {
  const contenedor = $("reporte");
  clearFieldError("cedulaReporte");

  const ced = $("cedulaReporte").value.trim();
  const matId = $("materiaReporte").value || "todas";
  let fInicio = $("fechaInicioReporte").value;
  const fFin = $("fechaFinReporte").value;

  if (ced && !validarCedula(ced)) {
    showFieldError("cedulaReporte", "Cédula inválida.");
    return;
  }

  if (fInicio && fFin && fInicio > fFin) {
    contenedor.innerHTML = "<p class='error-text'>La fecha de inicio no puede ser mayor que la de fin.</p>";
    return;
  }

  // Sin fechas se toman los últimos 30 días (y se muestra en el campo)
  if (!fInicio && !fFin && !ced) {
    fInicio = fechaHaceDias(REPORTE_DIAS_POR_DEFECTO);
    $("fechaInicioReporte").value = fInicio;
  }

  reporteFiltro = { materia: matId, desde: fInicio, hasta: fFin };
  resumenMateriasActual = [];
  resumenReporteActual = [];
  resultadosBusquedaActual = [];
  contenedor.innerHTML = "<p>Buscando...</p>";

  try {
    // Con cédula: se leen directamente los registros de ese estudiante (son pocos)
    if (ced) {
      const registros = await consultarAsistencias({
        materiaIds: matId === "todas" ? null : [matId], cedula: ced, desde: fInicio, hasta: fFin
      });
      contenedor.innerHTML = "<hr><div id=\"reporteEstudiantes\"></div>";
      pintarEstudiantesReporte(registros);
      return;
    }

    let docs = await consultarResumenes({ materiaIds: matId === "todas" ? null : [matId], desde: fInicio });
    if (fFin) docs = docs.filter(d => d.fecha <= fFin);

    if (docs.length === 0) {
      contenedor.innerHTML = "<p class=\"vacio-lista\">No hay listas en ese periodo." +
        (currentUserRole === "admin" ? " Si ya pasaste listas antes de actualizar, pulsa «Recalcular resúmenes» en Admin." : "") + "</p>";
      return;
    }

    const filas = construirResumenPorMateria(docs);
    resumenMateriasActual = filas;

    const total = resumenDeConteos(sumarResumenes(docs));
    const { partes, pct } = textoResumen(total);

    const nivelGeneral = claseNivel(total.porcentaje);
    let html = `<div class="reporte-cab ${nivelGeneral}">
        <div class="reporte-pct">${textoPct(total.porcentaje)}</div>
        <div class="reporte-datos"><strong>Asistencia general</strong><span>${docs.length} ${docs.length === 1 ? "lista" : "listas"} en el periodo</span>
        <span class="chips chips-mini">${chipsConteo(total)}</span></div>
      </div>
      <button class="secondary" onclick="exportarResumenMaterias()">Exportar resumen por materia (CSV)</button>
      <p class="etiqueta">Por materia</p>
      <ul class="lista-filas">`;

    filas.forEach(f => {
      html += `<li class="fila-est fila-lista ${claseNivel(f.porcentaje)}" tabindex="0" role="button" onclick="verEstudiantesDeMateria('${esc(f.materia)}')">
        <span class="fila-texto">
          <strong>${esc(f.nombre)}</strong>
          <small>${f.listas} ${f.listas === 1 ? "lista" : "listas"}</small>
          ${barraPct(f.porcentaje)}
          <span class="chips chips-mini">${chipsConteo(f)}</span>
        </span>
        <span class="fila-pct">${textoPct(f.porcentaje)}</span>
        ${FLECHA_FILA}
      </li>`;
    });
    html += `</ul>
      <p class="subtitle">Toca una materia para ver el detalle por estudiante en el mismo periodo.</p>
      <div id="reporteEstudiantes"></div>`;

    contenedor.innerHTML = html;
  } catch (e) {
    contenedor.innerHTML = "<p class='error-text'>Error al obtener datos: " + esc(traducirErrorFirebase(e)) + "</p>";
  }
}

// Una fila por materia a partir de los resúmenes diarios
function construirResumenPorMateria(docs) {
  const grupos = new Map();
  docs.forEach(d => {
    if (!grupos.has(d.materia)) grupos.set(d.materia, []);
    grupos.get(d.materia).push(d);
  });
  return Array.from(grupos.entries())
    .map(([materia, lista]) => ({
      materia,
      nombre: materiasMap[materia] || materia,
      listas: lista.length,
      ...resumenDeConteos(sumarResumenes(lista))
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Nivel 2: lee los registros de una materia (con el periodo del reporte) y los pinta por páginas
async function verEstudiantesDeMateria(materiaId) {
  const destino = $("reporteEstudiantes");
  if (!destino) return;
  destino.innerHTML = "<p>Cargando estudiantes...</p>";
  try {
    const registros = await consultarAsistencias({
      materiaIds: [materiaId], desde: reporteFiltro.desde, hasta: reporteFiltro.hasta
    });
    pintarEstudiantesReporte(registros, materiasMap[materiaId] || "");
  } catch (e) {
    destino.innerHTML = "<p class='error-text'>Error al obtener datos: " + esc(traducirErrorFirebase(e)) + "</p>";
  }
}

function pintarEstudiantesReporte(registros, titulo = "") {
  const destino = $("reporteEstudiantes");
  resultadosBusquedaActual = registros;

  if (registros.length === 0) {
    resumenReporteActual = [];
    destino.innerHTML = "<p>No se encontraron registros con esos criterios.</p>";
    return;
  }

  resumenReporteActual = construirResumenPorEstudiante(registros);
  reporteTitulo = titulo;
  reporteVisibles = REPORTE_PAGINA;
  pintarTablaEstudiantes();
}

function pintarTablaEstudiantes() {
  const destino = $("reporteEstudiantes");
  const filas = resumenReporteActual;
  const total = resumenEstados(resultadosBusquedaActual);
  const { partes, pct } = textoResumen(total);

  let html = (reporteTitulo ? `<h4>${esc(reporteTitulo)}</h4>` : "") +
    `<p class="subtitle"><strong>${resultadosBusquedaActual.length}</strong> registros · <strong>${filas.length}</strong> ${filas.length === 1 ? "estudiante" : "estudiantes"} · asistencia general <strong>${pct}</strong></p>
    <div class="chips chips-mini">${chipsConteo(total)}</div>
    <div class="acciones-reporte">
      <button class="secondary" onclick="exportarResumenReporte()">Exportar resumen (CSV)</button>
      <button class="secondary" onclick="exportarBusqueda()">Exportar detalle (CSV)</button>
    </div>
    <ul class="lista-filas">`;

  filas.slice(0, reporteVisibles).forEach(f => {
    html += `<li class="fila-est fila-lista ${claseNivel(f.porcentaje)}">
      <span class="avatar">${esc(iniciales(f.nombres, f.apellidos))}</span>
      <span class="fila-texto">
        <strong>${esc(f.nombres)} ${esc(f.apellidos)}</strong>
        <small>${esc(f.cedula)} · ${esc(nombreMateria(f))}</small>
        ${barraPct(f.porcentaje)}
        <span class="chips chips-mini">${chipsConteo(f)}</span>
      </span>
      <span class="fila-pct">${textoPct(f.porcentaje)}</span>
    </li>`;
  });
  html += "</ul>";

  if (filas.length > reporteVisibles) {
    html += `<p class="subtitle">Se muestran ${reporteVisibles} de ${filas.length}. Los CSV incluyen todos.</p>
      <button class="secondary" onclick="reporteMostrarMas()">Mostrar más</button>`;
  }
  destino.innerHTML = html;
}

function reporteMostrarMas() {
  reporteVisibles += REPORTE_PAGINA;
  pintarTablaEstudiantes();
}

// Una fila por estudiante y materia, ordenada por apellido
function construirResumenPorEstudiante(registros) {
  const grupos = new Map();
  registros.forEach(x => {
    const clave = `${x.cedula}|${x.materia}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { cedula: x.cedula, nombres: x.nombres || "", apellidos: x.apellidos || "", materia: x.materia, materiaNombre: x.materiaNombre, lista: [] });
    }
    grupos.get(clave).lista.push(x);
  });
  return Array.from(grupos.values())
    .map(g => ({ ...g, ...resumenEstados(g.lista), lista: undefined }))
    .sort((a, b) => a.apellidos.localeCompare(b.apellidos) || a.nombres.localeCompare(b.nombres) || nombreMateria(a).localeCompare(nombreMateria(b)));
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

// Asistencias, una fila por registro, solo con lo necesario: nombre, apellido, materia, docente,
// fecha y tipo de asistencia (nunca los datos personales del estudiante: grado, teléfono, etc.).
// "Docente" = quien guardó (terminó) la lista; guardadores: mapa "materia_fecha" -> nombre.
// Si no hay dato, se usa el docente del registro.
function construirCSV(registros, guardadores = {}) {
  const cabecera = ["Nombres", "Apellidos", "Materia", "Docente", "Fecha", "Tipo de asistencia"];
  const filas = registros.map(x => [
    x.nombres, x.apellidos, nombreMateria(x),
    guardadores[`${x.materia}_${x.fecha}`] || (x.profesor || x.profesorNombre ? nombreDocente(x) : ""),
    x.fecha, ESTADOS[estadoDe(x)].texto
  ].map(csvCelda).join(";"));
  return "\uFEFF" + cabecera.join(";") + "\n" + filas.join("\n");
}

// Resumen: una fila por estudiante y materia
function construirCSVResumen(filas) {
  const cabecera = ["Cedula", "Nombres", "Apellidos", "Materia", "Presentes", "Tardanzas", "Justificadas", "Faltas", "Total", "Porcentaje"];
  const lineas = filas.map(f => [
    f.cedula, f.nombres, f.apellidos, nombreMateria(f), f.presente, f.tardanza, f.justificado, f.falta, f.total,
    f.porcentaje === null ? "" : f.porcentaje.toFixed(1) + "%"
  ].map(csvCelda).join(";"));
  return "\uFEFF" + cabecera.join(";") + "\n" + lineas.join("\n");
}

// Resumen por materia (sale de los resúmenes diarios)
function construirCSVMaterias(filas) {
  const cabecera = ["Materia", "Listas", "Presentes", "Tardanzas", "Justificadas", "Faltas", "Total", "Porcentaje"];
  const lineas = filas.map(f => [
    f.nombre, f.listas, f.presente, f.tardanza, f.justificado, f.falta, f.total,
    f.porcentaje === null ? "" : f.porcentaje.toFixed(1) + "%"
  ].map(csvCelda).join(";"));
  return "\uFEFF" + cabecera.join(";") + "\n" + lineas.join("\n");
}

function exportarResumenMaterias() {
  if (!resumenMateriasActual || resumenMateriasActual.length === 0) {
    return showMessage("No hay datos para exportar.", "error");
  }
  descargarCSV(construirCSVMaterias(resumenMateriasActual), "reporte_materias.csv");
  showMessage("Resumen exportado.", "success");
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

async function exportarBusqueda() {
  if (!resultadosBusquedaActual || resultadosBusquedaActual.length === 0) {
    return showMessage("No hay datos para exportar.", "error");
  }
  try {
    if (currentUserRole === "admin") await cargarUsuariosCache();   // para mostrar nombres, no correos
  } catch (e) { /* si falla, se exportan los correos */ }
  const filas = [...resultadosBusquedaActual].sort((a, b) => b.fecha.localeCompare(a.fecha) || (a.apellidos || "").localeCompare(b.apellidos || ""));
  const guardadores = await mapaGuardadores(filas);
  descargarCSV(construirCSV(filas, guardadores), "reporte_detalle.csv");
  showMessage("Detalle exportado.", "success");
}

function exportarResumenReporte() {
  if (!resumenReporteActual || resumenReporteActual.length === 0) {
    return showMessage("No hay datos para exportar.", "error");
  }
  descargarCSV(construirCSVResumen(resumenReporteActual), "reporte_resumen.csv");
  showMessage("Resumen exportado.", "success");
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
      ul.innerHTML = "<li class=\"vacio-lista\">Sin alertas en este periodo. Todo en orden.</li>";
      return;
    }

    alertas.forEach(({ r, ref }) => {
      const li = document.createElement("li");
      li.className = "fila-est fila-lista nivel-bajo";
      li.innerHTML = `<span class="avatar">${esc(iniciales(ref.nombres, ref.apellidos))}</span>
        <span class="fila-texto">
          <strong>${esc((ref.nombres || "") + " " + (ref.apellidos || ""))}</strong>
          <small>${esc(ref.cedula)} · ${esc(nombreMateria(ref))}</small>
          ${barraPct(r.porcentaje)}
          <small>${r.asistidas} de ${r.base} clases${r.justificado ? ` · ${r.justificado} justificada(s) aparte` : ""}</small>
        </span>
        <span class="fila-pct">${textoPct(r.porcentaje)}</span>`;
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

  // El gráfico se descarga la primera vez; mientras tanto se leen los datos (en paralelo)
  const libreriaGrafico = cargarLibreria("grafico");
  libreriaGrafico.catch(() => {});

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

    const cab = $("dashCab");
    if (cab) {
      cab.className = "reporte-cab " + claseNivel(r.total ? r.porcentaje : null);
      cab.innerHTML = r.total
        ? `<div class="reporte-pct">${textoPct(r.porcentaje)}</div>
           <div class="reporte-datos"><strong>Asistencia del periodo</strong><span>${r.total} registros</span>
           <span class="chips chips-mini">${chipsConteo(r)}</span></div>`
        : `<div class="reporte-datos"><strong>Sin datos</strong></div>`;
    }

    try {
      await libreriaGrafico;
    } catch (e) {
      return showMessage(TEXTO_ERROR_LIBRERIA, "error");
    }
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

