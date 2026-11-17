// ============================================================
// Asistencia App - app.js (Fase 1)
// ============================================================

const firebaseConfig = {
  apiKey: "AIzaSyD7dXhlgDUd_FMiOD-2tG9Sk2CTzNIcHWU",
  authDomain: "asistencialuis-9b378.firebaseapp.com",
  projectId: "asistencialuis-9b378",
  storageBucket: "asistencialuis-9b378.firebasestorage.app",
  messagingSenderId: "145173933947",
  appId: "1:145173933947:web:00930a77d5e24964aa57de"
};

firebase.initializeApp(firebaseConfig);

const db = firebase.firestore();
const auth = firebase.auth();

// ===============================
// CONSTANTES Y ESTADO
// ===============================

const ROLES_STAFF = ["admin", "profesor"];
const ROLES_VALIDOS = ["pendiente", "profesor", "admin"];
// Texto que ve el usuario (el valor guardado en la base de datos sigue siendo "profesor")
const ROL_TEXTO = { pendiente: "Pendiente (sin acceso)", profesor: "Docente", admin: "Administrador" };
function textoRol(rol) { return ROL_TEXTO[rol] || String(rol || "sin rol"); }
const CACHE_TTL_MS = 5 * 60 * 1000;      // caché de estudiantes (5 min)
const HIST_PAGE = 50;                    // registros por página en el historial
const MIN_REGISTROS_ALERTA = 3;          // mínimo de clases para considerar una alerta
const BORRADOR_MAX_MS = 48 * 60 * 60 * 1000;

// Estados de asistencia
const ESTADOS = {
  presente:    { texto: "Presente",    icono: "✅" },
  tardanza:    { texto: "Tardanza",    icono: "⏰" },
  justificado: { texto: "Justificado", icono: "📝" },
  falta:       { texto: "Falta",       icono: "❌" }
};
const ESTADOS_ASISTE = ["presente", "tardanza"];   // cuentan como asistencia (presente = true)
const MOTIVO_MIN = 3;
const MOTIVO_MAX = 200;

// Política del porcentaje de asistencia:
//   false -> las faltas justificadas NO cuentan en contra (se excluyen del total)
//   true  -> cuentan como una falta más
const JUSTIFICADO_CUENTA_EN_CONTRA = false;

let currentUserRole = null;

// Materias en memoria: una sola consulta alimenta selects, listados y reportes
let materiasMap = {};      // id -> nombre
let materiasLista = [];    // [{ id, nombre, profesores }] ordenadas por nombre

// Lista de asistencia en curso
let listaActiva = false;
let listaCtx = null;                 // { materiaId, materiaNombre, fecha }
let estudiantesMateria = [];
let marcas = new Map();              // cedula -> { estado, hora, ts, motivo, guardado }
let existentesMap = new Map();       // cedula -> { id, data } (ya guardados en Firestore)
let html5QrCode = null;
let ultimoEscaneo = { codigo: "", ts: 0 };

let chartInstance = null;
let toastTimer = null;

// Edición de estudiante
let tempMateriasEstudiante = [];
let relacionesOriginales = [];
let resolvePassword = null;

// Caché de estudiantes y relaciones (para no releer todo en cada búsqueda)
let cacheEst = { ts: 0, estudiantes: [], relaciones: [] };

// Historial paginado
let histCursor = null;
let histFiltro = null;

// Último reporte generado (para exportar)
let resultadosBusquedaActual = [];

// Administración (solo admin)
let usuariosMap = {};        // uid -> { uid, email, nombre, role }
let appSecundaria = null;    // segunda app de Firebase: crea cuentas sin cerrar la sesión del admin
let docentesCtx = null;      // { materiaId } del modal de docentes
let docentesChecks = [];     // casillas del modal de docentes

// Corrección de estado (modal)
let correccionCtx = null;    // { tipo: "temporal" | "historial", cedula, docId, nombre }

// ===============================
// UTILIDADES
// ===============================

function $(id) {
  return document.getElementById(id);
}

// Escapa texto antes de insertarlo con innerHTML
function esc(valor) {
  return String(valor === null || valor === undefined ? "" : valor).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function serverTs() {
  return firebase.firestore.FieldValue.serverTimestamp();
}

function showMessage(message, type = "info") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = "block";

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.style.display = "none";
  }, 3500);
}

function setLoginError(message) {
  $("loginError").textContent = message || "";
}

function limpiarInput(id) {
  const el = $(id);
  if (el) el.value = "";
}

function limpiarLista(id) {
  const el = $(id);
  if (el) el.innerHTML = "";
}

function normalizarTexto(texto) {
  return (texto || "").trim().replace(/\s+/g, " ");
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// Fecha local en formato AAAA-MM-DD (toISOString usa UTC y falla cerca de medianoche)
function fechaLocalISO(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fechaHaceDias(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return fechaLocalISO(d);
}

function horaTexto(d = new Date()) {
  return d.toLocaleTimeString("es-ES", { hour12: false });
}

function formatarFechaUI(fechaString) {
  if (!fechaString) return "Sin fecha";
  const partes = fechaString.split("-");
  if (partes.length !== 3) return fechaString;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
}

function nombreMateria(registro) {
  return materiasMap[registro.materia] || registro.materiaNombre || registro.materia || "";
}

// Estado de un registro. Los registros antiguos solo tienen "presente": true/false.
function estadoDe(registro) {
  if (registro && ESTADOS[registro.estado]) return registro.estado;
  return registro && registro.presente ? "presente" : "falta";
}

// Cuenta estados y calcula el porcentaje de asistencia según la política elegida
function resumenEstados(registros) {
  const r = { presente: 0, tardanza: 0, justificado: 0, falta: 0, total: registros.length };
  registros.forEach(x => { r[estadoDe(x)]++; });
  r.base = JUSTIFICADO_CUENTA_EN_CONTRA ? r.total : r.total - r.justificado;
  r.asistidas = r.presente + r.tardanza;
  r.porcentaje = r.base > 0 ? (r.asistidas / r.base) * 100 : null;
  return r;
}

// ===============================
// NAVEGACIÓN
// ===============================

function resetUILista() {
  listaActiva = false;
  listaCtx = null;
  marcas = new Map();
  existentesMap = new Map();
  estudiantesMateria = [];

  limpiarLista("presentes");
  limpiarLista("justificados");
  limpiarLista("faltantes");
  $("contPresentes").textContent = "";
  $("contJustificados").textContent = "";
  $("contFaltantes").textContent = "";

  $("zonaLista").style.display = "none";
  $("infoListaActiva").style.display = "none";
  $("formInicioLista").style.display = "block";
}

async function mostrar(id) {
  const esStaff = ROLES_STAFF.includes(currentUserRole);
  if (!esStaff && id !== "pendienteScreen") return;

  // Restricción por rol (la protección real está en las reglas de Firestore)
  if (currentUserRole !== "admin" && ["materiasScreen", "adminScreen"].includes(id)) {
    showMessage("No tienes permisos para acceder a esta sección.", "error");
    return;
  }

  // 1. Apagar la cámara al cambiar de sección
  if (html5QrCode) {
    await detenerEscaner();
  }

  // 2. Ocultar todas las pantallas
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.remove("active");
  });

  // 3. Reiniciar campos. Si hay una lista en curso, la pantalla "lista" NO se toca:
  //    cambiar de pestaña ya no hace perder lo escaneado.
  const alcance = listaActiva ? ".screen:not(#lista)" : ".screen";

  document.querySelectorAll(`${alcance} input`).forEach(input => {
    input.value = "";
    input.classList.remove("valid", "invalid");
  });

  document.querySelectorAll(`${alcance} select`).forEach(select => {
    select.selectedIndex = 0;
    select.classList.remove("valid", "invalid");
  });

  document.querySelectorAll(`${alcance} .field-error`).forEach(error => {
    error.textContent = "";
    error.classList.remove("show");
  });

  // 4. Sin lista en curso: dejar la pantalla de lista en su estado inicial
  if (!listaActiva) {
    resetUILista();
  }

  // 5. Vaciar resultados de otras pantallas
  limpiarLista("historialLista");
  limpiarLista("alertas");
  limpiarLista("reporte");
  histCursor = null;
  histFiltro = null;
  $("btnHistMas").style.display = "none";

  // 6. Mostrar la pantalla pedida
  const screen = $(id);
  if (screen) {
    screen.classList.add("active");
  }

  // 7. Cargar datos de la sección
  if (id === "estudiantes") {
    buscarEstudiantes();
  } else if (id === "materiasScreen") {
    listarMaterias();
  } else if (id === "dashboard") {
    cargarDashboard(false);
  } else if (id === "adminScreen") {
    cargarUsuarios();
  }

  establecerFechaActualPorDefecto();
}

// ===============================
// ERRORES POR CAMPO
// ===============================

function showFieldError(fieldId, message) {
  const field = $(fieldId);
  const error = $(`error-${fieldId}`);
  if (field) {
    field.classList.add("invalid");
    field.classList.remove("valid");
  }
  if (error) {
    error.textContent = message;
    error.classList.add("show");
  }
}

function clearFieldError(fieldId, markValid = false) {
  const field = $(fieldId);
  const error = $(`error-${fieldId}`);
  if (field) {
    field.classList.remove("invalid");
    if (markValid && field.value.trim() !== "") {
      field.classList.add("valid");
    } else {
      field.classList.remove("valid");
    }
  }
  if (error) {
    error.textContent = "";
    error.classList.remove("show");
  }
}

function clearFields(ids) {
  ids.forEach(id => clearFieldError(id));
}

function markFieldValid(fieldId) {
  const field = $(fieldId);
  if (field && field.value.trim() !== "") {
    field.classList.remove("invalid");
    field.classList.add("valid");
  }
}

// ===============================
// VALIDACIONES
// ===============================

// Pone la fecha de hoy (hora local) en los inputs de fecha vacíos
function establecerFechaActualPorDefecto() {
  const hoy = fechaLocalISO();
  document.querySelectorAll('input[type="date"]').forEach(input => {
    if (!input.value) {
      input.value = hoy;
    }
  });
}

function validarRangoFechas() {
  clearFields(["filtroFechaInicio", "filtroFechaFin"]);

  const fechaInicio = $("filtroFechaInicio").value;
  const fechaFin = $("filtroFechaFin").value;

  // Sin fechas: se permite (historial completo, paginado)
  if (!fechaInicio && !fechaFin) {
    return true;
  }

  let ok = true;

  if (fechaInicio && !fechaFin) {
    showFieldError("filtroFechaFin", "Selecciona una fecha de fin.");
    ok = false;
  }

  if (!fechaInicio && fechaFin) {
    showFieldError("filtroFechaInicio", "Selecciona una fecha de inicio.");
    ok = false;
  }

  if (fechaInicio && fechaFin) {
    if (fechaInicio > fechaFin) {
      showFieldError("filtroFechaInicio", "La fecha de inicio no puede ser mayor.");
      showFieldError("filtroFechaFin", "La fecha de fin no puede ser menor.");
      ok = false;
    } else {
      markFieldValid("filtroFechaInicio");
      markFieldValid("filtroFechaFin");
    }
  }

  return ok;
}

function validarEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function validarPassword(value) { return !!value && value.length >= 6; }
function validarCedula(value) { return /^[0-9]+$/.test(value.trim()) && value.trim().length >= 4; }
function validarNombre(value) {
  const v = normalizarTexto(value);
  return /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/.test(v) && v.length >= 2;
}
function validarMateria(value) {
  const v = normalizarTexto(value);
  return /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü0-9\s\-]+$/.test(v) && v.length >= 2;
}

function validarLoginCampos() {
  let ok = true;
  clearFields(["email", "password"]);
  setLoginError("");
  if (!validarEmail($("email").value)) { showFieldError("email", "Ingresa un correo electrónico válido."); ok = false; } else markFieldValid("email");
  if (!validarPassword($("password").value)) { showFieldError("password", "Mínimo 6 caracteres."); ok = false; } else markFieldValid("password");
  return ok;
}

function validarEstudianteCampos() {
  let ok = true;
  clearFields(["cedula", "nombres", "apellidos"]);
  if (!validarCedula($("cedula").value)) { showFieldError("cedula", "Solo números y mínimo 4 dígitos."); ok = false; } else markFieldValid("cedula");
  if (!validarNombre($("nombres").value)) { showFieldError("nombres", "Solo letras y espacios."); ok = false; } else markFieldValid("nombres");
  if (!validarNombre($("apellidos").value)) { showFieldError("apellidos", "Solo letras y espacios."); ok = false; } else markFieldValid("apellidos");
  return ok;
}

function validarMateriaCampos() {
  let ok = true;
  clearFields(["materiaNombre"]);
  if (!validarMateria($("materiaNombre").value)) { showFieldError("materiaNombre", "Mínimo 2 caracteres. (letras, números, guion)"); ok = false; } else markFieldValid("materiaNombre");
  return ok;
}

function validarAsignacionCampos() {
  let ok = true;
  clearFields(["cedulaAsignar", "materiaSelect"]);
  if (!validarCedula($("cedulaAsignar").value)) { showFieldError("cedulaAsignar", "Cédula inválida."); ok = false; } else markFieldValid("cedulaAsignar");
  if (!$("materiaSelect").value) { showFieldError("materiaSelect", "Selecciona materia."); ok = false; } else markFieldValid("materiaSelect");
  return ok;
}

function validarInicioListaCampos() {
  let ok = true;
  clearFields(["materiaLista", "fechaLista"]);
  if (!$("materiaLista").value) { showFieldError("materiaLista", "Selecciona una materia."); ok = false; } else markFieldValid("materiaLista");
  if (!$("fechaLista").value) { showFieldError("fechaLista", "Selecciona la fecha."); ok = false; } else markFieldValid("fechaLista");
  return ok;
}

function validarManualCedula() {
  clearFieldError("manualCedula");
  if (!validarCedula($("manualCedula").value)) { showFieldError("manualCedula", "Cédula inválida."); return false; }
  markFieldValid("manualCedula");
  return true;
}

function traducirErrorFirebase(error) {
  const code = error && error.code ? error.code : "";
  const errores = {
    "auth/invalid-email": "El correo electrónico no tiene un formato válido.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/wrong-password": "La contraseña es incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/too-many-requests": "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
    "auth/network-request-failed": "No hay conexión con Firebase.",
    "auth/admin-restricted-operation": "El registro de usuarios está desactivado en Firebase Authentication. Actívalo (Authentication > Settings > User actions > Enable create) o crea la cuenta desde la consola de Firebase.",
    "unavailable": "No hay conexión con Firebase.",
    "permission-denied": "No tienes permisos para realizar esta acción.",
    "failed-precondition": "Falta el índice de Firestore (asistencias: materia + fecha). Créalo desde la consola de Firebase; el enlace directo aparece en la consola del navegador (F12)."
  };
  return errores[code] || (error && error.message) || "Ocurrió un error inesperado.";
}

// ===============================
// CONFIRMACIÓN CON CONTRASEÑA
// ===============================

function pedirPassword() {
  $("modalPasswordInput").value = "";
  clearFieldError("modalPasswordInput");
  $("passwordModal").style.display = "block";
  return new Promise(resolve => {
    resolvePassword = resolve;
  });
}

function confirmarPassword() {
  const pass = $("modalPasswordInput").value;
  if (!pass) {
    showFieldError("modalPasswordInput", "Ingresa tu contraseña.");
    return;
  }
  $("passwordModal").style.display = "none";
  if (resolvePassword) resolvePassword(pass);
}

function cerrarPasswordModal() {
  $("passwordModal").style.display = "none";
  if (resolvePassword) resolvePassword(null);
}

// Reautentica sin cerrar ni reabrir la sesión
async function reautenticar(password) {
  const user = auth.currentUser;
  const credencial = firebase.auth.EmailAuthProvider.credential(user.email, password);
  await user.reauthenticateWithCredential(credencial);
}

// Borra referencias en lotes (Firestore admite como máximo 500 operaciones por lote)
async function borrarEnLotes(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    refs.slice(i, i + 400).forEach(ref => batch.delete(ref));
    await batch.commit();
  }
}

// ===============================
// AUTH
// ===============================

async function login() {
  if (!validarLoginCampos()) return;
  try {
    await auth.signInWithEmailAndPassword($("email").value.trim(), $("password").value);
    showMessage("Inicio de sesión correcto.", "success");
  } catch (error) {
    const msg = traducirErrorFirebase(error);
    setLoginError(msg);
    showMessage(msg, "error");
  }
}

async function logout() {
  try {
    await detenerEscaner();
    await auth.signOut();
    location.reload();
  } catch (error) {
    showMessage("Error al salir: " + traducirErrorFirebase(error), "error");
  }
}

auth.onAuthStateChanged(async user => {
  if (user && $("app").style.display === "none") {
    await initApp();
  }
});

async function initApp() {
  const user = auth.currentUser;
  if (!user) return;
  try {
    const ref = db.collection("users").doc(user.uid);
    let snap = await ref.get();

    // Cuenta nueva: queda "pendiente" hasta que un admin la apruebe
    if (!snap.exists) {
      await ref.set({ email: user.email, role: "pendiente", creadoEn: serverTs() });
      snap = await ref.get();
    }

    currentUserRole = snap.data().role || "pendiente";

    $("loginScreen").style.display = "none";
    $("app").style.display = "block";
    $("rolInfo").textContent = `${user.email} · Rol: ${textoRol(currentUserRole)}`;

    const navbar = document.querySelector(".navbar");

    if (!ROLES_STAFF.includes(currentUserRole)) {
      navbar.style.display = "none";
      await mostrar("pendienteScreen");
      return;
    }

    navbar.style.display = "";
    const esAdmin = currentUserRole === "admin";
    $("adminNavBtn").style.display = esAdmin ? "block" : "none";
    $("estudiantesNavBtn").style.display = "block";
    $("estudiantesNavTexto").textContent = esAdmin ? "Estudiantes" : "Mis estudiantes";
    $("estudiantesTitulo").textContent = esAdmin ? "👨‍🎓 Estudiantes" : "👨‍🎓 Mis estudiantes";
    $("formNuevoEstudiante").style.display = esAdmin ? "block" : "none";
    $("materiasNavBtn").style.display = esAdmin ? "block" : "none";

    establecerFechaActualPorDefecto();
    await mostrar("lista");
    await cargarMaterias();
    if (!esAdmin && materiasLista.length === 0) {
      showMessage("Todavía no tienes materias asignadas. Pide a un administrador que te asigne.", "info");
    }
    await ofrecerRestaurarBorrador();
  } catch (error) {
    showMessage("Error inicializando: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// MATERIAS
// ===============================

// Única consulta de materias: llena la memoria y repinta todo lo que las usa.
// El admin recibe todas; un docente solo las que tiene asignadas.
async function cargarMaterias() {
  try {
    const esAdmin = currentUserRole === "admin";
    const snap = esAdmin
      ? await db.collection("materias").orderBy("nombre").get()
      : await db.collection("materias").where("profesores", "array-contains", auth.currentUser.uid).get();

    materiasMap = {};
    materiasLista = [];
    snap.forEach(doc => {
      const d = doc.data();
      materiasMap[doc.id] = d.nombre;
      materiasLista.push({ id: doc.id, nombre: d.nombre, profesores: d.profesores || [] });
    });
    materiasLista.sort((a, b) => a.nombre.localeCompare(b.nombre));

    if (esAdmin) await cargarUsuariosCache();

    renderSelectsMaterias();
    listarMaterias();
    cargarMateriasEnReportes();
  } catch (e) {
    showMessage("Error cargando materias: " + traducirErrorFirebase(e), "error");
  }
}

function renderSelectsMaterias() {
  ["materiaLista", "materiaSelect", "searchEstudianteMateria", "editEstAddMateria"].forEach(id => {
    const el = $(id);
    if (el) el.innerHTML = "";
  });

  const vacio = materiasLista.length === 0;
  const textoBase = vacio ? "Sin materias" : "Selecciona una materia";

  $("searchEstudianteMateria").add(new Option("Todas las materias", "todas"));
  $("editEstAddMateria").add(new Option("Selecciona materia a añadir", ""));
  $("materiaLista").add(new Option(textoBase, ""));
  $("materiaSelect").add(new Option(textoBase, ""));

  materiasLista.forEach(m => {
    $("materiaLista").add(new Option(m.nombre, m.id));
    $("materiaSelect").add(new Option(m.nombre, m.id));
    $("searchEstudianteMateria").add(new Option(m.nombre, m.id));
    $("editEstAddMateria").add(new Option(m.nombre, m.id));
  });
}

// Selects de historial, reportes y dashboard
function cargarMateriasEnReportes() {
  const esAdmin = currentUserRole === "admin";

  // Historial: el admin puede ver todas; un docente siempre ve una materia concreta
  const hist = $("materiaHistorial");
  if (hist) {
    hist.innerHTML = "";
    if (esAdmin) hist.add(new Option("Todas las materias", ""));
    else if (materiasLista.length === 0) hist.add(new Option("Sin materias", ""));
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
    ul.innerHTML = "<li>No hay materias registradas.</li>";
    return;
  }

  materiasLista.forEach(m => {
    const li = document.createElement("li");
    const docentes = (m.profesores || []).map(uid => {
      const u = usuariosMap[uid];
      return u ? (u.nombre || u.email) : "cuenta desconocida";
    });
    li.innerHTML = `<strong>${esc(m.nombre)}</strong><br><small>Docentes: ${esc(docentes.length ? docentes.join(", ") : "ninguno")}</small><br>`;

    if (currentUserRole === "admin") {
      const btnEdit = document.createElement("button");
      btnEdit.className = "small";
      btnEdit.textContent = "Editar";
      btnEdit.onclick = () => abrirEditarMateria(m.id, m.nombre);

      const btnDel = document.createElement("button");
      btnDel.className = "small danger";
      btnDel.textContent = "Eliminar";
      btnDel.onclick = () => eliminarMateria(m.id);

      const btnDoc = document.createElement("button");
      btnDoc.className = "small secondary";
      btnDoc.textContent = "Docentes";
      btnDoc.onclick = () => abrirDocentesMateria(m.id);

      li.appendChild(btnDoc);
      li.appendChild(btnEdit);
      li.appendChild(btnDel);
    }

    ul.appendChild(li);
  });
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
    await ref.set({ cedula, nombres, apellidos, creadoEn: serverTs() });
    showMessage("Estudiante creado.", "success");
    limpiarInput("cedula"); limpiarInput("nombres"); limpiarInput("apellidos");
    clearFields(["cedula", "nombres", "apellidos"]);
    invalidarCacheEstudiantes();
    buscarEstudiantes();
  } catch (e) {
    showMessage("Error: " + traducirErrorFirebase(e), "error");
  }
}

async function buscarEstudiantes() {
  const texto = normalizarTexto($("searchEstudianteText").value).toLowerCase();
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
      const coincide = !texto || est.cedula.includes(texto) || nombreCompleto.toLowerCase().includes(texto);
      if (!coincide) return;

      mostrados++;
      const mats = materiasPorCedula[est.cedula] ? Array.from(materiasPorCedula[est.cedula]).join(", ") : "Ninguna";

      const li = document.createElement("li");
      li.innerHTML = `
        <strong>${esc(est.cedula)}</strong><br>
        ${esc(nombreCompleto)}<br>
        <small style="color:#2563eb; font-weight:bold;">Materias: ${esc(mats)}</small><br>
      `;

      const btnQr = document.createElement("button");
      btnQr.className = "small secondary";
      btnQr.textContent = "QR";
      btnQr.onclick = () => mostrarQR(est.cedula, nombreCompleto);
      li.appendChild(btnQr);

      if (esAdmin) {

        const btnEd = document.createElement("button");
        btnEd.className = "small";
        btnEd.textContent = "Editar";
        btnEd.onclick = () => abrirEditarEstudiante(est.cedula);

        const btnDe = document.createElement("button");
        btnDe.className = "small danger";
        btnDe.textContent = "Eliminar";
        btnDe.onclick = () => eliminarEstudiante(est.cedula);

        li.appendChild(btnEd);
        li.appendChild(btnDe);
      }

      ul.appendChild(li);
    });

    if (mostrados === 0) {
      ul.innerHTML = "<li>No se encontraron estudiantes.</li>";
    }
  } catch (error) {
    showMessage("Error al buscar estudiantes: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// EDICIÓN / ELIMINACIÓN DE ESTUDIANTE
// ===============================

async function abrirEditarEstudiante(cedula) {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede editar.", "error");
  clearFields(["editEstNombres", "editEstApellidos"]);

  try {
    const doc = await db.collection("estudiantes").doc(cedula).get();
    if (!doc.exists) return showMessage("El estudiante no existe.", "error");

    const data = doc.data();
    $("editEstCedula").value = data.cedula;
    $("editEstNombres").value = data.nombres;
    $("editEstApellidos").value = data.apellidos;

    const snap = await db.collection("materia_estudiante").where("cedula", "==", cedula).get();
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

function actualizarUIEditMateriasEst() {
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
  clearFields(["editEstNombres", "editEstApellidos"]);
  const cedula = $("editEstCedula").value;
  const nombres = normalizarTexto($("editEstNombres").value);
  const apellidos = normalizarTexto($("editEstApellidos").value);

  if (!validarNombre(nombres)) return showFieldError("editEstNombres", "Nombres inválidos.");
  if (!validarNombre(apellidos)) return showFieldError("editEstApellidos", "Apellidos inválidos.");

  try {
    const batch = db.batch();
    batch.update(db.collection("estudiantes").doc(cedula), { nombres, apellidos });

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

async function exportarQRPDF() {
  const exportArea = $("qrExportArea");
  const cedulaStr = $("qrCedulaDisplay").textContent.replace("Cédula: ", "");
  try {
    const canvas = await html2canvas(exportArea, {
      scale: 2,
      backgroundColor: "#ffffff",
      onclone: (doc) => {
        const c = doc.querySelector('#qrCanvas');
        c.getContext('2d', { willReadFrequently: true });
      }
    });

    const imgData = canvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("portrait", "mm", "a6");

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const imgProps = pdf.getImageProperties(imgData);
    const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;

    pdf.addImage(imgData, 'PNG', 0, 10, pdfWidth, pdfHeight);
    pdf.save(`Carnet_${cedulaStr}.pdf`);
    showMessage("Documento PDF descargado.", "success");
  } catch (error) {
    showMessage("Error al exportar PDF.", "error");
  }
}

function mostrarQR(cedulaValue, nombreCompleto) {
  $("qrModal").style.display = "block";

  $("qrNombreDisplay").textContent = nombreCompleto || "Estudiante";
  $("qrCedulaDisplay").textContent = `Cédula: ${cedulaValue}`;

  QRCode.toCanvas($("qrCanvas"), cedulaValue, { width: 250, margin: 2 }, error => {
    if (error) showMessage("No se pudo generar QR.", "error");
  });
}

function cerrarQR() { $("qrModal").style.display = "none"; }

// ===============================
// ASIGNACIÓN RÁPIDA
// ===============================

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
    estado: ESTADOS[e[1]] && e[1] !== "falta" ? e[1] : "presente",
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
  return ESTADOS_ASISTE.includes(v) ? v : "presente";
}

async function iniciarLista(borrador) {
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

    // Restaurar lo escaneado antes de que se cerrara la página
    if (borrador) {
      borrador.entradas.forEach(e => {
        if (porCedula.has(e.cedula) && !marcas.has(e.cedula)) {
          marcas.set(e.cedula, { estado: e.estado, hora: e.hora, ts: e.ts, motivo: e.motivo, guardado: false });
        }
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
  establecerFechaActualPorDefecto();

  showMessage("Lista cancelada.", "info");
}

async function iniciarEscaner() {
  if (!listaActiva) return showMessage("Primero inicia la lista.", "error");
  if (html5QrCode) return showMessage("La cámara ya está activa.", "info");

  prepararAudio();

  try {
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
function registrarAsistencia(ced) {
  clearFieldError("manualCedula");

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

  if (marcas.has(ced)) {
    beepError();
    return showMessage(`${nombre} ya figura como ${ESTADOS[marcas.get(ced).estado].texto.toLowerCase()}.`, "error");
  }

  const estado = modoRegistroActual();
  const ahora = new Date();
  marcas.set(ced, { estado, hora: horaTexto(ahora), ts: ahora.getTime(), motivo: "", guardado: false });

  beep();
  refrescarListas();
  limpiarInput("manualCedula");
  clearFieldError("manualCedula");
  guardarBorrador();
  showMessage(`${ESTADOS[estado].icono} ${nombre}`, "success");
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
    ul.innerHTML = "<li>No hay presentes.</li>";
    return;
  }

  // Los últimos en llegar, arriba
  asistentes.reverse().forEach(([ced, m]) => {
    const li = document.createElement("li");
    li.innerHTML = `${ESTADOS[m.estado].icono} <strong>${esc(ced)}</strong> · ${esc(ESTADOS[m.estado].texto)}<br>${esc(nombreEstudianteLista(ced))}<br><small>Hora: ${esc(m.hora || "")}</small>`;
    ul.appendChild(li);
  });
}

function actualizarJustificados() {
  const ul = $("justificados");
  ul.innerHTML = "";

  const justificados = [];
  marcas.forEach((m, ced) => { if (m.estado === "justificado") justificados.push([ced, m]); });
  $("contJustificados").textContent = `(${justificados.length})`;

  if (justificados.length === 0) {
    ul.innerHTML = "<li>No hay justificados.</li>";
    return;
  }

  justificados.forEach(([ced, m]) => {
    const li = document.createElement("li");
    li.innerHTML = `${ESTADOS.justificado.icono} <strong>${esc(ced)}</strong><br>${esc(nombreEstudianteLista(ced))}<br><small>Motivo: ${esc(m.motivo || "")}</small>`;
    ul.appendChild(li);
  });
}

function actualizarFaltantes() {
  const ul = $("faltantes");
  ul.innerHTML = "";
  const faltantes = estudiantesMateria.filter(e => !marcas.has(e.cedula));
  $("contFaltantes").textContent = `(${faltantes.length})`;

  if (faltantes.length === 0) {
    ul.innerHTML = "<li>No hay faltantes.</li>";
    return;
  }

  faltantes.forEach(est => {
    const nombre = `${est.nombres} ${est.apellidos}`;
    const li = document.createElement("li");
    li.innerHTML = `${ESTADOS.falta.icono} <strong>${esc(est.cedula)}</strong><br>${esc(nombre)}`;
    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = "Cambiar estado";
    btn.onclick = () => abrirCorreccion({ tipo: "temporal", cedula: est.cedula, nombre });
    li.appendChild(btn);
    ul.appendChild(li);
  });
}

// Calcula qué escribir en Firestore al cerrar la lista (función pura, fácil de probar):
//  - estudiante sin registro previo                    -> crear (con su estado, o "falta")
//  - figuraba como falta y ahora tiene otro estado     -> actualizar
//  - cualquier otro caso                               -> no tocar (no se sobrescribe nada)
function calcularOperacionesLista({ estudiantes, marcas, existentes, ctx, profesor, marcaServidor, aTimestamp }) {
  const ops = [];

  estudiantes.forEach(est => {
    const m = marcas.get(est.cedula);
    const estado = m ? m.estado : "falta";
    const asiste = ESTADOS_ASISTE.includes(estado);
    const hora = asiste ? ((m && m.hora) || horaTexto()) : null;
    const horaTs = asiste && m && m.ts ? aTimestamp(m.ts) : null;
    const ex = existentes.get(est.cedula);

    if (!ex) {
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
        actualizadoEn: marcaServidor
      };
      if (estado === "justificado" && m.motivo) data.motivo = m.motivo;
      ops.push({ tipo: "set", id: `${est.cedula}_${ctx.fecha}_${ctx.materiaId}`, data });
    } else if (estadoDe(ex.data) === "falta" && estado !== "falta") {
      const data = { estado, presente: asiste, hora, horaTs, actualizadoEn: marcaServidor };
      if (estado === "justificado" && m.motivo) data.motivo = m.motivo;
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
    const ops = calcularOperacionesLista({
      estudiantes: estudiantesMateria,
      marcas,
      existentes: existentesMap,
      ctx: listaCtx,
      profesor: auth.currentUser.email,
      marcaServidor: serverTs(),
      aTimestamp: ms => firebase.firestore.Timestamp.fromMillis(ms)
    });

    // Escritura en lotes (rápida y atómica por lote)
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(op => {
        const ref = db.collection("asistencias").doc(op.id);
        if (op.tipo === "set") batch.set(ref, op.data);
        else batch.update(ref, op.data);
      });
      await batch.commit();
    }

    showMessage(ops.length > 0 ? `Lista guardada (${ops.length} registro(s)).` : "No había cambios nuevos que guardar.", "success");

    await detenerEscaner();
    borrarBorrador();
    resetUILista();
    $("materiaLista").selectedIndex = 0;
    establecerFechaActualPorDefecto();
  } catch (e) {
    showMessage("No se pudo guardar la lista: " + traducirErrorFirebase(e), "error");
  } finally {
    btn.disabled = false;
  }
}

// ===============================
// CORRECCIÓN DE ESTADO (modal con motivo y contraseña)
// ===============================

// ctx: { tipo: "temporal" (lista en curso) | "historial" (registro ya guardado), cedula, docId, nombre, estadoActual }
function abrirCorreccion(ctx) {
  const esAdmin = currentUserRole === "admin";
  correccionCtx = ctx;

  // Un docente solo corrige faltas hacia presente, tardanza o justificado.
  // El admin puede dejar un registro guardado en cualquiera de los 4 estados.
  const opciones = (ctx.tipo === "historial" && esAdmin)
    ? ["presente", "tardanza", "justificado", "falta"]
    : ["presente", "tardanza", "justificado"];

  $("correccionAlumno").textContent = ctx.nombre || "";

  const sel = $("correccionEstado");
  sel.innerHTML = "";
  opciones.forEach(e => sel.add(new Option(`${ESTADOS[e].icono} ${ESTADOS[e].texto}`, e)));
  const sugerido = opciones.find(e => e !== ctx.estadoActual) || opciones[0];
  sel.value = sugerido;

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
  if (!password) {
    showFieldError("correccionPassword", "Ingresa tu contraseña.");
    ok = false;
  }
  if (!ok) return;

  try {
    await reautenticar(password);
  } catch (e) {
    return showFieldError("correccionPassword", "Contraseña incorrecta.");
  }

  const ctx = correccionCtx;
  cerrarCorreccion();

  if (ctx.tipo === "temporal") aplicarCorreccionTemporal(ctx.cedula, estado, motivo);
  else await aplicarCorreccionHistorial(ctx.docId, estado, motivo);
}

function aplicarCorreccionTemporal(cedula, estado, motivo) {
  const ahora = new Date();
  const asiste = ESTADOS_ASISTE.includes(estado);
  marcas.set(cedula, {
    estado,
    hora: asiste ? horaTexto(ahora) : "",
    ts: asiste ? ahora.getTime() : null,
    motivo: estado === "justificado" ? motivo : "",
    guardado: false
  });
  refrescarListas();
  guardarBorrador();
  showMessage(`${ESTADOS[estado].icono} Estado actualizado.`, "success");
}

async function aplicarCorreccionHistorial(docId, estado, motivo) {
  const ahora = new Date();
  const asiste = ESTADOS_ASISTE.includes(estado);

  const datos = {
    estado,
    presente: asiste,
    hora: asiste ? horaTexto(ahora) : null,
    horaTs: asiste ? firebase.firestore.Timestamp.fromMillis(ahora.getTime()) : null,
    motivo: estado === "justificado" ? motivo : firebase.firestore.FieldValue.delete(),
    corregido: true,
    corregidoPor: auth.currentUser.email,
    corregidoEn: serverTs(),
    actualizadoEn: serverTs()
  };

  try {
    await db.collection("asistencias").doc(docId).update(datos);
    showMessage("Registro actualizado.", "success");
    cargarHistorial(true);
  } catch (e) {
    showMessage("No se pudo actualizar: " + traducirErrorFirebase(e), "error");
  }
}

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
    const registros = await consultarAsistencias({
      materiaIds: matSel === "todas" ? null : [matSel],
      desde: periodo !== "todo" ? fechaHaceDias(Number(periodo)) : ""
    });

    const r = resumenEstados(registros);
    const { pct } = textoResumen(r);
    $("dashResumen").textContent = r.total
      ? `${r.total} registros · asistencia ${pct}${JUSTIFICADO_CUENTA_EN_CONTRA ? "" : " (las justificadas no cuentan en contra)"}`
      : "Sin registros en este periodo.";

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart($("grafico"), {
      type: "pie",
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

// ===============================
// ADMINISTRACIÓN DE USUARIOS Y DOCENTES
// ===============================

// Segunda app de Firebase: permite crear cuentas sin cerrar la sesión del admin
function authSecundaria() {
  if (!appSecundaria) appSecundaria = firebase.initializeApp(firebaseConfig, "secundaria");
  return appSecundaria.auth();
}

function generarPasswordTemporal() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(12);
  window.crypto.getRandomValues(bytes);
  let pass = "";
  bytes.forEach(b => { pass += alfabeto[b % alfabeto.length]; });
  $("nuevoDocentePassword").value = pass;
  clearFieldError("nuevoDocentePassword");
}

async function crearDocente() {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede crear docentes.", "error");

  clearFields(["nuevoDocenteNombre", "nuevoDocenteEmail", "nuevoDocentePassword"]);
  const nombre = normalizarTexto($("nuevoDocenteNombre").value);
  const email = $("nuevoDocenteEmail").value.trim();
  const password = $("nuevoDocentePassword").value;
  const enviarCorreo = $("nuevoDocenteCorreo").checked;

  let ok = true;
  if (!validarNombre(nombre)) { showFieldError("nuevoDocenteNombre", "Solo letras y espacios."); ok = false; } else markFieldValid("nuevoDocenteNombre");
  if (!validarEmail(email)) { showFieldError("nuevoDocenteEmail", "Correo inválido."); ok = false; } else markFieldValid("nuevoDocenteEmail");
  if (!validarPassword(password)) { showFieldError("nuevoDocentePassword", "Mínimo 6 caracteres (usa «Generar»)."); ok = false; } else markFieldValid("nuevoDocentePassword");
  if (!ok) return;

  const btn = $("btnCrearDocente");
  btn.disabled = true;

  let uid = null;
  try {
    const secundaria = authSecundaria();
    const cred = await secundaria.createUserWithEmailAndPassword(email, password);
    uid = cred.user.uid;
    await secundaria.signOut();
  } catch (e) {
    btn.disabled = false;
    if (e && e.code === "auth/email-already-in-use") {
      return showFieldError("nuevoDocenteEmail", "Ya existe una cuenta con ese correo. Búscala en la lista de usuarios y cámbiale el rol a Docente.");
    }
    return showMessage(traducirErrorFirebase(e), "error");
  }

  try {
    await db.collection("users").doc(uid).set({
      email,
      nombre,
      role: "profesor",
      creadoEn: serverTs(),
      creadoPor: auth.currentUser.email
    });
  } catch (e) {
    btn.disabled = false;
    return showMessage("La cuenta se creó, pero no se pudo guardar su perfil: " + traducirErrorFirebase(e) + " Cuando inicie sesión aparecerá como pendiente.", "error");
  }

  let correoEnviado = false;
  if (enviarCorreo) {
    try {
      await auth.sendPasswordResetEmail(email);
      correoEnviado = true;
    } catch (e) { /* no es crítico: se puede reenviar desde la lista */ }
  }

  btn.disabled = false;
  limpiarInput("nuevoDocenteNombre");
  limpiarInput("nuevoDocenteEmail");
  limpiarInput("nuevoDocentePassword");
  clearFields(["nuevoDocenteNombre", "nuevoDocenteEmail", "nuevoDocentePassword"]);

  showMessage(
    "Docente creado." + (correoEnviado ? " Le enviamos un correo para elegir su contraseña." : "") + " Asígnalo a sus materias en Materias > Docentes.",
    "success"
  );
  cargarUsuarios();
}

async function cargarUsuarios() {
  if (currentUserRole !== "admin") return;
  const ul = $("listaUsuarios");
  ul.innerHTML = "<li>Cargando...</li>";

  try {
    await cargarUsuariosCache();
    const usuarios = Object.values(usuariosMap);

    // Primero los pendientes de aprobar, luego por nombre
    usuarios.sort((a, b) => {
      const pa = a.role === "pendiente" ? 0 : 1;
      const pb = b.role === "pendiente" ? 0 : 1;
      return pa - pb || nombreUsuario(a).localeCompare(nombreUsuario(b));
    });

    ul.innerHTML = "";
    if (usuarios.length === 0) {
      ul.innerHTML = "<li>No hay usuarios registrados.</li>";
      return;
    }

    usuarios.forEach(u => {
      const li = document.createElement("li");
      const esYo = u.uid === auth.currentUser.uid;

      li.innerHTML = `<strong>${esc(u.nombre || u.email || u.uid)}</strong>${esYo ? " <small>(tú)</small>" : ""}<br><small>${esc(u.email || "")}</small><br>`;

      const select = document.createElement("select");
      ROLES_VALIDOS.forEach(r => select.add(new Option(textoRol(r), r)));
      if (!ROLES_VALIDOS.includes(u.role)) select.add(new Option(textoRol(u.role), ""), 0);
      select.value = ROLES_VALIDOS.includes(u.role) ? u.role : "";
      select.disabled = esYo;
      li.appendChild(select);

      if (!esYo) {
        const btn = document.createElement("button");
        btn.className = "small";
        btn.textContent = "Guardar rol";
        btn.onclick = () => cambiarRolUsuario(u.uid, select.value);
        li.appendChild(btn);

        if (u.email) {
          const btnCorreo = document.createElement("button");
          btnCorreo.className = "small secondary";
          btnCorreo.textContent = "Correo de contraseña";
          btnCorreo.onclick = () => enviarCorreoPassword(u.email);
          li.appendChild(btnCorreo);
        }
      }

      ul.appendChild(li);
    });
  } catch (e) {
    ul.innerHTML = "";
    showMessage("No se pudieron cargar los usuarios: " + traducirErrorFirebase(e), "error");
  }
}

async function cambiarRolUsuario(uid, rol) {
  if (currentUserRole !== "admin") return showMessage("Solo admin.", "error");
  if (!ROLES_VALIDOS.includes(rol)) return showMessage("Selecciona un rol válido.", "error");

  try {
    await db.collection("users").doc(uid).update({ role: rol, actualizadoEn: serverTs() });
    showMessage("Rol actualizado.", "success");
    cargarUsuarios();
  } catch (e) {
    showMessage("No se pudo cambiar el rol: " + traducirErrorFirebase(e), "error");
  }
}

async function enviarCorreoPassword(email) {
  if (currentUserRole !== "admin") return;
  try {
    await auth.sendPasswordResetEmail(email);
    showMessage(`Correo enviado a ${email}.`, "success");
  } catch (e) {
    showMessage("No se pudo enviar el correo: " + traducirErrorFirebase(e), "error");
  }
}

// ===============================
// EVENTOS
// ===============================

document.addEventListener("DOMContentLoaded", () => {
  // Campos numéricos: solo dígitos
  ["cedula", "cedulaAsignar", "manualCedula", "cedulaReporte"].forEach(id => {
    if ($(id)) $(id).addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); });
  });

  // Enter para enviar
  ["email", "password"].forEach(id => {
    if ($(id)) $(id).addEventListener("keydown", e => { if (e.key === "Enter") login(); });
  });
  if ($("manualCedula")) {
    $("manualCedula").addEventListener("keydown", e => { if (e.key === "Enter") registrarManual(); });
  }
  if ($("correccionPassword")) {
    $("correccionPassword").addEventListener("keydown", e => { if (e.key === "Enter") confirmarCorreccion(); });
  }
});
