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
let currentUserNombre = "";           // nombre del perfil (users/{uid}.nombre)

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
let resumenReporteActual = [];     // filas del reporte por estudiante (para exportar)

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

// Nombre de quien hace la acción (para guardarlo en los registros)
// Nombre (nunca el correo) de quien está usando la app; "" si el perfil no tiene nombre
function nombreActor() {
  return currentUserNombre || "";
}

// Si el perfil no tiene nombre, lo pide una vez y lo guarda (las reglas permiten cambiar el propio nombre)
async function asegurarNombre() {
  if (currentUserNombre || typeof prompt !== "function") return;
  const texto = prompt("Tu perfil no tiene nombre. Escríbelo para que aparezca como docente en las listas y reportes:");
  const nombre = normalizarTexto(texto || "");
  if (!validarNombre(nombre) || nombre.length > 80) return;
  try {
    await db.collection("users").doc(auth.currentUser.uid).update({ nombre });
    currentUserNombre = nombre;
    if ($("miNombre")) $("miNombre").value = nombre;
  } catch (e) { /* se continúa sin nombre */ }
}

// Un valor que en realidad es un correo no cuenta como nombre
function esNombreReal(n) {
  return !!n && !String(n).includes("@");
}

// Nombre de una persona a partir de su correo (solo el admin conoce a todos los usuarios)
function nombreDeEmail(email) {
  const u = Object.values(usuariosMap).find(x => x.email === email);
  return u && u.nombre ? u.nombre : "";
}

// Docente que registró la asistencia: nombre (no correo). Los registros antiguos no lo
// guardaban: el admin lo resuelve por el correo; si no se puede, se muestra el correo.
function nombreDocente(registro) {
  return (esNombreReal(registro.profesorNombre) ? registro.profesorNombre : "") ||
    nombreDeEmail(registro.profesor) || registro.profesor || "No registrado";
}

// ¿Puede el usuario actual modificar una asistencia ya guardada (no falta) de esa fecha?
// Admin: siempre. Docente: solo en las listas de hoy (las reglas de Firestore lo exigen igual).
function puedeModificarGuardado(fecha) {
  return currentUserRole === "admin" || fecha === fechaLocalISO();
}

// ¿Puede corregir este registro? Una falta se puede cambiar siempre (p. ej. para justificarla).
function puedeCorregirRegistro(registro) {
  return currentUserRole === "admin" || estadoDe(registro) === "falta" || registro.fecha === fechaLocalISO();
}

// Estado de un registro. Los registros antiguos solo tienen "presente": true/false.
function estadoDe(registro) {
  if (registro && ESTADOS[registro.estado]) return registro.estado;
  return registro && registro.presente ? "presente" : "falta";
}

// Cuenta estados y calcula el porcentaje de asistencia según la política elegida
function resumenEstados(registros) {
  const c = { presente: 0, tardanza: 0, justificado: 0, falta: 0 };
  registros.forEach(x => { c[estadoDe(x)]++; });
  return resumenDeConteos(c);
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
  if (!listaActiva) preseleccionarMateriaUnica();

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
  } else if (id === "historial") {
    cargarHistorial();
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

// Con una sola materia asignada, queda elegida para pasar lista
function preseleccionarMateriaUnica() {
  const sel = $("materiaLista");
  if (sel && materiasLista.length === 1) sel.value = materiasLista[0].id;
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
