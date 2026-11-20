// ===============================
// CAMBIOS EN MASA DE ESTUDIANTES (solo admin)
// - Filtros por grado y selección múltiple en la lista
// - Cambiar el grado de varios a la vez
// - Pantalla «Materias en masa»: añadir, mover o quitar
// - Asistente «Pasar de curso»: nuevo grado para cada grupo
// El grado (campo del estudiante) y las materias (relación aparte) son procesos independientes.
// ===============================

let filtroGrado = "todos";          // "todos" | "__sin__" | clave de un grado
let modoSel = false;                // ¿está activa la selección múltiple?
const seleccion = new Set();        // cédulas seleccionadas
let cedulasMostradas = [];          // cédulas que muestra la lista ahora mismo

const LOTE_MAX = 400;

// Escribe en lotes de Firestore: cada operación recibe el batch
async function ejecutarEnLotes(operaciones) {
  for (let i = 0; i < operaciones.length; i += LOTE_MAX) {
    const batch = db.batch();
    operaciones.slice(i, i + LOTE_MAX).forEach(op => op(batch));
    await batch.commit();
  }
}

// ---------------------------------------------------------------
// Registro del último cambio en masa (para poder deshacerlo)
// ---------------------------------------------------------------

let ultimoCambio;   // undefined = sin cargar · null = no hay · objeto = el último registro

function crearRegistroCambio(tipo, resumen, grados, rels) {
  const id = Date.now().toString(36).padStart(9, "0") + Math.random().toString(36).slice(2, 7);
  const datos = { tipo, resumen: String(resumen).slice(0, 300), grados: grados || [], rels: rels || [], deshecho: false };
  const op = batch => batch.set(db.collection("cambios_masivos").doc(id), {
    ...datos, creadoEn: serverTs(), creadoPor: auth.currentUser.email
  });
  return { id, datos, op };
}

// Tras guardar bien, el registro pasa a ser «el último»
function recordarCambio(reg) {
  ultimoCambio = { id: reg.id, ...reg.datos, creadoEn: new Date() };
  actualizarBarraSel();
}

async function cargarUltimoCambio() {
  if (!esAdminMasivo()) return;
  try {
    const snap = await db.collection("cambios_masivos").orderBy("creadoEn", "desc").limit(1).get();
    ultimoCambio = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch (e) {
    ultimoCambio = null;   // por ejemplo, reglas sin publicar: simplemente no se ofrece deshacer
  }
  actualizarBarraSel();
}

function textoFechaCambio(c) {
  try {
    const f = c.creadoEn && c.creadoEn.toDate ? c.creadoEn.toDate() : (c.creadoEn instanceof Date ? c.creadoEn : null);
    return f ? f.toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short" }) : "";
  } catch (e) { return ""; }
}

async function deshacerUltimoCambio() {
  if (!esAdminMasivo()) return showMessage("Solo admin puede deshacer cambios.", "error");
  const c = ultimoCambio;
  if (!c || c.deshecho) return showMessage("No hay ningún cambio que deshacer.", "info");
  const cuando = textoFechaCambio(c);
  if (!confirm(`Vas a deshacer:\n${c.resumen}${cuando ? `\n(${cuando})` : ""}\n\nSolo se revierte lo que no se haya modificado después. ¿Continuar?`)) return;

  try {
    // Debe seguir siendo el último registro y no estar deshecho
    const ult = await db.collection("cambios_masivos").orderBy("creadoEn", "desc").limit(1).get();
    const actual = ult.empty ? null : { id: ult.docs[0].id, ...ult.docs[0].data() };
    if (!actual || actual.id !== c.id) {
      ultimoCambio = actual;
      actualizarBarraSel();
      return showMessage("Ya hay un cambio más reciente: ese no se puede deshacer desde aquí.", "error");
    }
    if (actual.deshecho) {
      ultimoCambio = actual;
      actualizarBarraSel();
      return showMessage("Ese cambio ya estaba deshecho.", "info");
    }

    await cargarCacheEstudiantes(true);
    const porCedula = {};
    cacheEst.estudiantes.forEach(e => { porCedula[e.cedula] = e; });
    const relPorPar = {};
    cacheEst.relaciones.forEach(r => { relPorPar[r.cedula + "|" + r.materiaId] = r; });

    const ops = [];
    let hechos = 0, omitidos = 0;
    (actual.grados || []).forEach(g => {
      const est = porCedula[g.c];
      // Solo si sigue teniendo el grado que puso el cambio
      if (!est || claveGrado(est.grado) !== claveGrado(g.d)) { omitidos++; return; }
      hechos++;
      ops.push(batch => batch.update(db.collection("estudiantes").doc(g.c),
        { grado: g.a ? g.a : firebase.firestore.FieldValue.delete() }));
    });
    (actual.rels || []).forEach(r => {
      const rel = relPorPar[r.c + "|" + r.m];
      if (r.t === "c") {            // el cambio la creó: se borra
        if (!rel) { omitidos++; return; }
        hechos++;
        ops.push(batch => batch.delete(db.collection("materia_estudiante").doc(rel.id)));
      } else {                      // el cambio la borró: se vuelve a crear
        if (rel || !porCedula[r.c] || !materiasMap[r.m]) { omitidos++; return; }
        hechos++;
        ops.push(batch => batch.set(db.collection("materia_estudiante").doc(`${r.c}_${r.m}`), {
          cedula: r.c, materiaId: r.m, creadoEn: serverTs(), creadoPor: auth.currentUser.email
        }));
      }
    });
    // Se marca como deshecho en el mismo lote que el primer cambio
    ops.unshift(batch => batch.update(db.collection("cambios_masivos").doc(actual.id),
      { deshecho: true, deshechoEn: serverTs(), deshechoPor: auth.currentUser.email }));
    await ejecutarEnLotes(ops);

    ultimoCambio = { ...actual, deshecho: true };
    invalidarCacheEstudiantes();
    showMessage(`Cambio deshecho (${hechos})${omitidos ? `. ${plural(omitidos, "elemento no se tocó", "elementos no se tocaron")} porque cambió después` : ""}.`, "success");
    actualizarBarraSel();
    await buscarEstudiantes();
  } catch (e) {
    showMessage("Error al deshacer: " + traducirErrorFirebase(e), "error");
  }
}

function claveGrado(g) {
  return quitarAcentos(normalizarTexto(g)).toLowerCase();
}

function ordenNatural(a, b) {
  return a.localeCompare(b, "es", { numeric: true, sensitivity: "base" });
}

function plural(n, uno, varios) {
  return n === 1 ? `${n} ${uno}` : `${n} ${varios}`;
}

// ---------------------------------------------------------------
// Filtro por grado (chips)
// ---------------------------------------------------------------

// Pinta los chips con los estudiantes que ve la persona (antes de aplicar la búsqueda de texto)
function pintarChipsGrado(candidatos) {
  const cont = $("chipsGrado");
  if (!cont) return;
  const grupos = {};
  let sinGrado = 0;
  candidatos.forEach(e => {
    const k = claveGrado(e.grado);
    if (!k) { sinGrado++; return; }
    if (!grupos[k]) grupos[k] = { clave: k, texto: normalizarTexto(e.grado), n: 0 };
    grupos[k].n++;
  });
  const lista = Object.values(grupos).sort((a, b) => ordenNatural(a.texto, b.texto));

  // Si el grado elegido ya no existe (por ejemplo, tras un cambio), se vuelve a «Todos»
  if (filtroGrado === "__sin__" ? sinGrado === 0 : (filtroGrado !== "todos" && !grupos[filtroGrado])) filtroGrado = "todos";

  const chip = (clave, texto, n, extra = "") =>
    `<button type="button" class="chip-filtro${filtroGrado === clave ? " activo" : ""}${extra}" data-grado="${esc(clave)}" aria-pressed="${filtroGrado === clave}">${esc(texto)} <span>${n}</span></button>`;

  let html = chip("todos", "Todos", candidatos.length);
  if (sinGrado > 0) html += chip("__sin__", "Sin grado", sinGrado, " chip-aviso");
  lista.forEach(g => { html += chip(g.clave, g.texto, g.n); });
  cont.innerHTML = html;
  cont.style.display = candidatos.length ? "" : "none";
}

function coincideGrado(est) {
  if (filtroGrado === "todos") return true;
  const k = claveGrado(est.grado);
  return filtroGrado === "__sin__" ? !k : k === filtroGrado;
}

function elegirFiltroGrado(clave) {
  filtroGrado = clave;
  buscarEstudiantes();
}

// ---------------------------------------------------------------
// Selección múltiple en la lista
// ---------------------------------------------------------------

function esAdminMasivo() {
  return currentUserRole === "admin";
}

function alternarModoSeleccion() {
  if (!esAdminMasivo()) return;
  modoSel = !modoSel;
  if (!modoSel) seleccion.clear();
  if (typeof actualizarBarraSuperior === "function") actualizarBarraSuperior(pantallaActual);
  actualizarBarraSel();
  buscarEstudiantes();
}

// Sale de la selección; con render = true vuelve a pintar la lista
function salirSeleccion(render = true) {
  const estaba = modoSel || seleccion.size > 0;
  modoSel = false;
  seleccion.clear();
  if (typeof actualizarBarraSuperior === "function" && pantallaActual) actualizarBarraSuperior(pantallaActual);
  actualizarBarraSel();
  if (render && estaba && pantallaActual === "estudiantes") buscarEstudiantes();
}

function alternarSeleccion(cedula) {
  if (seleccion.has(cedula)) seleccion.delete(cedula); else seleccion.add(cedula);
  const ul = $("listaEstudiantes");
  if (ul) {
    Array.from(ul.children).forEach(li => {
      if (li.dataset && li.dataset.ced === cedula) {
        li.classList.toggle("marcada", seleccion.has(cedula));
        li.setAttribute("aria-checked", seleccion.has(cedula) ? "true" : "false");
      }
    });
  }
  actualizarBarraSel();
}

function seleccionarTodosMostrados() {
  const todos = cedulasMostradas.length > 0 && cedulasMostradas.every(c => seleccion.has(c));
  cedulasMostradas.forEach(c => { if (todos) seleccion.delete(c); else seleccion.add(c); });
  const ul = $("listaEstudiantes");
  if (ul) {
    Array.from(ul.children).forEach(li => {
      if (li.dataset && li.dataset.ced) {
        li.classList.toggle("marcada", seleccion.has(li.dataset.ced));
        li.setAttribute("aria-checked", seleccion.has(li.dataset.ced) ? "true" : "false");
      }
    });
  }
  actualizarBarraSel();
}

function actualizarBarraSel() {
  const enLista = typeof pantallaActual !== "undefined" && pantallaActual === "estudiantes";
  const barra = $("barraSel");
  if (barra) {
    barra.style.display = modoSel && enLista ? "" : "none";
    const n = seleccion.size;
    const txt = $("barraSelTexto");
    if (txt) txt.textContent = n === 0 ? "Elige estudiantes" : plural(n, "seleccionado", "seleccionados");
  }
  document.body.classList.toggle("con-barra-sel", modoSel && enLista);
  const fab = $("fabNuevoEst");
  if (fab && modoSel) fab.style.display = "none";

  const herr = $("herramientasEst");
  if (herr) {
    const admin = esAdminMasivo();
    herr.style.display = admin ? "" : "none";
    const bSel = $("btnModoSel"), bTodos = $("btnSelTodos"), bCurso = $("btnPasarCurso");
    if (bSel) bSel.textContent = modoSel ? "Cancelar selección" : "Seleccionar";
    if (bTodos) {
      bTodos.style.display = modoSel ? "" : "none";
      const todos = cedulasMostradas.length > 0 && cedulasMostradas.every(c => seleccion.has(c));
      bTodos.textContent = todos ? "Quitar selección" : "Seleccionar todos";
    }
    if (bCurso) bCurso.style.display = modoSel ? "none" : "";
    const bDes = $("btnDeshacer");
    if (bDes) bDes.style.display = !modoSel && ultimoCambio && !ultimoCambio.deshecho ? "" : "none";
  }
}

// ---------------------------------------------------------------
// Cambiar grado de varios estudiantes
// ---------------------------------------------------------------

function estudiantesSeleccionados() {
  return cacheEst.estudiantes
    .filter(e => seleccion.has(e.cedula))
    .sort((a, b) => (a.apellidos || "").localeCompare(b.apellidos || "") || (a.nombres || "").localeCompare(b.nombres || ""));
}

function abrirGradoMasivo() {
  if (!esAdminMasivo()) return showMessage("Solo admin puede cambiar el grado.", "error");
  if (seleccion.size === 0) return showMessage("Elige al menos un estudiante.", "error");
  clearFields(["gradoMasivoNuevo"]);
  $("gradoMasivoNuevo").value = "";
  $("gradoMasivoModal").style.display = "block";
  actualizarPrevistaGrado();
  $("gradoMasivoNuevo").focus();
}

function cerrarGradoMasivo() {
  $("gradoMasivoModal").style.display = "none";
}

// Qué cambiaría con el grado escrito (sin tocar nada)
function calcularGradoMasivo(nuevo) {
  const sel = estudiantesSeleccionados();
  const kNuevo = claveGrado(nuevo);
  const cambian = sel.filter(e => claveGrado(e.grado) !== kNuevo);
  return { total: sel.length, cambian, iguales: sel.length - cambian.length };
}

function actualizarPrevistaGrado() {
  const nuevo = normalizarTexto($("gradoMasivoNuevo").value);
  const cont = $("gradoMasivoPrevia");
  const resumen = $("gradoMasivoResumen");
  resumen.textContent = `Se aplica a ${plural(seleccion.size, "estudiante", "estudiantes")}.`;
  clearFieldError("gradoMasivoNuevo");
  if (!nuevo) {
    cont.innerHTML = `<p class="subtitle">Escribe el grado nuevo para ver los cambios.</p>`;
    return;
  }
  const r = calcularGradoMasivo(nuevo);
  const filas = r.cambian.slice(0, 6).map(e =>
    `<li>${esc(e.nombres + " " + e.apellidos)}: ${e.grado ? esc(e.grado) : "<em>sin grado</em>"} → ${esc(nuevo)}</li>`).join("");
  const mas = r.cambian.length > 6 ? `<li>y ${r.cambian.length - 6} más</li>` : "";
  const omit = r.iguales > 0 ? `<p class="subtitle">${plural(r.iguales, "ya tiene", "ya tienen")} ese grado y no cambia${r.iguales === 1 ? "" : "n"}.</p>` : "";
  cont.innerHTML = r.cambian.length
    ? `<ul class="previa-lista">${filas}${mas}</ul>${omit}`
    : `<p class="subtitle">Nadie cambia: ya tienen ese grado.</p>`;
  $("btnGradoMasivo").textContent = r.cambian.length ? `Cambiar ${plural(r.cambian.length, "estudiante", "estudiantes")}` : "Aplicar";
}

async function aplicarGradoMasivo() {
  if (!esAdminMasivo()) return showMessage("Solo admin puede cambiar el grado.", "error");
  const nuevo = normalizarTexto($("gradoMasivoNuevo").value);
  if (!validarGrado(nuevo)) return showFieldError("gradoMasivoNuevo", "Grado no válido (ejemplo: 4º A).");
  const r = calcularGradoMasivo(nuevo);
  if (r.cambian.length === 0) return showMessage("No hay cambios que aplicar.", "info");

  try {
    const reg = crearRegistroCambio("grado", `Grado ${nuevo}: ${plural(r.cambian.length, "estudiante", "estudiantes")}`,
      r.cambian.map(e => ({ c: e.cedula, a: e.grado || "", d: nuevo })), []);
    await ejecutarEnLotes([reg.op, ...r.cambian.map(e => batch =>
      batch.update(db.collection("estudiantes").doc(e.cedula), { grado: nuevo }))]);
    recordarCambio(reg);
    cerrarGradoMasivo();
    invalidarCacheEstudiantes();
    showMessage(`Grado actualizado en ${plural(r.cambian.length, "estudiante", "estudiantes")}.`, "success");
    salirSeleccion(false);
    await buscarEstudiantes();
    actualizarBarraSel();
  } catch (e) {
    showMessage("Error al cambiar el grado: " + traducirErrorFirebase(e), "error");
  }
}

// ---------------------------------------------------------------
// Pantalla «Materias en masa»: añadir, mover o quitar
// ---------------------------------------------------------------

let mmModo = "anadir";              // anadir | mover | quitar
const mmElegidas = new Set();       // materias marcadas (añadir / quitar)
let mmOrigen = "", mmDestino = "";  // materias de «mover»

function abrirMateriasMasivo() {
  if (!esAdminMasivo()) return showMessage("Solo admin puede cambiar materias.", "error");
  if (seleccion.size === 0) return showMessage("Elige al menos un estudiante.", "error");
  mostrar("materiasMasivo");
}

async function pintarMateriasMasivo() {
  if (seleccion.size === 0) {
    showMessage("Elige primero a los estudiantes en la lista.", "info");
    return mostrar("estudiantes", { reemplazar: true });
  }
  mmModo = "anadir"; mmElegidas.clear(); mmOrigen = ""; mmDestino = "";
  try { await cargarCacheEstudiantes(); } catch (e) { showMessage("Error al cargar: " + traducirErrorFirebase(e), "error"); }
  $("mmResumen").textContent = `${plural(seleccion.size, "estudiante seleccionado", "estudiantes seleccionados")}. El grado no cambia.`;
  mmPintarModo();
}

function mmCambiarModo(modo) {
  mmModo = modo;
  mmElegidas.clear(); mmOrigen = ""; mmDestino = "";
  mmPintarModo();
}

function mmPintarModo() {
  document.querySelectorAll("#mmSegmentos button").forEach(b => {
    const activo = b.dataset.modo === mmModo;
    b.classList.toggle("activo", activo);
    b.setAttribute("aria-pressed", activo ? "true" : "false");
  });
  const cuerpo = $("mmCuerpo");
  if (!materiasLista.length) {
    cuerpo.innerHTML = `<p class="subtitle">Todavía no hay materias. Crea la primera en Materias.</p>`;
  } else if (mmModo === "mover") {
    const opts = sel => `<option value="">Elige una materia</option>` +
      materiasLista.map(m => `<option value="${esc(m.id)}"${m.id === sel ? " selected" : ""}>${esc(m.nombre)}</option>`).join("");
    cuerpo.innerHTML = `
      <label for="mmOrigen">De</label>
      <select id="mmOrigen" onchange="mmElegirMover()">${opts(mmOrigen)}</select>
      <label for="mmDestino">A</label>
      <select id="mmDestino" onchange="mmElegirMover()">${opts(mmDestino)}</select>`;
  } else {
    cuerpo.innerHTML = `<p class="etiqueta">${mmModo === "anadir" ? "Añadir a" : "Quitar de"}</p>` +
      `<div class="mm-lista">` + materiasLista.map(m => `
        <button type="button" class="mm-fila${mmElegidas.has(m.id) ? " marcada" : ""}" role="checkbox" aria-checked="${mmElegidas.has(m.id)}" data-id="${esc(m.id)}">
          <span class="casilla" aria-hidden="true"></span><span>${esc(m.nombre)}</span>
        </button>`).join("") + `</div>`;
  }
  mmActualizarPrevista();
}

function mmAlternar(id) {
  if (mmElegidas.has(id)) mmElegidas.delete(id); else mmElegidas.add(id);
  document.querySelectorAll("#mmCuerpo .mm-fila").forEach(b => {
    const on = mmElegidas.has(b.dataset.id);
    b.classList.toggle("marcada", on);
    b.setAttribute("aria-checked", on ? "true" : "false");
  });
  mmActualizarPrevista();
}

function mmElegirMover() {
  mmOrigen = $("mmOrigen").value;
  mmDestino = $("mmDestino").value;
  mmActualizarPrevista();
}

// Calcula, sin escribir nada, qué operaciones hacen falta y el texto de la vista previa
function calcularMateriasMasivo() {
  const cedulas = [...seleccion];
  const relPorPar = {};
  cacheEst.relaciones.forEach(r => { relPorPar[r.cedula + "|" + r.materiaId] = r; });
  const nombre = id => materiasMap[id] || "Materia";
  const ops = [];     // { tipo: "crear" | "borrar", cedula, materiaId, relId }
  const lineas = [];

  const crear = (cedula, materiaId) => ops.push({ tipo: "crear", cedula, materiaId });
  const borrar = (cedula, materiaId) => ops.push({ tipo: "borrar", cedula, materiaId, relId: relPorPar[cedula + "|" + materiaId].id });

  if (mmModo === "anadir") {
    mmElegidas.forEach(mid => {
      let nuevos = 0, ya = 0;
      cedulas.forEach(c => { if (relPorPar[c + "|" + mid]) ya++; else { nuevos++; crear(c, mid); } });
      lineas.push(`${nombre(mid)}: ${plural(nuevos, "se añade", "se añaden")}${ya ? `, ${plural(ya, "ya estaba", "ya estaban")}` : ""}`);
    });
  } else if (mmModo === "quitar") {
    mmElegidas.forEach(mid => {
      let quitan = 0, no = 0;
      cedulas.forEach(c => { if (relPorPar[c + "|" + mid]) { quitan++; borrar(c, mid); } else no++; });
      lineas.push(`${nombre(mid)}: ${plural(quitan, "se quita", "se quitan")}${no ? `, ${plural(no, "no estaba inscrito", "no estaban inscritos")}` : ""}`);
    });
  } else if (mmModo === "mover" && mmOrigen && mmDestino && mmOrigen !== mmDestino) {
    let pasan = 0, yaDestino = 0, noOrigen = 0;
    cedulas.forEach(c => {
      if (!relPorPar[c + "|" + mmOrigen]) { noOrigen++; return; }
      borrar(c, mmOrigen);
      if (relPorPar[c + "|" + mmDestino]) yaDestino++; else crear(c, mmDestino);
      pasan++;
    });
    lineas.push(`${plural(pasan, "pasa", "pasan")} de ${nombre(mmOrigen)} a ${nombre(mmDestino)}`);
    if (yaDestino) lineas.push(`${plural(yaDestino, "ya estaba", "ya estaban")} en ${nombre(mmDestino)}: solo se quita${yaDestino === 1 ? "" : "n"} de ${nombre(mmOrigen)}`);
    if (noOrigen) lineas.push(`${plural(noOrigen, "no estaba", "no estaban")} en ${nombre(mmOrigen)} y se omite${noOrigen === 1 ? "" : "n"}`);
  }
  const personas = new Set(ops.map(o => o.cedula)).size;
  return { ops, lineas, personas };
}

function mmActualizarPrevista() {
  const prev = $("mmPrevia");
  const btn = $("mmAplicar");
  let ayuda = "";
  if (mmModo === "mover" && mmOrigen && mmOrigen === mmDestino) ayuda = "Elige dos materias distintas.";
  else if (mmModo === "mover" && !(mmOrigen && mmDestino)) ayuda = "Elige la materia de origen y la de destino.";
  else if (mmModo !== "mover" && mmElegidas.size === 0) ayuda = "Elige al menos una materia.";

  const r = ayuda ? { ops: [], lineas: [], personas: 0 } : calcularMateriasMasivo();
  const creadas = r.ops.filter(o => o.tipo === "crear").length;
  const borradas = r.ops.length - creadas;

  if (ayuda) prev.innerHTML = `<p class="subtitle">${ayuda}</p>`;
  else prev.innerHTML = `<ul class="previa-lista">${r.lineas.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` +
    (mmModo === "quitar" ? `<p class="aviso-previa">Las asistencias ya guardadas no se borran.</p>` : "");

  btn.classList.toggle("danger", mmModo === "quitar");
  if (mmModo === "anadir") btn.textContent = creadas ? `Añadir ${plural(creadas, "inscripción", "inscripciones")}` : "Añadir";
  else if (mmModo === "quitar") btn.textContent = borradas ? `Quitar ${plural(borradas, "inscripción", "inscripciones")}` : "Quitar";
  else btn.textContent = r.personas ? `Mover ${plural(r.personas, "estudiante", "estudiantes")}` : "Mover";
}

async function aplicarMateriasMasivo() {
  if (!esAdminMasivo()) return showMessage("Solo admin puede cambiar materias.", "error");
  if (seleccion.size === 0) return showMessage("Elige al menos un estudiante.", "error");
  if (mmModo === "mover" && (!mmOrigen || !mmDestino || mmOrigen === mmDestino)) return showMessage("Elige dos materias distintas.", "error");
  if (mmModo !== "mover" && mmElegidas.size === 0) return showMessage("Elige al menos una materia.", "error");

  try {
    // Se vuelve a leer para no actuar sobre datos viejos
    await cargarCacheEstudiantes(true);
    const r = calcularMateriasMasivo();
    if (r.ops.length === 0) return showMessage("No hay cambios que aplicar.", "info");
    const email = auth.currentUser.email;
    const nombresMat = mmModo === "mover" ? `${materiasMap[mmOrigen]} → ${materiasMap[mmDestino]}` : [...mmElegidas].map(id => materiasMap[id]).join(", ");
    const verbo = mmModo === "anadir" ? "Añadir a" : mmModo === "quitar" ? "Quitar de" : "Mover";
    const reg = crearRegistroCambio("materias", `${verbo} ${nombresMat}: ${plural(r.personas, "estudiante", "estudiantes")}`, [],
      r.ops.map(o => ({ t: o.tipo === "crear" ? "c" : "b", c: o.cedula, m: o.materiaId })));
    await ejecutarEnLotes([reg.op, ...r.ops.map(o => batch => {
      if (o.tipo === "crear") {
        batch.set(db.collection("materia_estudiante").doc(`${o.cedula}_${o.materiaId}`), {
          cedula: o.cedula, materiaId: o.materiaId, creadoEn: serverTs(), creadoPor: email
        });
      } else {
        batch.delete(db.collection("materia_estudiante").doc(o.relId));
      }
    })]);
    recordarCambio(reg);
    invalidarCacheEstudiantes();
    const msg = mmModo === "anadir" ? "Inscripciones añadidas." : mmModo === "quitar" ? "Inscripciones quitadas." : "Estudiantes movidos.";
    showMessage(msg, "success");
    salirSeleccion(false);
    await volver();
    buscarEstudiantes();
  } catch (e) {
    showMessage("Error al guardar: " + traducirErrorFirebase(e), "error");
  }
}

// ---------------------------------------------------------------
// Asistente «Pasar de curso»: solo cambia grados
// ---------------------------------------------------------------

let pcGrupos = [];   // { clave, texto, cedulas: [] }

function abrirPasoCurso() {
  if (!esAdminMasivo()) return showMessage("Solo admin puede pasar de curso.", "error");
  mostrar("pasoCurso");
}

async function pintarPasoCurso() {
  try { await cargarCacheEstudiantes(true); } catch (e) { return showMessage("Error al cargar: " + traducirErrorFirebase(e), "error"); }
  const grupos = {};
  cacheEst.estudiantes.forEach(e => {
    const k = claveGrado(e.grado);
    if (!grupos[k]) grupos[k] = { clave: k, texto: k ? normalizarTexto(e.grado) : "Sin grado", cedulas: [] };
    grupos[k].cedulas.push(e.cedula);
  });
  // «Sin grado» primero (es lo que más falta resolver), luego el resto en orden natural
  pcGrupos = Object.values(grupos).sort((a, b) => a.clave === "" ? -1 : b.clave === "" ? 1 : ordenNatural(a.texto, b.texto));

  const cont = $("pcGrupos");
  if (!pcGrupos.length) {
    cont.innerHTML = `<div class="vacio"><p>Todavía no hay estudiantes.</p></div>`;
  } else {
    cont.innerHTML = pcGrupos.map((g, i) => `
      <div class="pc-fila">
        <div class="pc-origen"><strong>${esc(g.texto)}</strong><small>${esc(plural(g.cedulas.length, "estudiante", "estudiantes"))}</small></div>
        <svg class="fila-flecha" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>
        <div class="pc-destino">
          <input id="pcGrado${i}" data-i="${i}" list="pcGrados" maxlength="30" autocomplete="off"
            placeholder="${g.clave === "" ? "Elige un grado" : "Sin cambio"}" aria-label="Grado nuevo para ${esc(g.texto)}" />
          <small id="error-pcGrado${i}" class="field-error"></small>
        </div>
      </div>`).join("");
  }
  $("pcGrados").innerHTML = pcGrupos.filter(g => g.clave).map(g => `<option value="${esc(g.texto)}"></option>`).join("");
  pcActualizar();
}

// Lee los destinos escritos: [{ grupo, nuevo }] (solo los que cambian y son válidos)
function pcLeerCambios(marcarErrores) {
  const cambios = [];
  let ok = true;
  pcGrupos.forEach((g, i) => {
    const inp = $("pcGrado" + i);
    if (!inp) return;
    clearFieldError("pcGrado" + i);
    const nuevo = normalizarTexto(inp.value);
    if (!nuevo) return;
    if (!validarGrado(nuevo)) {
      ok = false;
      if (marcarErrores) showFieldError("pcGrado" + i, "Grado no válido (ejemplo: 4º A).");
      return;
    }
    if (claveGrado(nuevo) === g.clave) return;
    cambios.push({ grupo: g, nuevo });
  });
  return { cambios, ok };
}

function pcActualizar() {
  const { cambios } = pcLeerCambios(false);
  const n = cambios.reduce((s, c) => s + c.grupo.cedulas.length, 0);
  $("pcResumen").textContent = n === 0
    ? "Escribe el grado nuevo de los grupos que cambian. Los que dejes vacíos no cambian."
    : `${plural(n, "estudiante cambia", "estudiantes cambian")} de grado.`;
  $("pcAplicar").textContent = n === 0 ? "Aplicar cambios" : `Aplicar ${plural(n, "cambio", "cambios")}`;
}

async function aplicarPasoCurso() {
  if (!esAdminMasivo()) return showMessage("Solo admin puede pasar de curso.", "error");
  const { cambios, ok } = pcLeerCambios(true);
  if (!ok) return showMessage("Revisa los grados marcados.", "error");
  const n = cambios.reduce((s, c) => s + c.grupo.cedulas.length, 0);
  if (n === 0) return showMessage("No hay cambios que aplicar.", "info");

  const resumen = cambios.map(c => `${c.grupo.texto} → ${c.nuevo} (${c.grupo.cedulas.length})`).join("\n");
  if (!confirm(`Van a cambiar de grado ${plural(n, "estudiante", "estudiantes")}:\n\n${resumen}\n\nLas materias no se tocan. ¿Continuar?`)) return;

  try {
    const ops = [];
    const grados = [];
    cambios.forEach(c => c.grupo.cedulas.forEach(ced => {
      const est = buscarEstudianteEnCache(ced);
      grados.push({ c: ced, a: (est && est.grado) || "", d: c.nuevo });
      ops.push(batch => batch.update(db.collection("estudiantes").doc(ced), { grado: c.nuevo }));
    }));
    const reg = crearRegistroCambio("curso", `Pasar de curso: ${plural(n, "estudiante", "estudiantes")}`, grados, []);
    await ejecutarEnLotes([reg.op, ...ops]);
    recordarCambio(reg);
    invalidarCacheEstudiantes();
    showMessage(`Grado actualizado en ${plural(n, "estudiante", "estudiantes")}.`, "success");
    await volver();
    buscarEstudiantes();
  } catch (e) {
    showMessage("Error al guardar: " + traducirErrorFirebase(e), "error");
  }
}

// ---------------------------------------------------------------
// Eventos (los elementos existen al cargar: los scripts son defer)
// ---------------------------------------------------------------

document.addEventListener("click", ev => {
  const chip = ev.target.closest && ev.target.closest("#chipsGrado .chip-filtro");
  if (chip) return elegirFiltroGrado(chip.dataset.grado);
  const mm = ev.target.closest && ev.target.closest("#mmCuerpo .mm-fila");
  if (mm) return mmAlternar(mm.dataset.id);
});
