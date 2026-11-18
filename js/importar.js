// ===============================
// IMPORTACIÓN DE ESTUDIANTES POR CSV (solo admin)
// Formato: cedula;nombres;apellidos  (con o sin fila de encabezado)
// ===============================

const IMPORT_MAX_FILAS = 1000;
const IMPORT_MAX_VISTA = 100;
let importAnalisis = null;

function detectarSeparador(texto) {
  const linea = String(texto).split(/\r?\n/).find(l => l.trim() !== "") || "";
  const cuentas = [";", ",", "\t"].map(s => [s, linea.split(s).length - 1]);
  cuentas.sort((a, b) => b[1] - a[1]);
  return cuentas[0][1] > 0 ? cuentas[0][0] : ";";
}

// Lector de CSV con comillas ("" escapa una comilla) y saltos de línea \n o \r\n
function parsearCSV(texto) {
  texto = String(texto || "").replace(/^﻿/, "");
  const sep = detectarSeparador(texto);
  const filas = [];
  let fila = [], campo = "", comillas = false;

  const cerrarFila = () => {
    fila.push(campo);
    campo = "";
    if (fila.some(x => x.trim() !== "")) filas.push(fila);
    fila = [];
  };

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"' && campo === "") {
      comillas = true;
    } else if (c === sep) {
      fila.push(campo);
      campo = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      cerrarFila();
    } else {
      campo += c;
    }
  }
  cerrarFila();
  return filas;
}

function quitarAcentos(s) {
  return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Detecta si la primera fila es un encabezado y en qué columna está cada dato
function mapearColumnas(filas) {
  const primera = (filas[0] || []).map(quitarAcentos);
  const alias = {
    cedula: ["cedula", "documento", "id", "dni", "ci"],
    nombres: ["nombres", "nombre"],
    apellidos: ["apellidos", "apellido"]
  };
  const idx = {};
  Object.entries(alias).forEach(([k, lista]) => {
    const i = primera.findIndex(x => lista.includes(x));
    if (i >= 0) idx[k] = i;
  });
  if (idx.cedula !== undefined && idx.nombres !== undefined && idx.apellidos !== undefined) {
    return { idx, conCabecera: true };
  }
  return { idx: { cedula: 0, nombres: 1, apellidos: 2 }, conCabecera: false };
}

// Valida cada fila y decide qué hay que crear. Función pura (se puede probar sin Firebase).
//  existentes: Set de cédulas ya registradas | relaciones: Set de ids "cedula_materiaId" ya existentes
function analizarFilasImportacion(filas, existentes, relaciones, materiaId) {
  const { idx, conCabecera } = mapearColumnas(filas);
  const datos = conCabecera ? filas.slice(1) : filas;
  const vistas = new Set();
  const resultado = [];

  datos.forEach((f, i) => {
    const n = i + 1 + (conCabecera ? 1 : 0);                 // número de línea aproximado
    const cedula = String(f[idx.cedula] || "").replace(/[.\s]/g, "");
    const nombres = normalizarTexto(f[idx.nombres] || "");
    const apellidos = normalizarTexto(f[idx.apellidos] || "");
    const fila = { n, cedula, nombres, apellidos, estado: "nueva", error: "", crearEstudiante: false, asignar: false };

    if (!/^[0-9]{4,20}$/.test(cedula)) fila.error = "Cédula inválida (4 a 20 dígitos)";
    else if (vistas.has(cedula)) fila.error = "Repetida en el archivo";
    else if (!validarNombre(nombres) || nombres.length > 80) fila.error = "Nombres inválidos";
    else if (!validarNombre(apellidos) || apellidos.length > 80) fila.error = "Apellidos inválidos";

    if (fila.error) {
      fila.estado = "error";
    } else {
      vistas.add(cedula);
      if (existentes.has(cedula)) fila.estado = "existe";
      else fila.crearEstudiante = true;
      if (materiaId && !relaciones.has(`${cedula}_${materiaId}`)) fila.asignar = true;
    }
    resultado.push(fila);
  });

  const cuenta = fn => resultado.filter(fn).length;
  return {
    filas: resultado,
    materiaId: materiaId || "",
    resumen: {
      total: resultado.length,
      nuevos: cuenta(f => f.crearEstudiante),
      yaExistian: cuenta(f => f.estado === "existe"),
      asignaciones: cuenta(f => f.asignar),
      errores: cuenta(f => f.estado === "error")
    }
  };
}

// Convierte el análisis en escrituras concretas (una por documento)
function calcularOperacionesImportacion(analisis, email, marcaServidor) {
  const ops = [];
  analisis.filas.forEach(f => {
    if (f.crearEstudiante) {
      ops.push({
        coleccion: "estudiantes", id: f.cedula,
        data: { cedula: f.cedula, nombres: f.nombres, apellidos: f.apellidos, creadoEn: marcaServidor }
      });
    }
    if (f.asignar) {
      ops.push({
        coleccion: "materia_estudiante", id: `${f.cedula}_${analisis.materiaId}`,
        data: { cedula: f.cedula, materiaId: analisis.materiaId, creadoEn: marcaServidor, creadoPor: email }
      });
    }
  });
  return ops;
}

async function cargarArchivoCSV(input) {
  const archivo = input && input.files && input.files[0];
  if (!archivo) return;
  if (archivo.size > 2 * 1024 * 1024) return showMessage("El archivo es demasiado grande (máximo 2 MB).", "error");
  try {
    $("csvTexto").value = await archivo.text();
    importAnalisis = null;
    $("csvVistaPrevia").innerHTML = "";
    $("btnCsvImportar").style.display = "none";
    showMessage("Archivo cargado. Pulsa «Revisar» para ver la vista previa.", "info");
  } catch (e) {
    showMessage("No se pudo leer el archivo.", "error");
  }
}

async function importarRevisar() {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede importar.", "error");

  const texto = $("csvTexto").value;
  if (!texto.trim()) return showMessage("Pega el contenido o elige un archivo CSV.", "error");

  const filas = parsearCSV(texto);
  if (filas.length === 0) return showMessage("No se encontraron filas.", "error");
  if (filas.length > IMPORT_MAX_FILAS + 1) {
    return showMessage(`Máximo ${IMPORT_MAX_FILAS} filas por importación.`, "error");
  }

  try {
    await cargarCacheEstudiantes(true);
    const existentes = new Set(cacheEst.estudiantes.map(e => e.cedula));
    const relaciones = new Set(cacheEst.relaciones.map(r => r.id));
    const materiaId = $("csvMateria").value || "";

    importAnalisis = analizarFilasImportacion(filas, existentes, relaciones, materiaId);
    pintarVistaPreviaImportacion();
  } catch (e) {
    showMessage("No se pudo revisar: " + traducirErrorFirebase(e), "error");
  }
}

function pintarVistaPreviaImportacion() {
  const a = importAnalisis;
  const r = a.resumen;
  const cont = $("csvVistaPrevia");

  let html = `<p><strong>${r.total}</strong> filas · <strong>${r.nuevos} nuevos</strong> · ${r.yaExistian} ya existían`;
  if (a.materiaId) html += ` · ${r.asignaciones} asignaciones a «${esc(nombreMateria({ materia: a.materiaId }))}»`;
  html += r.errores ? ` · <span class="error-text">${r.errores} con error (se omitirán)</span>` : "";
  html += `</p><table class="vista-previa"><tr><th>#</th><th>Cédula</th><th>Nombre</th><th>Resultado</th></tr>`;

  a.filas.slice(0, IMPORT_MAX_VISTA).forEach(f => {
    const clase = f.estado === "error" ? "fila-error" : (f.estado === "existe" ? "fila-existe" : "");
    const resultado = f.estado === "error" ? f.error
      : f.crearEstudiante ? "Se creará" + (f.asignar ? " y se asignará" : "")
      : f.asignar ? "Ya existe · se asignará" : "Ya existe · sin cambios";
    html += `<tr class="${clase}"><td>${f.n}</td><td>${esc(f.cedula)}</td><td>${esc(f.nombres)} ${esc(f.apellidos)}</td><td>${esc(resultado)}</td></tr>`;
  });
  html += "</table>";
  if (a.filas.length > IMPORT_MAX_VISTA) html += `<p class="subtitle">Se muestran ${IMPORT_MAX_VISTA} de ${a.filas.length} filas.</p>`;

  cont.innerHTML = html;
  $("btnCsvImportar").style.display = (r.nuevos + r.asignaciones) > 0 ? "block" : "none";
  if (!(r.nuevos + r.asignaciones)) showMessage("No hay nada nuevo que importar.", "info");
}

async function importarConfirmar() {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede importar.", "error");
  if (!importAnalisis) return showMessage("Primero pulsa «Revisar».", "error");

  const ops = calcularOperacionesImportacion(importAnalisis, auth.currentUser.email, serverTs());
  if (ops.length === 0) return showMessage("No hay nada nuevo que importar.", "info");

  const r = importAnalisis.resumen;
  if (!confirm(`Se crearán ${r.nuevos} estudiante(s)${importAnalisis.materiaId ? ` y ${r.asignaciones} asignación(es)` : ""}.` +
               (r.errores ? `\nSe omitirán ${r.errores} fila(s) con error.` : "") + "\n\n¿Continuar?")) return;

  const btn = $("btnCsvImportar");
  btn.disabled = true;
  try {
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(op => batch.set(db.collection(op.coleccion).doc(op.id), op.data));
      await batch.commit();
    }
    showMessage(`Importación completa: ${r.nuevos} estudiante(s) nuevos.`, "success");
    importAnalisis = null;
    $("csvTexto").value = "";
    $("csvVistaPrevia").innerHTML = "";
    btn.style.display = "none";
    invalidarCacheEstudiantes();
    buscarEstudiantes();
  } catch (e) {
    showMessage("La importación se interrumpió: " + traducirErrorFirebase(e) + " Vuelve a pulsar «Revisar»: lo ya creado se detecta y no se duplica.", "error");
  } finally {
    btn.disabled = false;
  }
}
