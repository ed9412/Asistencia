
// ===============================
// SONIDOS (WebAudio: no dependen de internet)
// ===============================

let audioCtx = null;

// Debe llamarse desde un gesto del usuario (clic) para que el navegador permita sonar
function prepararAudio() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (e) { /* sin audio: no es crítico */ }
}

function tono(frecuencia, duracion, tipo = "sine", volumen = 0.2, retardo = 0) {
  if (!audioCtx) return;
  try {
    const t0 = audioCtx.currentTime + retardo;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = tipo;
    osc.frequency.value = frecuencia;
    gain.gain.setValueAtTime(volumen, t0);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + duracion);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + duracion);
  } catch (e) { /* ignorar */ }
}

function beep() {
  tono(880, 0.12, "sine", 0.2);
  tono(1320, 0.12, "sine", 0.2, 0.1);
}

function beepError() {
  tono(220, 0.18, "square", 0.15);
  tono(160, 0.28, "square", 0.15, 0.2);
}

// ===============================
// BORRADOR DE LA LISTA EN CURSO
// (se guarda en este dispositivo para no perder lo escaneado)
// ===============================

function claveBorrador() {
  return `asistencia_borrador_${auth.currentUser ? auth.currentUser.uid : "anon"}`;
}

// Guarda solo lo pendiente de enviar; lo que ya está en Firestore se vuelve a cargar de allí
function guardarBorrador() {
  if (!listaActiva || !listaCtx) return;
  try {
    const pendientes = [];
    marcas.forEach((m, ced) => {
      if (!m.guardado) pendientes.push([ced, m.estado, m.hora || "", m.ts || null, m.motivo || ""]);
    });
    localStorage.setItem(claveBorrador(), JSON.stringify({
      v: 2,
      materiaId: listaCtx.materiaId,
      fecha: listaCtx.fecha,
      marcas: pendientes,
      guardadoEn: Date.now()
    }));
  } catch (e) { /* almacenamiento no disponible */ }
}

function borrarBorrador() {
  try { localStorage.removeItem(claveBorrador()); } catch (e) { /* ignorar */ }
}

// Acepta el formato de la Fase 1 ([cedula, hora, ts]) y el actual ([cedula, estado, hora, ts, motivo])
function normalizarEntradaBorrador(e) {
  if (!Array.isArray(e) || !e[0]) return null;
  if (e.length === 3) return { cedula: String(e[0]), estado: "presente", hora: e[1] || "", ts: e[2] || null, motivo: "" };
  return {
    cedula: String(e[0]),
    estado: ESTADOS[e[1]] ? e[1] : "presente",
    hora: e[2] || "",
    ts: e[3] || null,
    motivo: e[4] || ""
  };
}

function leerBorrador() {
  try {
    const raw = localStorage.getItem(claveBorrador());
    if (!raw) return null;
    const b = JSON.parse(raw);
    if (!b || !b.materiaId || !b.fecha) return null;
    if (Date.now() - (b.guardadoEn || 0) > BORRADOR_MAX_MS) {
      borrarBorrador();
      return null;
    }
    const entradas = (b.marcas || b.presentes || []).map(normalizarEntradaBorrador).filter(Boolean);
    return { materiaId: b.materiaId, fecha: b.fecha, entradas };
  } catch (e) {
    return null;
  }
}

async function ofrecerRestaurarBorrador() {
  const b = leerBorrador();
  if (!b) return;

  const n = b.entradas.length;
  if (!materiasMap[b.materiaId] || n === 0) {
    borrarBorrador();
    return;
  }

  const continuar = confirm(
    `Hay una lista sin guardar de "${materiasMap[b.materiaId]}" (${formatarFechaUI(b.fecha)}) con ${n} registro(s).\n\n¿Quieres continuarla?`
  );
  if (!continuar) {
    borrarBorrador();
    return;
  }

  $("materiaLista").value = b.materiaId;
  $("fechaLista").value = b.fecha;
  await iniciarLista(b);
}

function hayCambiosSinGuardar() {
  for (const m of marcas.values()) {
    if (!m.guardado) return true;
  }
  return false;
}

// ===============================
// PASAR LISTA
// ===============================

function modoRegistroActual() {
  const v = $("modoRegistro").value;
  return ["presente", "tardanza", "justificado"].includes(v) ? v : "presente";
}

// Estado que tiene un estudiante en la lista en curso (sin marca = falta)
function estadoEnLista(ced) {
  const m = marcas.get(ced);
  return m ? m.estado : "falta";
}

// Un registro ya guardado (no falta) en una fecha anterior solo lo modifica el admin
function puedeCambiarMarca(ced) {
  const ex = existentesMap.get(ced);
  if (ex && estadoDe(ex.data) !== "falta" && !puedeModificarGuardado(listaCtx.fecha)) {
    showMessage("Esa asistencia ya está guardada en una fecha anterior: solo un administrador puede modificarla.", "error");
    return false;
  }
  return true;
}

async function iniciarLista(borrador) {
  precargarLibreria("lector");   // se descarga mientras se prepara la lista
  let materiaId, fecha;

  if (borrador && borrador.materiaId) {
    materiaId = borrador.materiaId;
    fecha = borrador.fecha;
  } else {
    borrador = null;
    if (!validarInicioListaCampos()) return;
    materiaId = $("materiaLista").value;
    fecha = $("fechaLista").value;
  }

  if (!materiasMap[materiaId]) {
    return showMessage("Esa materia no está entre tus materias asignadas.", "error");
  }

  prepararAudio();

  const materiaNombre = materiasMap[materiaId];
  const btnIniciar = $("btnIniciarLista");

  try {
    btnIniciar.disabled = true;
    btnIniciar.innerHTML = `Cargando estudiantes... <span class="loader"></span>`;

    // Estudiantes de la materia y asistencia ya guardada para esa fecha, en paralelo
    const [rel, exist] = await Promise.all([
      db.collection("materia_estudiante").where("materiaId", "==", materiaId).get(),
      db.collection("asistencias").where("materia", "==", materiaId).where("fecha", "==", fecha).get()
    ]);

    if (rel.empty) return showMessage("No hay estudiantes asignados a esta materia.", "error");

    const cedulas = Array.from(new Set(rel.docs.map(r => r.data().cedula)));
    const docs = await Promise.all(cedulas.map(c => db.collection("estudiantes").doc(c).get()));

    const porCedula = new Map();
    docs.forEach(d => { if (d.exists) porCedula.set(d.id, d.data()); });
    if (porCedula.size === 0) return showMessage("Los estudiantes asignados ya no existen.", "error");

    estudiantesMateria = Array.from(porCedula.values()).sort((a, b) =>
      a.apellidos.localeCompare(b.apellidos) || a.nombres.localeCompare(b.nombres)
    );

    // Lo que ya estaba guardado se respeta: no se vuelve a escribir ni se sobrescribe
    existentesMap = new Map();
    exist.forEach(d => existentesMap.set(d.data().cedula, { id: d.id, data: d.data() }));

    marcas = new Map();

    existentesMap.forEach((ex, ced) => {
      if (!porCedula.has(ced)) return;
      const estado = estadoDe(ex.data);
      if (estado === "falta") return;   // sigue figurando como faltante (se puede corregir)
      const ts = ex.data.horaTs && ex.data.horaTs.toMillis ? ex.data.horaTs.toMillis() : null;
      marcas.set(ced, { estado, hora: ex.data.hora || "", ts, motivo: ex.data.motivo || "", guardado: true });
    });

    // Restaurar lo escaneado (y los cambios) antes de que se cerrara la página
    if (borrador) {
      borrador.entradas.forEach(e => {
        if (!porCedula.has(e.cedula)) return;
        const ex = existentesMap.get(e.cedula);
        const guardadaNoFalta = ex && estadoDe(ex.data) !== "falta";
        if (guardadaNoFalta && !puedeModificarGuardado(fecha)) return;
        if (e.estado === "falta" && !guardadaNoFalta) return;
        marcas.set(e.cedula, { estado: e.estado, hora: e.hora, ts: e.ts, motivo: e.motivo, guardado: false });
      });
    }

    listaCtx = { materiaId, materiaNombre, fecha };
    listaActiva = true;

    $("txtMateriaActiva").textContent = materiaNombre;
    $("txtFechaActiva").textContent = formatarFechaUI(fecha);
    $("formInicioLista").style.display = "none";
    $("infoListaActiva").style.display = "block";
    $("zonaLista").style.display = "block";

    refrescarListas();
    guardarBorrador();

    if (borrador) showMessage("Lista restaurada.", "success");
    else if (existentesMap.size > 0) showMessage("Ya había asistencia guardada para esta fecha: se cargó para continuar.", "info");
    else showMessage("Lista iniciada.", "success");

  } catch (e) {
    showMessage("Error al iniciar lista: " + traducirErrorFirebase(e), "error");
  } finally {
    btnIniciar.disabled = false;
    btnIniciar.innerHTML = "Iniciar lista";
  }
}

async function cancelarLista() {
  if (hayCambiosSinGuardar() && !confirm("Hay asistencias sin guardar. ¿Cancelar la lista y descartarlas?")) {
    return;
  }

  await detenerEscaner();
  borrarBorrador();
  resetUILista();

  limpiarInput("manualCedula");
  clearFieldError("manualCedula");
  $("materiaLista").selectedIndex = 0;
  preseleccionarMateriaUnica();
  establecerFechaActualPorDefecto();

  showMessage("Lista cancelada.", "info");
}

async function iniciarEscaner() {
  if (!listaActiva) return showMessage("Primero inicia la lista.", "error");
  if (html5QrCode) return showMessage("La cámara ya está activa.", "info");

  prepararAudio();

  try {
    await cargarLibreria("lector");
    html5QrCode = new Html5Qrcode("reader");
    await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 },
      code => {
        const codigo = String(code).trim();
        const ahora = Date.now();
        // Ignorar solo la repetición del MISMO código en 3 s; otro estudiante entra al instante
        if (codigo === ultimoEscaneo.codigo && ahora - ultimoEscaneo.ts < 3000) return;
        ultimoEscaneo = { codigo, ts: ahora };
        registrarAsistencia(codigo);
      });
    showMessage("Cámara iniciada.", "success");
  } catch (e) {
    html5QrCode = null;
    showMessage("No se pudo iniciar la cámara. Revisa los permisos del navegador.", "error");
  }
}

async function detenerEscaner() {
  if (!html5QrCode) return;
  try {
    await html5QrCode.stop();
    html5QrCode.clear();
  } catch (e) { /* ya estaba detenida */ }
  html5QrCode = null;
}

function registrarManual() {
  prepararAudio();
  if (!validarManualCedula()) return;
  registrarAsistencia($("manualCedula").value.trim());
}

// Todo se valida en memoria: no hace lecturas a Firestore por cada escaneo.
// El estado (presente o tardanza) lo marca el selector "Registrar como".
// Todo se valida en memoria: no hace lecturas a Firestore por cada escaneo.
// El estado lo marca el selector "Registrar como" (presente, tardanza o justificado).
function registrarAsistencia(ced) {
  clearFieldError("manualCedula");
  if (correccionCtx) return;   // hay un cuadro de cambio de estado abierto

  if (!listaActiva || !listaCtx) {
    beepError();
    return showMessage("Inicia la lista primero.", "error");
  }

  if (!validarCedula(ced)) {
    showFieldError("manualCedula", "Código no válido.");
    beepError();
    return showMessage("Código no válido.", "error");
  }

  const est = estudiantesMateria.find(e => e.cedula === ced);
  if (!est) {
    showFieldError("manualCedula", "No pertenece a esta materia.");
    beepError();
    return showMessage("Ese estudiante no pertenece a esta materia.", "error");
  }

  const nombre = `${est.nombres} ${est.apellidos}`;
  const actual = estadoEnLista(ced);
  const estado = modoRegistroActual();

  if (actual === estado) {
    beepError();
    return showMessage(`${nombre} ya figura como ${ESTADOS[actual].texto.toLowerCase()}.`, "error");
  }

  if (!puedeCambiarMarca(ced)) {
    beepError();
    return;
  }

  // Ya estaba registrado con otro estado: pedir confirmación antes de cambiarlo
  if (actual !== "falta" &&
      !confirm(`${nombre} ya figura como ${ESTADOS[actual].texto}.\n\n¿Cambiarlo a ${ESTADOS[estado].texto}?`)) {
    return;
  }

  // Justificar necesita un motivo: se pide en el cuadro de cambio de estado
  if (estado === "justificado") {
    limpiarInput("manualCedula");
    return abrirCorreccion({ tipo: "temporal", cedula: ced, nombre, estadoSugerido: "justificado" });
  }

  aplicarCorreccionTemporal(ced, estado, "", true);
}

function refrescarListas() {
  actualizarPresentes();
  actualizarJustificados();
  actualizarFaltantes();
}

function nombreEstudianteLista(ced) {
  const est = estudiantesMateria.find(e => e.cedula === ced);
  return est ? `${est.nombres} ${est.apellidos}` : "";
}

function actualizarPresentes() {
  const ul = $("presentes");
  ul.innerHTML = "";

  const asistentes = [];
  marcas.forEach((m, ced) => { if (ESTADOS_ASISTE.includes(m.estado)) asistentes.push([ced, m]); });
  $("contPresentes").textContent = `(${asistentes.length}/${estudiantesMateria.length})`;

  if (asistentes.length === 0) {
    ul.innerHTML = "<li class=\"vacio-lista\">No hay presentes.</li>";
    return;
  }

  // Los últimos en llegar, arriba
  asistentes.reverse().forEach(([ced, m]) => {
    const nombre = nombreEstudianteLista(ced);
    const li = document.createElement("li");
    li.innerHTML = `${ESTADOS[m.estado].icono} <strong>${esc(ced)}</strong> · ${esc(ESTADOS[m.estado].texto)}<br>${esc(nombre)}<br><small>Hora: ${esc(m.hora || "")}</small><br>`;
    li.appendChild(botonCambiarEstado(ced, nombre));
    ul.appendChild(li);
  });
}

function botonCambiarEstado(ced, nombre, texto = "Cambiar estado") {
  const btn = document.createElement("button");
  btn.className = "small secondary";
  btn.textContent = texto;
  btn.onclick = () => abrirCorreccion({ tipo: "temporal", cedula: ced, nombre });
  return btn;
}

function actualizarJustificados() {
  const ul = $("justificados");
  ul.innerHTML = "";

  const justificados = [];
  marcas.forEach((m, ced) => { if (m.estado === "justificado") justificados.push([ced, m]); });
  $("contJustificados").textContent = `(${justificados.length})`;

  if (justificados.length === 0) {
    ul.innerHTML = "<li class=\"vacio-lista\">No hay justificados.</li>";
    return;
  }

  justificados.forEach(([ced, m]) => {
    const nombre = nombreEstudianteLista(ced);
    const li = document.createElement("li");
    li.innerHTML = `${ESTADOS.justificado.icono} <strong>${esc(ced)}</strong><br>${esc(nombre)}<br><small>Motivo: ${esc(m.motivo || "")}</small><br>`;
    li.appendChild(botonCambiarEstado(ced, nombre));
    ul.appendChild(li);
  });
}

function actualizarFaltantes() {
  const ul = $("faltantes");
  ul.innerHTML = "";
  const faltantes = estudiantesMateria.filter(e => estadoEnLista(e.cedula) === "falta");
  $("contFaltantes").textContent = `(${faltantes.length})`;

  if (faltantes.length === 0) {
    ul.innerHTML = "<li class=\"vacio-lista\">No hay faltantes.</li>";
    return;
  }

  faltantes.forEach(est => {
    const nombre = `${est.nombres} ${est.apellidos}`;
    const li = document.createElement("li");
    li.innerHTML = `${ESTADOS.falta.icono} <strong>${esc(est.cedula)}</strong><br>${esc(nombre)}<br>`;

    const btnJust = document.createElement("button");
    btnJust.className = "small";
    btnJust.textContent = "📝 Justificar";
    btnJust.onclick = () => abrirCorreccion({ tipo: "temporal", cedula: est.cedula, nombre, estadoSugerido: "justificado" });

    li.appendChild(btnJust);
    li.appendChild(botonCambiarEstado(est.cedula, nombre));
    ul.appendChild(li);
  });
}

// Calcula qué escribir en Firestore al cerrar la lista (función pura, fácil de probar):
//  - estudiante sin registro previo                    -> crear (con su estado, o "falta")
//  - figuraba como falta y ahora tiene otro estado     -> actualizar
//  - cualquier otro caso                               -> no tocar (no se sobrescribe nada)
function calcularOperacionesLista({ estudiantes, marcas, existentes, ctx, profesor, profesorNombre, marcaServidor, aTimestamp, borrarCampo }) {
  const ops = [];

  estudiantes.forEach(est => {
    const m = marcas.get(est.cedula);
    const estado = m ? m.estado : "falta";
    const asiste = ESTADOS_ASISTE.includes(estado);
    const hora = asiste ? ((m && m.hora) || horaTexto()) : null;
    const horaTs = asiste && m && m.ts ? aTimestamp(m.ts) : null;
    const motivo = estado === "justificado" && m ? (m.motivo || "") : "";
    const ex = existentes.get(est.cedula);

    if (!ex) {
      // Sin registro previo: se crea (con su estado, o "falta")
      const data = {
        cedula: est.cedula,
        nombres: est.nombres,
        apellidos: est.apellidos,
        materia: ctx.materiaId,
        materiaNombre: ctx.materiaNombre,
        fecha: ctx.fecha,
        estado,
        presente: asiste,
        hora,
        horaTs,
        profesor,
        profesorNombre,
        actualizadoEn: marcaServidor
      };
      if (motivo) data.motivo = motivo;
      ops.push({ tipo: "set", id: `${est.cedula}_${ctx.fecha}_${ctx.materiaId}`, data });
      return;
    }

    const exEstado = estadoDe(ex.data);

    if (exEstado === "falta") {
      // Figuraba como falta y ahora tiene otro estado: lo registró quien pasa la lista
      if (estado !== "falta") {
        const data = { estado, presente: asiste, hora, horaTs, actualizadoEn: marcaServidor, profesor, profesorNombre };
        if (motivo) data.motivo = motivo;
        ops.push({ tipo: "update", id: ex.id, data });
      }
    } else if (estado !== exEstado || (estado === "justificado" && motivo !== (ex.data.motivo || ""))) {
      // Corrección de algo ya guardado: queda marcada como corregida
      const data = {
        estado, presente: asiste, hora, horaTs,
        actualizadoEn: marcaServidor,
        corregido: true, corregidoPor: profesor, corregidoEn: marcaServidor
      };
      if (esNombreReal(profesorNombre)) data.corregidoPorNombre = profesorNombre;
      if (estado === "justificado") data.motivo = motivo;
      else if (ex.data.motivo !== undefined) data.motivo = borrarCampo();
      ops.push({ tipo: "update", id: ex.id, data });
    }
  });

  return ops;
}

async function cerrarLista() {
  if (!listaActiva || !listaCtx) return showMessage("Inicia la lista primero.", "error");

  const btn = $("btnGuardarLista");
  btn.disabled = true;

  try {
    await asegurarNombre();
    const ops = calcularOperacionesLista({
      estudiantes: estudiantesMateria,
      marcas,
      existentes: existentesMap,
      ctx: listaCtx,
      profesor: auth.currentUser.email,
      profesorNombre: nombreActor(),
      marcaServidor: serverTs(),
      aTimestamp: ms => firebase.firestore.Timestamp.fromMillis(ms),
      borrarCampo: () => firebase.firestore.FieldValue.delete()
    });

    // Resumen del día (conteos finales) para el dashboard. Si esta vez se guardó algo,
    // quien guarda pasa a ser quien «terminó» la lista; si no hubo cambios, se conserva el anterior.
    const resumen = datosResumenDia(
      listaCtx.materiaId, listaCtx.fecha,
      conteosDelDia(existentesMap, ops),
      marcaServidorResumen(),
      ops.length > 0 ? { email: auth.currentUser.email, nombre: nombreActor() } : null
    );

    // Escritura en lotes (rápida y atómica por lote). El resumen va en el último lote.
    for (let i = 0; i < ops.length || i === 0; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(op => {
        const ref = db.collection("asistencias").doc(op.id);
        if (op.tipo === "set") batch.set(ref, op.data);
        else batch.update(ref, op.data);
      });
      if (i + 400 >= ops.length) {
        batch.set(db.collection("resumenes_dia").doc(`${listaCtx.materiaId}_${listaCtx.fecha}`), resumen, { merge: true });
      }
      await batch.commit();
    }

    showMessage(ops.length > 0 ? `Lista guardada (${ops.length} registro(s)).` : "No había cambios nuevos que guardar.", "success");

    await detenerEscaner();
    borrarBorrador();
    resetUILista();
    $("materiaLista").selectedIndex = 0;
  preseleccionarMateriaUnica();
    establecerFechaActualPorDefecto();
  } catch (e) {
    showMessage("No se pudo guardar la lista: " + traducirErrorFirebase(e), "error");
  } finally {
    btn.disabled = false;
  }
}

// ===============================
// CORRECCIÓN DE ESTADO (en la lista en curso basta confirmar; sobre lo guardado, con contraseña)
// ===============================

// ctx: { tipo: "temporal" (lista en curso) | "historial" (registro ya guardado), cedula, docId, nombre, estadoActual }
function abrirCorreccion(ctx) {
  if (ctx.tipo === "temporal" && !puedeCambiarMarca(ctx.cedula)) return;

  correccionCtx = ctx;
  const actual = ctx.estadoActual || (ctx.tipo === "temporal" ? estadoEnLista(ctx.cedula) : "falta");
  ctx.estadoActual = actual;

  $("correccionAlumno").textContent = ctx.nombre || "";

  const sel = $("correccionEstado");
  sel.innerHTML = "";
  // Sobre una lista ya guardada, «justificado» solo se ofrece a quien está en falta
  const opciones = ["presente", "tardanza", "justificado", "falta"]
    .filter(e => !(ctx.tipo === "historial" && e === "justificado" && actual !== "falta" && actual !== "justificado"));
  opciones.forEach(e => {
    sel.add(new Option(`${ESTADOS[e].icono} ${ESTADOS[e].texto}${e === actual ? " (actual)" : ""}`, e));
  });
  sel.value = (ctx.estadoSugerido && ctx.estadoSugerido !== actual)
    ? ctx.estadoSugerido
    : (opciones.find(e => e !== actual && e !== "falta") || "presente");

  // En la lista en curso basta con confirmar; sobre un registro guardado se pide la contraseña
  $("correccionPasswordBloque").style.display = ctx.tipo === "historial" ? "block" : "none";

  $("correccionMotivo").value = "";
  $("correccionPassword").value = "";
  clearFields(["correccionMotivo", "correccionPassword"]);
  $("correccionModal").style.display = "block";
}

function cerrarCorreccion() {
  $("correccionModal").style.display = "none";
  correccionCtx = null;
}

async function confirmarCorreccion() {
  if (!correccionCtx) return;
  clearFields(["correccionMotivo", "correccionPassword"]);

  const ctx = correccionCtx;
  const pideClave = ctx.tipo === "historial";
  const estado = $("correccionEstado").value;
  const motivo = normalizarTexto($("correccionMotivo").value);
  const password = $("correccionPassword").value;

  let ok = true;
  if (!ESTADOS[estado]) ok = false;
  if (estado === "justificado" && motivo.length < MOTIVO_MIN) {
    showFieldError("correccionMotivo", `Escribe el motivo (mínimo ${MOTIVO_MIN} caracteres).`);
    ok = false;
  }
  if (motivo.length > MOTIVO_MAX) {
    showFieldError("correccionMotivo", `Máximo ${MOTIVO_MAX} caracteres.`);
    ok = false;
  }
  if (pideClave && !password) {
    showFieldError("correccionPassword", "Ingresa tu contraseña.");
    ok = false;
  }
  if (!ok) return;

  if (estado === ctx.estadoActual && estado !== "justificado") {
    cerrarCorreccion();
    return showMessage("Sin cambios.", "info");
  }

  if (pideClave) {
    try {
      await reautenticar(password);
    } catch (e) {
      return showFieldError("correccionPassword", "Contraseña incorrecta.");
    }
  }

  cerrarCorreccion();

  if (ctx.tipo === "temporal") aplicarCorreccionTemporal(ctx.cedula, estado, motivo);
  else await aplicarCorreccionHistorial(ctx, estado, motivo);
}

function aplicarCorreccionTemporal(cedula, estado, motivo, conSonido = false) {
  const ahora = new Date();
  const asiste = ESTADOS_ASISTE.includes(estado);
  const previa = marcas.get(cedula);
  const ex = existentesMap.get(cedula);
  const guardadaNoFalta = !!ex && estadoDe(ex.data) !== "falta";

  if (estado === "falta") {
    // Quitar la marca; si ya estaba guardada con otro estado hay que dejarla anotada como falta
    if (guardadaNoFalta) marcas.set(cedula, { estado: "falta", hora: "", ts: null, motivo: "", guardado: false });
    else marcas.delete(cedula);
  } else {
    // Pasar de presente a tardanza (o al revés) conserva la hora original
    const conservaHora = asiste && previa && ESTADOS_ASISTE.includes(previa.estado) && previa.hora;
    marcas.set(cedula, {
      estado,
      hora: asiste ? (conservaHora ? previa.hora : horaTexto(ahora)) : "",
      ts: asiste ? (conservaHora ? previa.ts : ahora.getTime()) : null,
      motivo: estado === "justificado" ? motivo : "",
      guardado: false
    });
  }

  if (conSonido) beep();
  refrescarListas();
  limpiarInput("manualCedula");
  clearFieldError("manualCedula");
  guardarBorrador();
  showMessage(`${ESTADOS[estado].icono} ${nombreEstudianteLista(cedula)}`, "success");
}

// ctx: { docId, materia, fecha, estadoActual, ... }
async function aplicarCorreccionHistorial(ctx, estado, motivo) {
  await asegurarNombre();   // si el perfil no tiene nombre, se pide para que no salga el correo
  const ahora = new Date();
  const asiste = ESTADOS_ASISTE.includes(estado);

  const datos = {
    estado,
    presente: asiste,
    motivo: estado === "justificado" ? motivo : firebase.firestore.FieldValue.delete(),
    corregido: true,
    corregidoPor: auth.currentUser.email,
    corregidoEn: serverTs(),
    actualizadoEn: serverTs()
  };
  if (esNombreReal(nombreActor())) datos.corregidoPorNombre = nombreActor();

  if (!asiste) {
    datos.hora = null;
    datos.horaTs = null;
  } else if (!ESTADOS_ASISTE.includes(ctx.estadoActual)) {
    // Antes no había asistido: la hora es la de la corrección. Si ya había asistido, se conserva.
    datos.hora = horaTexto(ahora);
    datos.horaTs = firebase.firestore.Timestamp.fromMillis(ahora.getTime());
  }

  try {
    await db.collection("asistencias").doc(ctx.docId).update(datos);
    showMessage("Registro actualizado.", "success");
    if (ctx.materia && ctx.fecha) {
      try { await recalcularResumenDia(ctx.materia, ctx.fecha); }
      catch (e) { showMessage("El registro se guardó, pero no se pudo actualizar el resumen del dashboard.", "info"); }
    }
    if (typeof refrescarDetalleHistorial === "function") await refrescarDetalleHistorial();
  } catch (e) {
    showMessage("No se pudo actualizar: " + traducirErrorFirebase(e), "error");
  }
}
