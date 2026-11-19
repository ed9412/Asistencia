// ===============================
// MATERIAS
// ===============================

// Única consulta de materias: llena la memoria y repinta todo lo que las usa.
// El admin recibe todas; un docente solo las que tiene asignadas.
async function cargarMaterias() {
  try {
    const esAdmin = currentUserRole === "admin";
    // Materias y (para el admin) lista de usuarios se piden a la vez
    const consultaMaterias = esAdmin
      ? db.collection("materias").orderBy("nombre").get()
      : db.collection("materias").where("profesores", "array-contains", auth.currentUser.uid).get();
    const [snap] = await Promise.all([consultaMaterias, esAdmin ? cargarUsuariosCache() : null]);

    materiasMap = {};
    materiasLista = [];
    snap.forEach(doc => {
      const d = doc.data();
      materiasMap[doc.id] = d.nombre;
      materiasLista.push({ id: doc.id, nombre: d.nombre, profesores: d.profesores || [] });
    });
    materiasLista.sort((a, b) => a.nombre.localeCompare(b.nombre));

    renderSelectsMaterias();
    listarMaterias();
    cargarMateriasEnReportes();
  } catch (e) {
    showMessage("Error cargando materias: " + traducirErrorFirebase(e), "error");
  }
}

function renderSelectsMaterias() {
  ["materiaLista", "materiaSelect", "searchEstudianteMateria", "editEstAddMateria", "csvMateria"].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = "";
  });

  const vacio = materiasLista.length === 0;
  const textoBase = vacio ? "Sin materias" : "Selecciona una materia";

  $("searchEstudianteMateria").add(new Option("Todas las materias", "todas"));
  $("editEstAddMateria").add(new Option("Selecciona materia a añadir", ""));
  $("materiaLista").add(new Option(textoBase, ""));
  $("materiaSelect").add(new Option(textoBase, ""));
  if ($("csvMateria")) $("csvMateria").add(new Option("No asignar a ninguna materia", ""));

  const aviso = $("avisoSinMaterias");
  if (aviso) aviso.style.display = (vacio && currentUserRole === "profesor") ? "block" : "none";

  materiasLista.forEach(m => {
    $("materiaLista").add(new Option(m.nombre, m.id));
    $("materiaSelect").add(new Option(m.nombre, m.id));
    $("searchEstudianteMateria").add(new Option(m.nombre, m.id));
    $("editEstAddMateria").add(new Option(m.nombre, m.id));
    if ($("csvMateria")) $("csvMateria").add(new Option(`Asignar a: ${m.nombre}`, m.id));
  });

  // Con una sola materia se deja elegida para pasar lista
  if (materiasLista.length === 1) $("materiaLista").value = materiasLista[0].id;
}

// Selects de historial, reportes y dashboard
function cargarMateriasEnReportes() {
  const esAdmin = currentUserRole === "admin";

  // Historial: todas las materias a las que se tiene acceso, o una en concreto
  const hist = $("materiaHistorial");
  if (hist) {
    hist.innerHTML = "";
    hist.add(new Option(esAdmin ? "Todas las materias" : "Todas mis materias", ""));
    materiasLista.forEach(m => hist.add(new Option(m.nombre, m.id)));
  }

  ["materiaReporte", "dashboardMateria"].forEach(id => {
    const select = $(id);
    if (!select) return;
    select.innerHTML = "";
    select.add(new Option(esAdmin ? "Todas las materias" : "Todas mis materias", "todas"));
    materiasLista.forEach(m => select.add(new Option(m.nombre, m.id)));
  });
}

// Pinta el listado desde la memoria (no consulta Firestore)
function listarMaterias() {
  const ul = $("listaMateriasUl");
  ul.innerHTML = "";

  if (materiasLista.length === 0) {
    ul.innerHTML = `<li class="vacio-lista">Aún no hay materias. Crea la primera con «Nueva materia».</li>`;
  }

  materiasLista.forEach(mat => {
    const li = document.createElement("li");
    li.className = "fila-est fila-lista";
    li.tabIndex = 0;
    li.setAttribute("role", "button");
    const docentes = (mat.profesores || []).map(uid => {
      const u = usuariosMap[uid];
      return u ? (u.nombre || u.email) : "cuenta desconocida";
    });
    li.innerHTML = `<span class="avatar">${esc(iniciales(mat.nombre, ""))}</span>
      <span class="fila-texto"><strong>${esc(mat.nombre)}</strong>
      <small>${esc(docentes.length ? docentes.join(", ") : "Sin docentes asignados")}</small></span>${FLECHA_FILA}`;
    li.onclick = () => mostrar("materiaDetalle", { param: mat.id });
    ul.appendChild(li);
  });

  if (typeof pintarMateriaDetalle === "function" && pantallaActual === "materiaDetalle") pintarMateriaDetalle(materiaDetalleId);
}

async function crearMateria() {
  if (currentUserRole !== "admin") return showMessage("Solo un admin puede crear materias.", "error");
  if (!validarMateriaCampos()) return;
  const nombre = normalizarTexto($("materiaNombre").value);

  if (materiasLista.some(m => m.nombre.toLowerCase() === nombre.toLowerCase())) {
    showFieldError("materiaNombre", "Ya existe esta materia.");
    return showMessage("Ya existe una materia con ese nombre.", "error");
  }

  try {
    await db.collection("materias").add({ nombre, profesores: [], creadoEn: serverTs(), creadoPor: auth.currentUser.email });
    showMessage("Materia creada.", "success");
    limpiarInput("materiaNombre");
    clearFieldError("materiaNombre");
    await cargarMaterias();
    if (pantallaActual === "materiaNueva") volver();
  } catch (error) {
    showMessage("Error: " + traducirErrorFirebase(error), "error");
  }
}

function abrirEditarMateria(id, nombre) {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede editar.", "error");
  clearFieldError("editMatNombre");
  $("editMatId").value = id;
  $("editMatNombre").value = nombre;
  $("editMateriaModal").style.display = "block";
}

function cerrarEditMateriaModal() {
  $("editMateriaModal").style.display = "none";
}

async function guardarEdicionMateria() {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede editar.", "error");
  clearFieldError("editMatNombre");
  const id = $("editMatId").value;
  const nuevoNombre = normalizarTexto($("editMatNombre").value);

  if (!validarMateria(nuevoNombre)) {
    return showFieldError("editMatNombre", "Nombre inválido.");
  }

  const duplicada = materiasLista.some(m => m.id !== id && m.nombre.toLowerCase() === nuevoNombre.toLowerCase());
  if (duplicada) {
    return showFieldError("editMatNombre", "Ya existe una materia con ese nombre.");
  }

  try {
    await db.collection("materias").doc(id).update({ nombre: nuevoNombre });
    showMessage("Materia actualizada.", "success");
    cerrarEditMateriaModal();
    await cargarMaterias();
    if (cacheEst.ts) buscarEstudiantes();
  } catch (e) {
    showMessage("Error actualizando: " + traducirErrorFirebase(e), "error");
  }
}

async function eliminarMateria(id) {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede eliminar.", "error");

  const password = await pedirPassword();
  if (!password) return;

  try {
    await reautenticar(password);
  } catch (e) {
    return showMessage("Contraseña incorrecta.", "error");
  }

  try {
    const relSnap = await db.collection("materia_estudiante").where("materiaId", "==", id).get();
    const refs = relSnap.docs.map(d => d.ref);
    refs.push(db.collection("materias").doc(id));
    await borrarEnLotes(refs);

    invalidarCacheEstudiantes();
    showMessage("Materia y asignaciones eliminadas. El historial de asistencias se conserva.", "success");
    await cargarMaterias();
  } catch (e) {
    showMessage("Error al eliminar: " + traducirErrorFirebase(e), "error");
  }
}

// ===============================
// ESTUDIANTES
// ===============================

function invalidarCacheEstudiantes() {
  cacheEst.ts = 0;
}

async function cargarCacheEstudiantes(force = false) {
  const vigente = cacheEst.ts && (Date.now() - cacheEst.ts) < CACHE_TTL_MS;
  if (!force && vigente) return;

  const [estSnap, relSnap] = await Promise.all([
    db.collection("estudiantes").get(),
    db.collection("materia_estudiante").get()
  ]);

  cacheEst.estudiantes = estSnap.docs.map(d => d.data());
  cacheEst.relaciones = relSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheEst.ts = Date.now();
}

async function crearEstudiante() {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede crear.", "error");
  if (!validarEstudianteCampos()) return;

  const cedula = $("cedula").value.trim();
  const nombres = normalizarTexto($("nombres").value);
  const apellidos = normalizarTexto($("apellidos").value);

  try {
    const ref = db.collection("estudiantes").doc(cedula);
    const ex = await ref.get();
    if (ex.exists) {
      showFieldError("cedula", "Ya existe.");
      return showMessage("Ya existe esta cédula.", "error");
    }
    const extra = camposExtraEstudiante({
      grado: $("gradoEst").value, telefono: $("telefonoEst").value,
      correo: $("correoEst").value, representante: $("representanteEst").value
    });
    await ref.set({ cedula, nombres, apellidos, ...extra, creadoEn: serverTs() });
    showMessage("Estudiante creado.", "success");
    ["cedula", "nombres", "apellidos", "gradoEst", "telefonoEst", "correoEst", "representanteEst"].forEach(limpiarInput);
    clearFields(["cedula", "nombres", "apellidos", "gradoEst", "telefonoEst", "correoEst", "representanteEst"]);
    invalidarCacheEstudiantes();
    buscarEstudiantes();
  } catch (e) {
    showMessage("Error: " + traducirErrorFirebase(e), "error");
  }
}

async function buscarEstudiantes() {
  const texto = quitarAcentos(normalizarTexto($("searchEstudianteText").value));
  const palabras = texto ? texto.split(" ") : [];
  const materiaId = $("searchEstudianteMateria").value || "todas";

  try {
    await cargarCacheEstudiantes();

    const materiasPorCedula = {};
    const cedulasDeMateria = new Set();
    cacheEst.relaciones.forEach(r => {
      const nombre = materiasMap[r.materiaId];
      if (nombre) {
        if (!materiasPorCedula[r.cedula]) materiasPorCedula[r.cedula] = new Set();
        materiasPorCedula[r.cedula].add(nombre);
      }
      if (materiaId !== "todas" && r.materiaId === materiaId) cedulasDeMateria.add(r.cedula);
    });

    const ul = $("listaEstudiantes");
    ul.innerHTML = "";
    let mostrados = 0;

    const ordenados = [...cacheEst.estudiantes].sort((a, b) => a.apellidos.localeCompare(b.apellidos));

    const esAdmin = currentUserRole === "admin";

    ordenados.forEach(est => {
      if (materiaId !== "todas" && !cedulasDeMateria.has(est.cedula)) return;
      // El docente solo ve estudiantes de sus propias materias
      if (!esAdmin && !materiasPorCedula[est.cedula]) return;

      const nombreCompleto = `${est.nombres} ${est.apellidos}`;
      const mats = materiasPorCedula[est.cedula] ? Array.from(materiasPorCedula[est.cedula]).join(", ") : "Ninguna";

      // Se busca en todos los campos (sin distinguir acentos ni mayúsculas); cada palabra debe aparecer
      const pajar = quitarAcentos([est.cedula, est.nombres, est.apellidos, est.grado, est.telefono, est.correo, est.representante,
        mats === "Ninguna" ? "" : mats].join(" "));
      if (!palabras.every(p => pajar.includes(p))) return;

      mostrados++;

      const li = document.createElement("li");
      li.className = "fila-est";
      li.dataset.ced = est.cedula;
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      const abrir = () => abrirFicha(est.cedula);
      li.onclick = abrir;
      li.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrir(); } };
      li.innerHTML = `
        <span class="avatar">${esc(iniciales(est.nombres, est.apellidos))}</span>
        <span class="fila-texto">
          <strong>${esc(nombreCompleto)}</strong>
          <small>${esc(est.grado || "Sin grado")} · ${esc(est.cedula)}</small>
        </span>
        <svg class="fila-flecha" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
      `;
      ul.appendChild(li);
    });

    if (mostrados === 0) {
      ul.innerHTML = "<li>No se encontraron estudiantes.</li>";
    }
    const cont = $("contEstudiantes");
    if (cont) cont.textContent = mostrados === 1 ? "1 estudiante" : `${mostrados} estudiantes`;
    if (typeof refrescarFichaSiAbierta === "function") refrescarFichaSiAbierta();
  } catch (error) {
    showMessage("Error al buscar estudiantes: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// EDICIÓN / ELIMINACIÓN DE ESTUDIANTE
// ===============================

async function abrirEditarEstudiante(cedula) {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede editar.", "error");
  clearFields(["editEstNombres", "editEstApellidos", "editEstGrado", "editEstTelefono", "editEstCorreo", "editEstRepresentante"]);

  try {
    // Estudiante y sus materias se piden a la vez
    const [doc, snap] = await Promise.all([
      db.collection("estudiantes").doc(cedula).get(),
      db.collection("materia_estudiante").where("cedula", "==", cedula).get()
    ]);
    if (!doc.exists) return showMessage("El estudiante no existe.", "error");

    const data = doc.data();
    $("editEstCedula").value = data.cedula;
    $("editEstNombres").value = data.nombres;
    $("editEstApellidos").value = data.apellidos;
    $("editEstGrado").value = data.grado || "";
    $("editEstTelefono").value = data.telefono || "";
    $("editEstCorreo").value = data.correo || "";
    $("editEstRepresentante").value = data.representante || "";

    relacionesOriginales = snap.docs.map(d => ({ id: d.id, materiaId: d.data().materiaId }));
    tempMateriasEstudiante = Array.from(new Set(relacionesOriginales.map(r => r.materiaId)));

    actualizarUIEditMateriasEst();
    $("editStudentModal").style.display = "block";
  } catch (e) {
    showMessage("Error: " + traducirErrorFirebase(e), "error");
  }
}

function cerrarEditStudentModal() {
  $("editStudentModal").style.display = "none";
}

// Opciones del desplegable «Añadir nueva materia»: solo las que el estudiante aún no tiene
function opcionesMateriasSinAsignar(yaAsignadas) {
  return materiasLista.filter(m => !yaAsignadas.includes(m.id));
}

function refrescarSelectMateriasEdit() {
  const sel = $("editEstAddMateria");
  sel.innerHTML = "";
  const libres = opcionesMateriasSinAsignar(tempMateriasEstudiante);
  sel.add(new Option(libres.length ? "Selecciona materia a añadir" : "Ya tiene todas las materias", ""));
  libres.forEach(m => sel.add(new Option(m.nombre, m.id)));
}

function actualizarUIEditMateriasEst() {
  refrescarSelectMateriasEdit();
  const ul = $("editEstMateriasList");
  ul.innerHTML = "";

  if (tempMateriasEstudiante.length === 0) {
    ul.innerHTML = "<li><small>Ninguna materia asignada.</small></li>";
    return;
  }

  tempMateriasEstudiante.forEach(matId => {
    const li = document.createElement("li");

    const span = document.createElement("span");
    span.textContent = materiasMap[matId] || "Materia desconocida";

    const btn = document.createElement("button");
    btn.className = "small danger";
    btn.textContent = "X";
    btn.onclick = () => removerTempMateria(matId);

    li.appendChild(span);
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

function removerTempMateria(matId) {
  tempMateriasEstudiante = tempMateriasEstudiante.filter(id => id !== matId);
  actualizarUIEditMateriasEst();
}

function addMateriaToEditEst() {
  const matId = $("editEstAddMateria").value;
  if (!matId) return;
  if (tempMateriasEstudiante.includes(matId)) {
    return showMessage("Ya tiene asignada esta materia.", "error");
  }
  tempMateriasEstudiante.push(matId);
  $("editEstAddMateria").value = "";
  actualizarUIEditMateriasEst();
}

async function guardarEdicionEstudiante() {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede editar.", "error");
  clearFields(["editEstNombres", "editEstApellidos", "editEstGrado", "editEstTelefono", "editEstCorreo", "editEstRepresentante"]);
  const cedula = $("editEstCedula").value;
  const nombres = normalizarTexto($("editEstNombres").value);
  const apellidos = normalizarTexto($("editEstApellidos").value);

  if (!validarNombre(nombres)) return showFieldError("editEstNombres", "Nombres inválidos.");
  if (!validarNombre(apellidos)) return showFieldError("editEstApellidos", "Apellidos inválidos.");
  if (!validarGrado($("editEstGrado").value)) return showFieldError("editEstGrado", "El grado es obligatorio (ejemplo: 3º A).");
  if (!validarTelefono($("editEstTelefono").value)) return showFieldError("editEstTelefono", "Solo números, +, ( ) y guiones (6 a 20).");
  if (!validarCorreoOpcional($("editEstCorreo").value)) return showFieldError("editEstCorreo", "Correo no válido.");
  if (!validarRepresentante($("editEstRepresentante").value)) return showFieldError("editEstRepresentante", "Solo letras y espacios.");
  const extra = camposExtraEstudiante({
    grado: $("editEstGrado").value, telefono: $("editEstTelefono").value,
    correo: $("editEstCorreo").value, representante: $("editEstRepresentante").value
  });

  try {
    const batch = db.batch();
    batch.update(db.collection("estudiantes").doc(cedula), { nombres, apellidos, ...extra });

    // Solo se tocan las asignaciones que cambian (quitar las que sobran, crear las nuevas)
    const quedan = new Set(tempMateriasEstudiante);
    const yaExisten = new Set(relacionesOriginales.map(r => r.materiaId));

    relacionesOriginales.forEach(r => {
      if (!quedan.has(r.materiaId)) {
        batch.delete(db.collection("materia_estudiante").doc(r.id));
      }
    });

    tempMateriasEstudiante.forEach(matId => {
      if (!yaExisten.has(matId)) {
        batch.set(db.collection("materia_estudiante").doc(`${cedula}_${matId}`), {
          cedula,
          materiaId: matId,
          creadoEn: serverTs(),
          creadoPor: auth.currentUser.email
        });
      }
    });

    await batch.commit();
    showMessage("Estudiante actualizado exitosamente.", "success");
    cerrarEditStudentModal();
    invalidarCacheEstudiantes();
    buscarEstudiantes();
  } catch (e) {
    showMessage("Error al guardar: " + traducirErrorFirebase(e), "error");
  }
}

async function eliminarEstudiante(cedula) {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede eliminar.", "error");

  const password = await pedirPassword();
  if (!password) return;

  try {
    await reautenticar(password);
  } catch (e) {
    return showMessage("Contraseña incorrecta.", "error");
  }

  try {
    const matSnap = await db.collection("materia_estudiante").where("cedula", "==", cedula).get();
    const refs = matSnap.docs.map(d => d.ref);
    refs.push(db.collection("estudiantes").doc(cedula));
    await borrarEnLotes(refs);

    invalidarCacheEstudiantes();
    showMessage("Estudiante eliminado. Su historial de asistencias se conserva.", "success");
    buscarEstudiantes();
  } catch (e) {
    showMessage("Error al eliminar: " + traducirErrorFirebase(e), "error");
  }
}

// ===============================
// EXPORTACIÓN DE CARNET QR
// ===============================

async function exportarQRPNG() {
  const exportArea = $("qrExportArea");
  const cedulaStr = $("qrCedulaDisplay").textContent.replace("Cédula: ", "");
  try {
    await cargarLibreria("captura");
    const canvas = await html2canvas(exportArea, {
      scale: 2,
      backgroundColor: "#ffffff",
      onclone: (doc) => {
        const c = doc.querySelector('#qrCanvas');
        c.getContext('2d', { willReadFrequently: true });
      }
    });

    const link = document.createElement("a");
    link.download = `Carnet_${cedulaStr}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    showMessage("Imagen PNG descargada.", "success");
  } catch (error) {
    showMessage("Error al exportar PNG.", "error");
  }
}

// Carnet individual: hoja A4 con el carnet del mismo tamaño que en el PDF en lote (90 × 65 mm),
// colocado en la primera posición de la hoja, listo para imprimir y recortar.
async function exportarQRPDF() {
  const cedulaStr = $("qrCedulaDisplay").textContent.replace("Cédula: ", "");
  const nombre = $("qrNombreDisplay").textContent || "Estudiante";
  try {
    await Promise.all([cargarLibreria("qr"), cargarLibreria("pdf")]);
    const qr = await QRCode.toDataURL(cedulaStr, { width: 300, margin: 1 });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("portrait", "mm", "a4");
    const { x, y } = posicionCarnet(0);
    dibujarCarnet(pdf, x, y, nombre, cedulaStr, qr);
    pdf.save(`Carnet_${cedulaStr}.pdf`);
    showMessage("Documento PDF descargado.", "success");
  } catch (error) {
    showMessage("Error al exportar PDF.", "error");
  }
}

async function mostrarQR(cedulaValue, nombreCompleto) {
  $("qrModal").style.display = "block";

  $("qrNombreDisplay").textContent = nombreCompleto || "Estudiante";
  $("qrCedulaDisplay").textContent = `Cédula: ${cedulaValue}`;

  try {
    await cargarLibreria("qr");
  } catch (e) {
    return showMessage(TEXTO_ERROR_LIBRERIA, "error");
  }
  QRCode.toCanvas($("qrCanvas"), cedulaValue, { width: 250, margin: 2 }, error => {
    if (error) showMessage("No se pudo generar QR.", "error");
  });
}

function cerrarQR() { $("qrModal").style.display = "none"; }

// ===============================
// ASIGNACIÓN RÁPIDA
// ===============================

// En la asignación rápida, al escribir la cédula solo se ofrecen las materias que aún no tiene
async function filtrarMateriasAsignar() {
  const sel = $("materiaSelect");
  const ced = ($("cedulaAsignar").value || "").trim();
  let yaAsignadas = [];

  if (validarCedula(ced)) {
    try {
      await cargarCacheEstudiantes();
      yaAsignadas = cacheEst.relaciones.filter(r => r.cedula === ced).map(r => r.materiaId);
    } catch (e) { /* sin caché: se muestran todas */ }
  }

  sel.innerHTML = "";
  const libres = opcionesMateriasSinAsignar(yaAsignadas);
  const vacio = materiasLista.length === 0;
  sel.add(new Option(vacio ? "Sin materias" : (libres.length ? "Selecciona una materia" : "Ya tiene todas las materias"), ""));
  libres.forEach(m => sel.add(new Option(m.nombre, m.id)));
}

async function asignar() {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede asignar.", "error");
  if (!validarAsignacionCampos()) return;
  const ced = $("cedulaAsignar").value.trim();
  const matId = $("materiaSelect").value;

  try {
    const est = await db.collection("estudiantes").doc(ced).get();
    if (!est.exists) return showFieldError("cedulaAsignar", "Estudiante no existe.");

    const dup = await db.collection("materia_estudiante")
      .where("cedula", "==", ced)
      .where("materiaId", "==", matId)
      .get();
    if (!dup.empty) return showMessage("Ya está asignado a esa materia.", "error");

    // ID determinista: evita duplicados aunque se pulse dos veces
    await db.collection("materia_estudiante").doc(`${ced}_${matId}`).set({
      cedula: ced,
      materiaId: matId,
      creadoEn: serverTs(),
      creadoPor: auth.currentUser.email
    });

    showMessage("Asignado correctamente.", "success");
    limpiarInput("cedulaAsignar");
    clearFields(["cedulaAsignar", "materiaSelect"]);
    invalidarCacheEstudiantes();
    await filtrarMateriasAsignar();
  } catch (e) {
    showMessage("Error: " + traducirErrorFirebase(e), "error");
  }
}

// ===============================
// DOCENTES DE UNA MATERIA (solo admin)
// ===============================

async function cargarUsuariosCache() {
  const snap = await db.collection("users").get();
  usuariosMap = {};
  snap.forEach(d => { usuariosMap[d.id] = { uid: d.id, ...d.data() }; });
}

function nombreUsuario(u) {
  return u.nombre ? `${u.nombre} (${u.email})` : (u.email || u.uid);
}

function abrirDocentesMateria(materiaId) {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede asignar docentes.", "error");
  const materia = materiasLista.find(m => m.id === materiaId);
  if (!materia) return;

  docentesCtx = { materiaId };
  docentesChecks = [];
  $("docentesMateriaNombre").textContent = materia.nombre;

  const ul = $("docentesLista");
  ul.innerHTML = "";

  const docentes = Object.values(usuariosMap)
    .filter(u => u.role === "profesor")
    .sort((a, b) => nombreUsuario(a).localeCompare(nombreUsuario(b)));

  if (docentes.length === 0) {
    ul.innerHTML = "<li><small>No hay docentes. Créalos en Administración.</small></li>";
  }

  docentes.forEach(u => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    label.style.cssText = "display:flex; gap:10px; align-items:center; margin:0; font-weight:normal;";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = u.uid;
    cb.style.width = "auto";
    cb.style.margin = "0";
    cb.checked = (materia.profesores || []).includes(u.uid);
    docentesChecks.push(cb);

    const span = document.createElement("span");
    span.textContent = nombreUsuario(u);

    label.appendChild(cb);
    label.appendChild(span);
    li.appendChild(label);
    ul.appendChild(li);
  });

  $("docentesModal").style.display = "block";
}

function cerrarDocentesModal() {
  $("docentesModal").style.display = "none";
  docentesCtx = null;
  docentesChecks = [];
}

async function guardarDocentesMateria() {
  if (currentUserRole !== "admin" || !docentesCtx) return;
  const uids = docentesChecks.filter(c => c.checked).map(c => c.value);

  try {
    await db.collection("materias").doc(docentesCtx.materiaId).update({ profesores: uids });
    showMessage("Docentes actualizados.", "success");
    cerrarDocentesModal();
    await cargarMaterias();
  } catch (e) {
    showMessage("No se pudieron guardar los docentes: " + traducirErrorFirebase(e), "error");
  }
}
