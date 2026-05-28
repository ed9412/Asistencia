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

let currentUserRole = null;
let estudiantesMateria = [];
let presentesSet = new Set();
let presentTimes = new Map();
let html5QrCode = null;
let chartInstance = null;
let bloqueadoScan = false;
let contextoModal = null;
let estudianteActual = null;
let materiaActual = null;


// ===============================
// UTILIDADES
// ===============================

async function confirmarModal() {

  try {

    if (contextoModal === "editarEstudiante") {

      const nombres = normalizarTexto($("modalNombres").value);
      const apellidos = normalizarTexto($("modalApellidos").value);
      const materiaId = $("modalMateria").value;

      if (!validarNombre(nombres) || !validarNombre(apellidos)) {
        showMessage("Datos inválidos", "error");
        return;
      }

      await db.collection("estudiantes")
        .doc(estudianteActual.cedula)
        .update({ nombres, apellidos });

      // eliminar relaciones anteriores
      const rel = await db.collection("materia_estudiante")
        .where("cedula", "==", estudianteActual.cedula)
        .get();

      for (const r of rel.docs) {
        await db.collection("materia_estudiante").doc(r.id).delete();
      }

      // insertar nueva (sin duplicado)
      const dup = await db.collection("materia_estudiante")
        .where("cedula", "==", estudianteActual.cedula)
        .where("materiaId", "==", materiaId)
        .get();

      if (dup.empty) {
        await db.collection("materia_estudiante").add({
          cedula: estudianteActual.cedula,
          materiaId
        });
      }

      showMessage("Estudiante actualizado", "success");
      listarEstudiantes();
    }

    if (contextoModal === "eliminarEstudiante") {

      const pass = $("modalPassword").value;

      await auth.signInWithEmailAndPassword(
        auth.currentUser.email,
        pass
      );

      await db.collection("estudiantes")
        .doc(estudianteActual.cedula)
        .delete();

      showMessage("Estudiante eliminado", "success");
      listarEstudiantes();
    }

    if (contextoModal === "editarMateria") {

      const nombre = normalizarTexto($("modalNombreMateria").value);

      if (!validarMateria(nombre)) {
        showMessage("Nombre inválido", "error");
        return;
      }

      const dup = await db.collection("materias")
        .where("nombre", "==", nombre)
        .get();

      if (!dup.empty) {
        showMessage("Materia duplicada", "error");
        return;
      }

      await db.collection("materias")
        .doc(materiaActual.id)
        .update({ nombre });

      showMessage("Materia actualizada", "success");
      cargarMaterias();
    }

    if (contextoModal === "eliminarMateria") {

      const pass = $("modalPassword").value;

      await auth.signInWithEmailAndPassword(
        auth.currentUser.email,
        pass
      );

      await db.collection("materias")
        .doc(materiaActual.id)
        .delete();

      showMessage("Materia eliminada", "success");
      cargarMaterias();
    }

    cerrarModal();

  } catch {
    showMessage("Error o contraseña incorrecta", "error");
  }
}

function cerrarModal() {
  $("modalGeneral").style.display = "none";
}


function $(id) {
  return document.getElementById(id);
}

function showMessage(message, type = "info") {
  const toast = $("toast");
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.style.display = "block";

  setTimeout(() => {
    toast.style.display = "none";
  }, 3500);
}

function setLoginError(message) {
  $("loginError").textContent = message || "";
}

function mostrar(id) {
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.remove("active");
  });

  const screen = $(id);

  if (screen) {
    screen.classList.add("active");
  }
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

function horaActual() {
  return new Date().toLocaleTimeString();
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

function validarEmail(value) {
  const emailValue = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue);
}

function validarPassword(value) {
  return value && value.length >= 6;
}

function validarCedula(value) {
  const cedulaValue = value.trim();
  return /^[0-9]+$/.test(cedulaValue) && cedulaValue.length >= 4;
}

function validarNombre(value) {
  const nombreValue = normalizarTexto(value);
  return /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/.test(nombreValue) && nombreValue.length >= 2;
}

function validarMateria(value) {
  const materiaValue = normalizarTexto(value);
  return /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü0-9\s\-]+$/.test(materiaValue) && materiaValue.length >= 2;
}

function validarTextoGeneral(value, min = 2) {
  return normalizarTexto(value).length >= min;
}

function validarLoginCampos() {
  let ok = true;

  clearFields(["email", "password"]);
  setLoginError("");

  const emailValue = $("email").value.trim();
  const passwordValue = $("password").value;

  if (!validarEmail(emailValue)) {
    showFieldError("email", "Ingresa un correo electrónico válido.");
    ok = false;
  } else {
    markFieldValid("email");
  }

  if (!validarPassword(passwordValue)) {
    showFieldError("password", "La contraseña debe tener al menos 6 caracteres.");
    ok = false;
  } else {
    markFieldValid("password");
  }

  return ok;
}

function validarEstudianteCampos() {
  let ok = true;

  clearFields(["cedula", "nombres", "apellidos"]);

  const cedulaValue = $("cedula").value.trim();
  const nombresValue = normalizarTexto($("nombres").value);
  const apellidosValue = normalizarTexto($("apellidos").value);

  if (!validarCedula(cedulaValue)) {
    showFieldError("cedula", "La cédula debe contener solo números y mínimo 4 dígitos.");
    ok = false;
  } else {
    markFieldValid("cedula");
  }

  if (!validarNombre(nombresValue)) {
    showFieldError("nombres", "Los nombres deben contener solo letras y espacios.");
    ok = false;
  } else {
    markFieldValid("nombres");
  }

  if (!validarNombre(apellidosValue)) {
    showFieldError("apellidos", "Los apellidos deben contener solo letras y espacios.");
    ok = false;
  } else {
    markFieldValid("apellidos");
  }

  return ok;
}

function validarMateriaCampos() {
  let ok = true;

  clearFields(["materiaNombre"]);

  const nombreValue = normalizarTexto($("materiaNombre").value);

  if (!validarMateria(nombreValue)) {
    showFieldError("materiaNombre", "La materia debe tener mínimo 2 caracteres. Puedes usar letras, números, espacios o guion.");
    ok = false;
  } else {
    markFieldValid("materiaNombre");
  }

  return ok;
}

function validarAsignacionCampos() {
  let ok = true;

  clearFields(["cedulaAsignar", "materiaSelect"]);

  const cedulaValue = $("cedulaAsignar").value.trim();
  const materiaId = $("materiaSelect").value;

  if (!validarCedula(cedulaValue)) {
    showFieldError("cedulaAsignar", "La cédula debe contener solo números.");
    ok = false;
  } else {
    markFieldValid("cedulaAsignar");
  }

  if (!materiaId) {
    showFieldError("materiaSelect", "Selecciona una materia.");
    ok = false;
  } else {
    markFieldValid("materiaSelect");
  }

  return ok;
}

function validarInicioListaCampos() {
  let ok = true;

  clearFields(["materiaLista", "fechaLista"]);

  if (!$("materiaLista").value) {
    showFieldError("materiaLista", "Selecciona una materia.");
    ok = false;
  } else {
    markFieldValid("materiaLista");
  }

  if (!$("fechaLista").value) {
    showFieldError("fechaLista", "Selecciona la fecha de asistencia.");
    ok = false;
  } else {
    markFieldValid("fechaLista");
  }

  return ok;
}

function validarManualCedula() {
  clearFieldError("manualCedula");

  const cedulaValue = $("manualCedula").value.trim();

  if (!validarCedula(cedulaValue)) {
    showFieldError("manualCedula", "La cédula debe contener solo números y mínimo 4 dígitos.");
    return false;
  }

  markFieldValid("manualCedula");
  return true;
}

function validarReporteCampos() {
  clearFieldError("cedulaReporte");

  const cedulaValue = $("cedulaReporte").value.trim();

  if (!validarCedula(cedulaValue)) {
    showFieldError("cedulaReporte", "Ingresa una cédula válida.");
    return false;
  }

  markFieldValid("cedulaReporte");
  return true;
}

function validarAdminRolCampos() {
  let ok = true;

  clearFields(["uidRol", "emailRol", "rolNuevo"]);

  const uid = $("uidRol").value.trim();
  const emailValue = $("emailRol").value.trim();
  const rolValue = $("rolNuevo").value;

  if (!validarTextoGeneral(uid, 10)) {
    showFieldError("uidRol", "Ingresa un UID válido de Firebase Authentication.");
    ok = false;
  } else {
    markFieldValid("uidRol");
  }

  if (!validarEmail(emailValue)) {
    showFieldError("emailRol", "Ingresa un correo válido.");
    ok = false;
  } else {
    markFieldValid("emailRol");
  }

  if (!["admin", "profesor"].includes(rolValue)) {
    showFieldError("rolNuevo", "Selecciona un rol válido.");
    ok = false;
  } else {
    markFieldValid("rolNuevo");
  }

  return ok;
}

// ===============================
// TRADUCIR ERRORES FIREBASE
// ===============================

function traducirErrorFirebase(error) {
  const code = error?.code || "";

  const errores = {
    "auth/invalid-email": "El correo electrónico no tiene un formato válido.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/wrong-password": "La contraseña es incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/network-request-failed": "No hay conexión con Firebase. Revisa internet o la configuración.",
    "auth/too-many-requests": "Demasiados intentos. Intenta nuevamente más tarde.",
    "permission-denied": "No tienes permisos para realizar esta acción.",
    "unavailable": "Firestore no está disponible en este momento. Intenta más tarde."
  };

  return errores[code] || error?.message || "Ocurrió un error inesperado.";
}

// ===============================
// CONEXIÓN FIRESTORE
// ===============================

async function verificarConexionFirestore() {
  try {
    await db.collection("materias").limit(1).get();
    return true;
  } catch (error) {
    showMessage("No se pudo conectar a Firestore: " + traducirErrorFirebase(error), "error");
    return false;
  }
}

// ===============================
// AUTH
// ===============================

async function login() {
  if (!validarLoginCampos()) return;

  const emailValue = $("email").value.trim();
  const passwordValue = $("password").value;

  try {
    await auth.signInWithEmailAndPassword(emailValue, passwordValue);

    const conectado = await verificarConexionFirestore();

    if (!conectado) return;

    await initApp();

    showMessage("Inicio de sesión correcto.", "success");

  } catch (error) {
    const mensaje = traducirErrorFirebase(error);
    setLoginError(mensaje);
    showMessage(mensaje, "error");
  }
}

async function registrar() {
  if (!validarLoginCampos()) return;

  const emailValue = $("email").value.trim();
  const passwordValue = $("password").value;

  try {
    const cred = await auth.createUserWithEmailAndPassword(emailValue, passwordValue);

    await db.collection("users").doc(cred.user.uid).set({
      email: cred.user.email,
      role: "profesor",
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

    showMessage("Cuenta creada correctamente. Rol inicial: profesor.", "success");

    await initApp();

  } catch (error) {
    const mensaje = traducirErrorFirebase(error);
    setLoginError(mensaje);
    showMessage(mensaje, "error");
  }
}

async function logout() {
  try {
    await detenerEscaner();
    await auth.signOut();
    location.reload();
  } catch (error) {
    showMessage("No se pudo cerrar sesión: " + traducirErrorFirebase(error), "error");
  }
}

auth.onAuthStateChanged(async user => {
  if (user && $("app").style.display === "none") {
    try {
      await initApp();
    } catch (error) {
      showMessage("Error al cargar la sesión: " + traducirErrorFirebase(error), "error");
    }
  }
});

// ===============================
// INICIALIZAR APP
// ===============================

async function initApp() {
  const user = auth.currentUser;

  if (!user) return;

  try {
    let userDoc = await db.collection("users").doc(user.uid).get();

    if (!userDoc.exists) {
      await db.collection("users").doc(user.uid).set({
        email: user.email,
        role: "profesor",
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      });

      userDoc = await db.collection("users").doc(user.uid).get();
    }

    currentUserRole = userDoc.data().role || "profesor";

    $("loginScreen").style.display = "none";
    $("app").style.display = "block";

    $("rolInfo").textContent = `${user.email} · Rol: ${currentUserRole}`;

    $("adminNavBtn").style.display = currentUserRole === "admin" ? "block" : "none";

    mostrar("dashboard");

    await cargarMaterias();
    await listarEstudiantes();

  } catch (error) {
    showMessage("Error inicializando la app: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// ROLES ADMIN
// ===============================

async function asignarRol() {
  if (currentUserRole !== "admin") {
    showMessage("Solo un administrador puede asignar roles.", "error");
    return;
  }

  if (!validarAdminRolCampos()) return;

  const uid = $("uidRol").value.trim();
  const emailValue = $("emailRol").value.trim();
  const rolValue = $("rolNuevo").value;

  try {
    await db.collection("users").doc(uid).set({
      email: emailValue,
      role: rolValue,
      actualizadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      actualizadoPor: auth.currentUser.email
    });

    await registrarAuditoria("Asignar rol", `Se asignó rol ${rolValue} al usuario ${emailValue}`);

    showMessage("Rol asignado correctamente.", "success");

    limpiarInput("uidRol");
    limpiarInput("emailRol");
    clearFields(["uidRol", "emailRol", "rolNuevo"]);

  } catch (error) {
    showMessage("No se pudo asignar el rol: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// ESTUDIANTES
// ===============================

async function crearEstudiante() {
  if (currentUserRole !== "admin") {
    showMessage("Solo un administrador puede crear estudiantes.", "error");
    return;
  }

  if (!validarEstudianteCampos()) return;

  const cedulaValue = $("cedula").value.trim();
  const nombresValue = normalizarTexto($("nombres").value);
  const apellidosValue = normalizarTexto($("apellidos").value);

  try {
    const ref = db.collection("estudiantes").doc(cedulaValue);
    const existente = await ref.get();

    if (existente.exists) {
      showFieldError("cedula", "Ya existe un estudiante con esa cédula.");
      showMessage("Ya existe un estudiante con esa cédula.", "error");
      return;
    }

    await ref.set({
      cedula: cedulaValue,
      nombres: nombresValue,
      apellidos: apellidosValue,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      creadoPor: auth.currentUser.email
    });

    await registrarAuditoria("Crear estudiante", `Se creó el estudiante ${cedulaValue}`);

    showMessage("Estudiante creado correctamente.", "success");

    limpiarInput("cedula");
    limpiarInput("nombres");
    limpiarInput("apellidos");
    clearFields(["cedula", "nombres", "apellidos"]);

    await listarEstudiantes();

  } catch (error) {
    showMessage("No se pudo crear el estudiante: " + traducirErrorFirebase(error), "error");
  }
}

async function listarEstudiantes() {
  limpiarLista("listaEstudiantes");

  try {
    const snap = await db.collection("estudiantes")
      .orderBy("apellidos")
      .get();

    if (snap.empty) {
      $("listaEstudiantes").innerHTML = "<li>No hay estudiantes registrados.</li>";
      return;
    }

    snap.forEach(doc => {
      const estudiante = doc.data();

      const li = document.createElement("li");

      li.innerHTML = `
        <strong>${estudiante.cedula}</strong><br>
        ${estudiante.nombres} ${estudiante.apellidos}
      `;

      const btn = document.createElement("button");
      btn.textContent = "Ver QR";
      btn.className = "secondary";
      btn.onclick = () => mostrarQR(estudiante.cedula);

      li.appendChild(btn);
      $("listaEstudiantes").appendChild(li);
    });

  } catch (error) {
    showMessage("Error cargando estudiantes: " + traducirErrorFirebase(error), "error");
  }
}

function mostrarQR(cedulaValue) {
  $("qrModal").style.display = "block";

  QRCode.toCanvas($("qrCanvas"), cedulaValue, error => {
    if (error) {
      showMessage("No se pudo generar el QR.", "error");
    }
  });
}

function cerrarQR() {
  $("qrModal").style.display = "none";
}

async function buscarEstudiantes() {

  const nombre = $("buscarNombre").value.toLowerCase();
  const materiaId = $("buscarMateria").value;

  let lista = [];

  const snap = await db.collection("estudiantes").get();
  snap.forEach(d => lista.push(d.data()));

  if (materiaId) {
    const rel = await db.collection("materia_estudiante")
      .where("materiaId", "==", materiaId)
      .get();

    const cedulas = rel.docs.map(r => r.data().cedula);
    lista = lista.filter(e => cedulas.includes(e.cedula));
  }

  if (nombre) {
    lista = lista.filter(e =>
      `${e.nombres} ${e.apellidos}`.toLowerCase().includes(nombre)
    );
  }

  renderListaEstudiantes(lista);
}

async function renderListaEstudiantes(lista) {

  limpiarLista("listaEstudiantes");

  for (const est of lista) {

    let materiaNombre = "Sin materia";

    const rel = await db.collection("materia_estudiante")
      .where("cedula", "==", est.cedula)
      .get();

    if (!rel.empty) {
      const materiaId = rel.docs[0].data().materiaId;

      const mat = await db.collection("materias").doc(materiaId).get();
      if (mat.exists) materiaNombre = mat.data().nombre;
    }

    const li = document.createElement("li");

    li.innerHTML = `
      <strong>${est.cedula}</strong><br>
      ${est.nombres} ${est.apellidos}<br>
      <small>📚 ${materiaNombre}</small>
    `;

    const qr = document.createElement("button");
    qr.textContent = "QR";
    qr.className = "secondary small";
    qr.onclick = () => mostrarQR(est.cedula);

    const edit = document.createElement("button");
    edit.textContent = "Editar";
    edit.className = "small";
    edit.onclick = () => abrirEditarEstudiante(est);

    const del = document.createElement("button");
    del.textContent = "Eliminar";
    del.className = "danger small";
    del.onclick = () => abrirEliminarEstudiante(est.cedula);

    li.append(qr, edit, del);

    $("listaEstudiantes").appendChild(li);
  }
}

async function abrirEditarEstudiante(est) {

  estudianteActual = est;
  contextoModal = "editarEstudiante";

  let materiaActualNombre = "Sin materia";
  let materiaActualId = "";

  const rel = await db.collection("materia_estudiante")
    .where("cedula", "==", est.cedula)
    .get();

  if (!rel.empty) {
    materiaActualId = rel.docs[0].data().materiaId;

    const mat = await db.collection("materias").doc(materiaActualId).get();
    if (mat.exists) materiaActualNombre = mat.data().nombre;
  }

  const snap = await db.collection("materias").orderBy("nombre").get();

  let opciones = "";
  snap.forEach(doc => {
    const m = doc.data();
    opciones += `<option value="${doc.id}" ${
      doc.id === materiaActualId ? "selected" : ""
    }>${m.nombre}</option>`;
  });

  $("modalTitulo").textContent = "Editar estudiante";

  $("modalBody").innerHTML = `
    <label>Nombres</label>
    <input id="modalNombres" value="${est.nombres}">

    <label>Apellidos</label>
    <input id="modalApellidos" value="${est.apellidos}">

    <label>Materia actual</label>
    <input value="${materiaActualNombre}" disabled>

    <label>Cambiar materia</label>
    <select id="modalMateria">${opciones}</select>
  `;

  $("modalGeneral").style.display = "block";
}

function abrirEliminarEstudiante(cedula) {

  estudianteActual = { cedula };
  contextoModal = "eliminarEstudiante";

  $("modalTitulo").textContent = "Eliminar estudiante";

  $("modalBody").innerHTML = `
    <p>Ingresa tu contraseña:</p>
    <input type="password" id="modalPassword">
  `;

  $("modalGeneral").style.display = "block";
}





// ===============================
// MATERIAS
// ===============================

async function crearMateria() {
  if (currentUserRole !== "admin") {
    showMessage("Solo un administrador puede crear materias.", "error");
    return;
  }

  if (!validarMateriaCampos()) return;

  const nombreValue = normalizarTexto($("materiaNombre").value);

  try {
    const existente = await db.collection("materias")
      .where("nombre", "==", nombreValue)
      .get();

    if (!existente.empty) {
      showFieldError("materiaNombre", "Ya existe una materia con ese nombre.");
      showMessage("Ya existe una materia con ese nombre.", "error");
      return;
    }

    await db.collection("materias").add({
      nombre: nombreValue,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      creadoPor: auth.currentUser.email
    });

    await registrarAuditoria("Crear materia", `Se creó la materia ${nombreValue}`);

    showMessage("Materia creada correctamente.", "success");

    limpiarInput("materiaNombre");
    clearFieldError("materiaNombre");

    await cargarMaterias();

  } catch (error) {
    showMessage("No se pudo crear la materia: " + traducirErrorFirebase(error), "error");
  }
}

async function cargarMaterias() {
  $("materiaLista").innerHTML = "";
  $("materiaSelect").innerHTML = "";

  try {
    const snap = await db.collection("materias")
      .orderBy("nombre")
      .get();

    if (snap.empty) {
      $("materiaLista").add(new Option("No hay materias registradas", ""));
      $("materiaSelect").add(new Option("No hay materias registradas", ""));
      return;
    }

    $("materiaLista").add(new Option("Selecciona una materia", ""));
    $("materiaSelect").add(new Option("Selecciona una materia", ""));

    snap.forEach(doc => {
      const materia = doc.data();

      $("materiaLista").add(new Option(materia.nombre, doc.id));
      $("materiaSelect").add(new Option(materia.nombre, doc.id));
    });

    const selectBuscar = $("buscarMateria");
    if (selectBuscar) {
      selectBuscar.innerHTML = "";
      selectBuscar.add(new Option("Todas", ""));
    
      snap.forEach(doc => {
        const m = doc.data();
        selectBuscar.add(new Option(m.nombre, doc.id));
      });
    }

    //Fin mat buscador v1
  } catch (error) {
    showMessage("Error cargando materias: " + traducirErrorFirebase(error), "error");
  }
}

function abrirEditarMateria(id, nombre) {

  materiaActual = { id };
  contextoModal = "editarMateria";

  $("modalTitulo").textContent = "Editar materia";

  $("modalBody").innerHTML = `
    <label>Nombre</label>
    <input id="modalNombreMateria" value="${nombre}">
  `;

  $("modalGeneral").style.display = "block";
}

function abrirEliminarMateria(id) {

  materiaActual = { id };
  contextoModal = "eliminarMateria";

  $("modalTitulo").textContent = "Eliminar materia";

  $("modalBody").innerHTML = `
    <p>Ingresa tu contraseña:</p>
    <input type="password" id="modalPassword">
  `;

  $("modalGeneral").style.display = "block";
}

// ===============================
// ASIGNAR ESTUDIANTE A MATERIA
// ===============================

async function asignar() {
  if (currentUserRole !== "admin") {
    showMessage("Solo un administrador puede asignar estudiantes a materias.", "error");
    return;
  }

  if (!validarAsignacionCampos()) return;

  const cedulaValue = $("cedulaAsignar").value.trim();
  const materiaId = $("materiaSelect").value;

  try {
    const estudianteDoc = await db.collection("estudiantes").doc(cedulaValue).get();

    if (!estudianteDoc.exists) {
      showFieldError("cedulaAsignar", "No existe un estudiante con esa cédula.");
      showMessage("No existe un estudiante con esa cédula.", "error");
      return;
    }

    const duplicado = await db.collection("materia_estudiante")
      .where("cedula", "==", cedulaValue)
      .where("materiaId", "==", materiaId)
      .get();

    if (!duplicado.empty) {
      showMessage("Ese estudiante ya está asignado a esta materia.", "error");
      return;
    }

    await db.collection("materia_estudiante").add({
      cedula: cedulaValue,
      materiaId: materiaId,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
      creadoPor: auth.currentUser.email
    });

    await registrarAuditoria("Asignar materia", `Estudiante ${cedulaValue} asignado a materia ${materiaId}`);

    showMessage("Estudiante asignado correctamente.", "success");

    limpiarInput("cedulaAsignar");
    clearFields(["cedulaAsignar", "materiaSelect"]);

  } catch (error) {
    showMessage("No se pudo asignar el estudiante: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// PASAR LISTA
// ===============================

async function iniciarLista() {
  if (!validarInicioListaCampos()) return;

  const materiaId = $("materiaLista").value;

  try {
    presentesSet.clear();
    presentTimes.clear();
    limpiarLista("presentes");
    limpiarLista("faltantes");
    estudiantesMateria = [];

    const rel = await db.collection("materia_estudiante")
      .where("materiaId", "==", materiaId)
      .get();

    if (rel.empty) {
      showMessage("Esta materia no tiene estudiantes asignados.", "error");
      return;
    }

    for (const r of rel.docs) {
      const ced = r.data().cedula;
      const estudianteDoc = await db.collection("estudiantes").doc(ced).get();

      if (estudianteDoc.exists) {
        estudiantesMateria.push(estudianteDoc.data());
      }
    }

    if (estudiantesMateria.length === 0) {
      showMessage("No se encontraron estudiantes válidos para esta materia.", "error");
      return;
    }

    $("zonaLista").style.display = "block";

    actualizarPresentes();
    actualizarFaltantes();

    showMessage("Lista iniciada correctamente.", "success");

  } catch (error) {
    showMessage("No se pudo iniciar la lista: " + traducirErrorFirebase(error), "error");
  }
}

async function iniciarEscaner() {
  if (!validarInicioListaCampos()) return;

  if (estudiantesMateria.length === 0) {
    showMessage("Primero presiona 'Iniciar lista'.", "error");
    return;
  }

  if (html5QrCode) {
    showMessage("La cámara ya está activa.", "info");
    return;
  }

  try {
    html5QrCode = new Html5Qrcode("reader");

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 250 },

      async code => {
        if (bloqueadoScan) return;
      
        bloqueadoScan = true;
      
        await registrarAsistencia(code.trim());
      
        // 🔹 Esperar 1 segundo antes de permitir otro escaneo
        setTimeout(() => {
          bloqueadoScan = false;
        }, 2000);
      }
);

    showMessage("Cámara iniciada.", "success");

  } catch (error) {
    html5QrCode = null;
    showMessage("No se pudo iniciar la cámara. Revisa permisos del navegador.", "error");
  }
}

async function detenerEscaner() {
  if (!html5QrCode) return;

  try {
    await html5QrCode.stop();
    html5QrCode.clear();
    html5QrCode = null;
    showMessage("Cámara detenida.", "info");
  } catch (error) {
    html5QrCode = null;
  }
}

function registrarManual() {
  if (!validarManualCedula()) return;

  registrarAsistencia($("manualCedula").value.trim());
}

async function registrarAsistencia(cedulaValue) {
  clearFieldError("manualCedula");

  if (!validarCedula(cedulaValue)) {
    showFieldError("manualCedula", "El código debe contener una cédula válida.");
    showMessage("El QR o código manual no contiene una cédula válida.", "error");
    return;
  }

  if (!validarInicioListaCampos()) return;

  if (estudiantesMateria.length === 0) {
    showMessage("Primero debes iniciar la lista.", "error");
    return;
  }

  const materiaId = $("materiaLista").value;
  const fechaValue = $("fechaLista").value;

  const estudianteAsignado = estudiantesMateria.some(est => est.cedula === cedulaValue);

  if (!estudianteAsignado) {
    showFieldError("manualCedula", "Este estudiante no pertenece a esta materia.");
    showMessage("Este estudiante no está asignado a la materia seleccionada.", "error");
    return;
  }

  if (presentesSet.has(cedulaValue)) {
    showMessage("Este estudiante ya fue marcado como presente.", "error");
    return;
  }

  const key = `${cedulaValue}_${fechaValue}_${materiaId}`;

  try {
    const asistenciaDoc = await db.collection("asistencias").doc(key).get();

    if (asistenciaDoc.exists) {
      showMessage("Este estudiante ya tiene registro guardado para esta fecha y materia.", "error");
      return;
    }

    presentesSet.add(cedulaValue);
    presentTimes.set(cedulaValue, horaActual());

    
    // 🔊 sonido de confirmación
    beep();


    actualizarPresentes();
    actualizarFaltantes();

    limpiarInput("manualCedula");
    clearFieldError("manualCedula");

    showMessage("Asistencia registrada temporalmente.", "success");

  } catch (error) {
    showMessage("No se pudo validar duplicado: " + traducirErrorFirebase(error), "error");
  }
}


function beep() {
  const audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg");
  audio.play();
}


function actualizarPresentes() {
  limpiarLista("presentes");

  if (presentesSet.size === 0) {
    $("presentes").innerHTML = "<li>No hay presentes todavía.</li>";
    return;
  }

  presentesSet.forEach(ced => {
    const estudiante = estudiantesMateria.find(est => est.cedula === ced);

    const li = document.createElement("li");
    li.innerHTML = `
      ✅ <strong>${ced}</strong><br>
      ${estudiante ? estudiante.nombres + " " + estudiante.apellidos : ""}
      <br><small>Hora: ${presentTimes.get(ced) || ""}</small>
    `;

    $("presentes").appendChild(li);
  });
}

function actualizarFaltantes() {
  limpiarLista("faltantes");

  const faltantesArray = estudiantesMateria.filter(est => !presentesSet.has(est.cedula));

  if (faltantesArray.length === 0) {
    $("faltantes").innerHTML = "<li>No hay faltantes.</li>";
    return;
  }

  faltantesArray.forEach(est => {
    const li = document.createElement("li");

    li.innerHTML = `
      ❌ <strong>${est.cedula}</strong><br>
      ${est.nombres} ${est.apellidos}
    `;

    const btn = document.createElement("button");
    btn.className = "secondary";
    btn.textContent = "Corregir como presente";
    btn.onclick = () => corregirTemporal(est.cedula);

    li.appendChild(btn);
    $("faltantes").appendChild(li);
  });
}

async function cerrarLista() {
  if (!validarInicioListaCampos()) return;

  const materiaId = $("materiaLista").value;
  const fechaValue = $("fechaLista").value;
  const materiaNombre = $("materiaLista").options[$("materiaLista").selectedIndex].text; //guardar nombre materia

  
  if (estudiantesMateria.length === 0) {
    showMessage("Primero debes iniciar la lista.", "error");
    return;
  }

  try {
    for (const est of estudiantesMateria) {
      const key = `${est.cedula}_${fechaValue}_${materiaId}`;
      const presente = presentesSet.has(est.cedula);

      await db.collection("asistencias").doc(key).set({
        cedula: est.cedula,
        nombres: est.nombres,
        apellidos: est.apellidos,
        materia: materiaId,
        materiaNombre: materiaNombre,
        fecha: fechaValue,
        presente: presente,
        hora: presente ? (presentTimes.get(est.cedula) || horaActual()) : null,
        profesor: auth.currentUser.email,
        actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: false });
    }

    await registrarAuditoria("Cerrar lista", `Lista cerrada para materia ${materiaId} fecha ${fechaValue}`);

    showMessage("Lista guardada correctamente.", "success");

    await detenerEscaner();

  } catch (error) {
    showMessage("No se pudo guardar la lista: " + traducirErrorFirebase(error), "error");
  }
}

async function corregirTemporal(cedulaValue) {
  const passwordConfirmacion = prompt("Por seguridad, escribe tu contraseña para corregir:");

  if (!passwordConfirmacion) {
    showMessage("Corrección cancelada.", "info");
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(auth.currentUser.email, passwordConfirmacion);

    presentesSet.add(cedulaValue);
    presentTimes.set(cedulaValue, horaActual());

    await registrarAuditoria("Corrección temporal", `Se corrigió como presente la cédula ${cedulaValue} antes de guardar la lista`);

    actualizarPresentes();
    actualizarFaltantes();

    showMessage("Corrección aplicada correctamente.", "success");

  } catch (error) {
    showMessage("Contraseña incorrecta o error al corregir.", "error");
  }
}

async function corregirRegistroCerrado(docId, cedulaValue) {
  const passwordConfirmacion = prompt("Por seguridad, escribe tu contraseña para corregir el registro guardado:");

  if (!passwordConfirmacion) {
    showMessage("Corrección cancelada.", "info");
    return;
  }

  try {
    await auth.signInWithEmailAndPassword(auth.currentUser.email, passwordConfirmacion);

    await db.collection("asistencias").doc(docId).update({
      presente: true,
      hora: horaActual(),
      corregido: true,
      corregidoPor: auth.currentUser.email,
      corregidoEn: firebase.firestore.FieldValue.serverTimestamp()
    });

    await registrarAuditoria("Corrección registro cerrado", `Se corrigió como presente la cédula ${cedulaValue}`);

    showMessage("Registro corregido correctamente.", "success");

    await cargarHistorial();

  } catch (error) {
    showMessage("No se pudo corregir el registro: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// AUDITORÍA
// ===============================

async function registrarAuditoria(accion, detalle) {
  try {
    await db.collection("auditoria").add({
      accion,
      detalle,
      usuario: auth.currentUser?.email || "desconocido",
      fecha: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.warn("No se pudo registrar auditoría:", error);
  }
}

// ===============================
// DASHBOARD
// ===============================

async function cargarDashboard() {
  try {
    const snap = await db.collection("asistencias").get();

    let presentes = 0;
    let faltantes = 0;

    snap.forEach(doc => {
      if (doc.data().presente) {
        presentes++;
      } else {
        faltantes++;
      }
    });

    if (chartInstance) {
      chartInstance.destroy();
    }

    chartInstance = new Chart($("grafico"), {
      type: "pie",
      data: {
        labels: ["Presentes", "Faltantes"],
        datasets: [{
          data: [presentes, faltantes],
          backgroundColor: ["#16a34a", "#dc2626"]
        }]
      }
    });

    showMessage("Dashboard actualizado.", "success");

  } catch (error) {
    showMessage("No se pudo cargar el dashboard: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// REPORTES
// ===============================

async function generarReporte() {
  if (!validarReporteCampos()) return;

  const cedulaValue = $("cedulaReporte").value.trim();

  try {
    const estudianteDoc = await db.collection("estudiantes").doc(cedulaValue).get();

    if (!estudianteDoc.exists) {
      showFieldError("cedulaReporte", "No existe un estudiante con esa cédula.");
      showMessage("No existe un estudiante con esa cédula.", "error");
      return;
    }

    const snap = await db.collection("asistencias")
      .where("cedula", "==", cedulaValue)
      .get();

    if (snap.empty) {
      $("reporte").innerHTML = "<p>No hay registros de asistencia para este estudiante.</p>";
      return;
    }

    let total = 0;
    let presentes = 0;
    let html = "";

    snap.forEach(doc => {
      const data = doc.data();

      total++;

      if (data.presente) presentes++;

      html += `
        <li>
          ${data.fecha} · ${data.presente ? "✅ Presente" : "❌ Faltante"}
          ${data.hora ? "<br><small>Hora: " + data.hora + "</small>" : ""}
        </li>
      `;
    });

    const porcentaje = ((presentes / total) * 100).toFixed(1);

    $("reporte").innerHTML = `
      <p><strong>Porcentaje de asistencia:</strong> ${porcentaje}%</p>
      <ul>${html}</ul>
    `;

  } catch (error) {
    showMessage("No se pudo generar el reporte: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// ALERTAS
// ===============================

async function generarAlertas() {
  limpiarLista("alertas");

  try {
    const estudiantesSnap = await db.collection("estudiantes").get();

    if (estudiantesSnap.empty) {
      $("alertas").innerHTML = "<li>No hay estudiantes registrados.</li>";
      return;
    }

    let cantidadAlertas = 0;

    for (const estudianteDoc of estudiantesSnap.docs) {
      const ced = estudianteDoc.id;

      const asistenciasSnap = await db.collection("asistencias")
        .where("cedula", "==", ced)
        .get();

      let total = 0;
      let presentes = 0;

      asistenciasSnap.forEach(doc => {
        total++;
        if (doc.data().presente) presentes++;
      });

      if (total > 0) {
        const porcentaje = presentes / total;

        if (porcentaje < 0.7) {
          cantidadAlertas++;

          const data = estudianteDoc.data();

          const li = document.createElement("li");
          li.innerHTML = `
            ⚠️ <strong>${ced}</strong><br>
            ${data.nombres} ${data.apellidos}<br>
            Asistencia: ${(porcentaje * 100).toFixed(1)}%
          `;

          $("alertas").appendChild(li);
        }
      }
    }

    if (cantidadAlertas === 0) {
      $("alertas").innerHTML = "<li>No hay alertas de baja asistencia.</li>";
    }

  } catch (error) {
    showMessage("No se pudieron generar alertas: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// HISTORIAL
// ===============================

async function cargarHistorial() {
  limpiarLista("historialLista");
  clearFieldError("filtroFecha");

  try {
    let query = db.collection("asistencias");

    if ($("filtroFecha").value) {
      query = query.where("fecha", "==", $("filtroFecha").value);
      markFieldValid("filtroFecha");
    }

    const snap = await query.get();

    if (snap.empty) {
      $("historialLista").innerHTML = "<li>No hay registros para mostrar.</li>";
      return;
    }

    snap.forEach(doc => {
      const data = doc.data();

      const li = document.createElement("li");


        // 🔹 Usa nombre si existe (nuevo), si no ID (viejo)
        const materia = data.materiaNombre || data.materia;
        
        li.innerHTML = `
        ${data.cedula}<br>
        <strong>${data.nombres || ""} ${data.apellidos || ""}</strong><br>
        <strong>Materia: ${materia}</strong><br>
        <strong>Fecha: ${data.fecha}</strong><br>
        Estado: ${data.presente ? "✅ Presente" : "❌ Faltante"}<br>
        Hora: ${data.hora || "Sin hora"}<br>
        Profesor: ${data.profesor || "No registrado"}
        `;


      if (!data.presente) {
        const btn = document.createElement("button");
        btn.className = "secondary";
        btn.textContent = "Corregir registro";
        btn.onclick = () => corregirRegistroCerrado(doc.id, data.cedula);
        li.appendChild(btn);
      }

      $("historialLista").appendChild(li);
    });

  } catch (error) {
    showMessage("No se pudo cargar el historial: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// EXPORTAR CSV
// ===============================

async function exportar() {
  try {
    const snap = await db.collection("asistencias").get();

    if (snap.empty) {
      showMessage("No hay datos para exportar.", "error");
      return;
    }

    let csv = "\uFEFFCedula;Nombres;Apellidos;Fecha;Materia;Presente;Hora;Profesor\n";

    snap.forEach(doc => {
      const data = doc.data();
      const materia = data.materiaNombre || data.materia;
      csv += `"${data.cedula}";"${data.nombres || ""}";"${data.apellidos || ""}";"${data.fecha}";"${materia}";${data.presente ? "Presente" : "Faltante"}";"${data.hora || ""}";"${data.profesor || ""}"\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");

    a.href = URL.createObjectURL(blob);
    a.download = "asistencias.csv";
    a.click();

    showMessage("Archivo exportado correctamente.", "success");

  } catch (error) {
    showMessage("No se pudo exportar: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// VALIDACIÓN EN TIEMPO REAL
// ===============================

document.addEventListener("DOMContentLoaded", () => {
  const numericFields = ["cedula", "cedulaAsignar", "manualCedula", "cedulaReporte"];

  numericFields.forEach(id => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", () => {
      el.value = el.value.replace(/\D/g, "");

      if (el.value.trim() === "") {
        clearFieldError(id);
      } else if (!validarCedula(el.value)) {
        showFieldError(id, "Solo números. Mínimo 4 dígitos.");
      } else {
        clearFieldError(id, true);
      }
    });
  });

  const nameFields = ["nombres", "apellidos"];

  nameFields.forEach(id => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", () => {
      if (el.value.trim() === "") {
        clearFieldError(id);
      } else if (!validarNombre(el.value)) {
        showFieldError(id, "Solo letras y espacios.");
      } else {
        clearFieldError(id, true);
      }
    });
  });

  const emailFields = ["email", "emailRol"];

  emailFields.forEach(id => {
    const el = $(id);
    if (!el) return;

    el.addEventListener("input", () => {
      if (el.value.trim() === "") {
        clearFieldError(id);
      } else if (!validarEmail(el.value)) {
        showFieldError(id, "Correo electrónico inválido.");
      } else {
        clearFieldError(id, true);
      }
    });
  });

  const passwordField = $("password");

  if (passwordField) {
    passwordField.addEventListener("input", () => {
      if (passwordField.value === "") {
        clearFieldError("password");
      } else if (!validarPassword(passwordField.value)) {
        showFieldError("password", "Mínimo 6 caracteres.");
      } else {
        clearFieldError("password", true);
      }
    });
  }

  const materiaField = $("materiaNombre");

  if (materiaField) {
    materiaField.addEventListener("input", () => {
      if (materiaField.value.trim() === "") {
        clearFieldError("materiaNombre");
      } else if (!validarMateria(materiaField.value)) {
        showFieldError("materiaNombre", "Usa letras, números, espacios o guion.");
      } else {
        clearFieldError("materiaNombre", true);
      }
    });
  }
});
