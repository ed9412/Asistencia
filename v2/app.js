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

// Variables Temporales para Edición
let tempMateriasEstudiante = []; 
let resolvePassword = null; 

// ===============================
// UTILIDADES
// ===============================

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

async function mostrar(id) {
  // 1. Apagar la cámara si el usuario cambia de sección mientras estaba escaneando
  if (html5QrCode) {
    await detenerEscaner();
  }

  // 2. Ocultar todas las pantallas
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.remove("active");
  });

  // 3. Reiniciar todos los campos de texto, contraseñas, fechas y listas desplegables
  document.querySelectorAll(".screen input").forEach(input => {
    input.value = "";
    input.classList.remove("valid", "invalid"); // Quitar bordes verdes/rojos
  });

  document.querySelectorAll(".screen select").forEach(select => {
    select.selectedIndex = 0;
    select.classList.remove("valid", "invalid");
  });

  // 4. Limpiar todos los textos de error
  document.querySelectorAll(".field-error").forEach(error => {
    error.textContent = "";
    error.classList.remove("show");
  });

  // 5. Ocultar zonas dinámicas y vaciar listas de resultados
  const zonaLista = $("zonaLista");
  if (zonaLista) zonaLista.style.display = "none";
  
  limpiarLista("presentes");
  limpiarLista("faltantes");
  limpiarLista("historialLista");
  limpiarLista("alertas");

  if (id !== "reporte") {
    const reporte = $("reporte");
    if (reporte) reporte.innerHTML = "";
  }
  

  // 6. Limpiar la memoria temporal de la lista de asistencia
  presentesSet.clear();
  presentTimes.clear();
  estudiantesMateria = [];

  // 7. Mostrar la nueva pantalla solicitada
  const screen = $(id);
  if (screen) {
    screen.classList.add("active");
  }

  // 8. Cargar los datos por defecto según la sección elegida
  if (id === "estudiantes") {
    buscarEstudiantes(); // Al estar vacíos los filtros, cargará todos
  } else if (id === "materiasScreen") {
    listarMaterias();
  } else if (id === "dashboard") {
    cargarDashboard();
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

function validarRangoFechas() {
  clearFields(["filtroFechaInicio", "filtroFechaFin"]);
  
  const fechaInicio = $("filtroFechaInicio").value;
  const fechaFin = $("filtroFechaFin").value;

  // Si ambos campos están vacíos, permitimos la búsqueda (traerá todo el historial)
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

  // Validar que la fecha de inicio no sea mayor a la de fin
  if (fechaInicio && fechaFin) {
    if (new Date(fechaInicio) > new Date(fechaFin)) {
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
function validarPassword(value) { return value && value.length >= 6; }
function validarCedula(value) { return /^[0-9]+$/.test(value.trim()) && value.trim().length >= 4; }
function validarNombre(value) {
  const v = normalizarTexto(value);
  return /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]+$/.test(v) && v.length >= 2;
}
function validarMateria(value) {
  const v = normalizarTexto(value);
  return /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü0-9\s\-]+$/.test(v) && v.length >= 2;
}
function validarTextoGeneral(value, min = 2) { return normalizarTexto(value).length >= min; }

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
  markFieldValid("manualCedula"); return true;
}

function validarReporteCampos() {
  clearFieldError("cedulaReporte");
  if (!validarCedula($("cedulaReporte").value)) { showFieldError("cedulaReporte", "Ingresa cédula válida."); return false; }
  markFieldValid("cedulaReporte"); return true;
}

function validarAdminRolCampos() {
  let ok = true;
  clearFields(["uidRol", "emailRol", "rolNuevo"]);
  if (!validarTextoGeneral($("uidRol").value, 10)) { showFieldError("uidRol", "UID inválido."); ok = false; } else markFieldValid("uidRol");
  if (!validarEmail($("emailRol").value)) { showFieldError("emailRol", "Correo inválido."); ok = false; } else markFieldValid("emailRol");
  if (!["admin", "profesor"].includes($("rolNuevo").value)) { showFieldError("rolNuevo", "Selecciona rol."); ok = false; } else markFieldValid("rolNuevo");
  return ok;
}

function traducirErrorFirebase(error) {
  const code = error?.code || "";
  const errores = {
    "auth/invalid-email": "El correo electrónico no tiene un formato válido.",
    "auth/user-not-found": "No existe una cuenta con ese correo.",
    "auth/wrong-password": "La contraseña es incorrecta.",
    "auth/invalid-credential": "Correo o contraseña incorrectos.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese correo.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/network-request-failed": "No hay conexión con Firebase.",
    "permission-denied": "No tienes permisos para realizar esta acción."
  };
  return errores[code] || error?.message || "Ocurrió un error inesperado.";
}

// ===============================
// MANEJO DEL PASSWORD MODAL
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

// ===============================
// AUTH
// ===============================

async function login() {
  if (!validarLoginCampos()) return;
  try {
    await auth.signInWithEmailAndPassword($("email").value.trim(), $("password").value);
    // 🔹 Eliminado el "await initApp();" para evitar que se ejecute dos veces
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
    let userDoc = await db.collection("users").doc(user.uid).get();
    if (!userDoc.exists) {
      await db.collection("users").doc(user.uid).set({ email: user.email, role: "profesor", creadoEn: firebase.firestore.FieldValue.serverTimestamp() });
      userDoc = await db.collection("users").doc(user.uid).get();
    }
    currentUserRole = userDoc.data().role || "profesor";
    $("loginScreen").style.display = "none";
    $("app").style.display = "block";
    $("rolInfo").textContent = `${user.email} · Rol: ${currentUserRole}`;
    $("adminNavBtn").style.display = currentUserRole === "admin" ? "block" : "none";

    mostrar("dashboard");
    await cargarMaterias();
    await listarMaterias();
    await buscarEstudiantes();
  } catch (error) {
    showMessage("Error inicializando: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// MATERIAS
// ===============================

async function crearMateria() {
  if (currentUserRole !== "admin") return showMessage("Solo un admin puede crear materias.", "error");
  if (!validarMateriaCampos()) return;
  const nombre = normalizarTexto($("materiaNombre").value);

  try {
    const exist = await db.collection("materias").where("nombre", "==", nombre).get();
    if (!exist.empty) {
      showFieldError("materiaNombre", "Ya existe esta materia.");
      return showMessage("Ya existe una materia con ese nombre.", "error");
    }
    await db.collection("materias").add({ nombre, creadoEn: firebase.firestore.FieldValue.serverTimestamp(), creadoPor: auth.currentUser.email });
    showMessage("Materia creada.", "success");
    limpiarInput("materiaNombre");
    clearFieldError("materiaNombre");
    await cargarMaterias();
    await listarMaterias();
  } catch (error) {
    showMessage("Error: " + traducirErrorFirebase(error), "error");
  }
}

async function cargarMaterias() {
  try {
    const snap = await db.collection("materias").orderBy("nombre").get();
    
    // 🔹 Limpiamos los selects DESPUÉS de esperar la respuesta de la BD
    const selects = ["materiaLista", "materiaSelect", "searchEstudianteMateria", "editEstAddMateria"];
    selects.forEach(id => {
        const el = $(id);
        if(el) el.innerHTML = "";
    });
    
    $("searchEstudianteMateria").add(new Option("Todas las materias", "todas"));
    $("editEstAddMateria").add(new Option("Selecciona materia a añadir", ""));

    if (snap.empty) {
      $("materiaLista").add(new Option("Sin materias", ""));
      $("materiaSelect").add(new Option("Sin materias", ""));
      return;
    }
    
    $("materiaLista").add(new Option("Selecciona una materia", ""));
    $("materiaSelect").add(new Option("Selecciona una materia", ""));

    snap.forEach(doc => {
      const m = doc.data();
      $("materiaLista").add(new Option(m.nombre, doc.id));
      $("materiaSelect").add(new Option(m.nombre, doc.id));
      $("searchEstudianteMateria").add(new Option(m.nombre, doc.id));
      $("editEstAddMateria").add(new Option(m.nombre, doc.id));
    });
  } catch (e) {
    showMessage("Error cargando dropdowns: " + traducirErrorFirebase(e), "error");
  }
}

async function listarMaterias() {
  try {
    const snap = await db.collection("materias").orderBy("nombre").get();
    
    // 🔹 Limpiamos la lista justo antes de insertar los nuevos datos
    limpiarLista("listaMateriasUl");

    if (snap.empty) {
      $("listaMateriasUl").innerHTML = "<li>No hay materias registradas.</li>";
      return;
    }
    
    snap.forEach(doc => {
      const data = doc.data();
      const li = document.createElement("li");
      li.innerHTML = `<strong>${data.nombre}</strong><br>`;

      const btnEdit = document.createElement("button");
      btnEdit.className = "small"; btnEdit.textContent = "Editar";
      btnEdit.onclick = () => abrirEditarMateria(doc.id, data.nombre);

      const btnDel = document.createElement("button");
      btnDel.className = "small danger"; btnDel.textContent = "Eliminar";
      btnDel.onclick = () => eliminarMateria(doc.id);

      li.appendChild(btnEdit);
      li.appendChild(btnDel);
      $("listaMateriasUl").appendChild(li);
    });
  } catch (e) {}
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
  clearFieldError("editMatNombre");
  const id = $("editMatId").value;
  const nuevoNombre = normalizarTexto($("editMatNombre").value);
  
  if (!validarMateria(nuevoNombre)) {
    return showFieldError("editMatNombre", "Nombre inválido.");
  }
  
  try {
    const dupSnap = await db.collection("materias").where("nombre", "==", nuevoNombre).get();
    const isDup = !dupSnap.empty && dupSnap.docs[0].id !== id;
    if (isDup) {
      return showFieldError("editMatNombre", "Ya existe una materia con ese nombre.");
    }
    
    await db.collection("materias").doc(id).update({ nombre: nuevoNombre });
    showMessage("Materia actualizada.", "success");
    cerrarEditMateriaModal();
    cargarMaterias();
    listarMaterias();
    buscarEstudiantes(); // Actualizar nombres en listados
  } catch (e) {
    showMessage("Error actualizando: " + e.message, "error");
  }
}

async function eliminarMateria(id) {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede eliminar.", "error");
  
  const password = await pedirPassword();
  if (!password) return;

  try {
    await auth.signInWithEmailAndPassword(auth.currentUser.email, password);
    const batch = db.batch();
    batch.delete(db.collection("materias").doc(id));
    
    // Borrar relaciones
    const relSnap = await db.collection("materia_estudiante").where("materiaId", "==", id).get();
    relSnap.forEach(d => batch.delete(d.ref));
    
    await batch.commit();
    showMessage("Materia y relaciones eliminadas.", "success");
    cargarMaterias();
    listarMaterias();
    buscarEstudiantes();
  } catch (e) {
    showMessage("Contraseña incorrecta o error al eliminar.", "error");
  }
}

// ===============================
// ESTUDIANTES
// ===============================

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
    await ref.set({ cedula, nombres, apellidos, creadoEn: firebase.firestore.FieldValue.serverTimestamp() });
    showMessage("Estudiante creado.", "success");
    limpiarInput("cedula"); limpiarInput("nombres"); limpiarInput("apellidos");
    clearFields(["cedula", "nombres", "apellidos"]);
    buscarEstudiantes();
  } catch (e) {
    showMessage("Error: " + e.message, "error");
  }
}

async function buscarEstudiantes() {
  const texto = normalizarTexto($("searchEstudianteText").value).toLowerCase();
  const materiaId = $("searchEstudianteMateria").value;
  
  try {
    let estudiantesBase = [];
    const estSnap = await db.collection("estudiantes").get();
    estSnap.forEach(d => estudiantesBase.push(d.data()));
    
    let cedulasFiltradas = null;
    if (materiaId !== "todas") {
      const matSnap = await db.collection("materia_estudiante").where("materiaId", "==", materiaId).get();
      cedulasFiltradas = new Set();
      matSnap.forEach(d => cedulasFiltradas.add(d.data().cedula));
    }
    
    const matNombres = {};
    const matsDocSnap = await db.collection("materias").get();
    matsDocSnap.forEach(d => matNombres[d.id] = d.data().nombre);
    
    const matsMap = {};
    const todasMatsSnap = await db.collection("materia_estudiante").get();
    todasMatsSnap.forEach(d => {
       const cd = d.data().cedula;
       const mid = d.data().materiaId;
       if (!matsMap[cd]) matsMap[cd] = [];
       if (matNombres[mid]) matsMap[cd].push(matNombres[mid]);
    });
    
    // 🔹 Limpiamos la lista DESPUÉS de que todas las consultas a la BD terminaron
    limpiarLista("listaEstudiantes");
    
    let mostrados = new Set();
    
    estudiantesBase.sort((a,b)=> a.apellidos.localeCompare(b.apellidos)).forEach(est => {
       if (cedulasFiltradas && !cedulasFiltradas.has(est.cedula)) return;
       
       const fullName = `${est.nombres} ${est.apellidos}`.toLowerCase();
       const match = !texto || est.cedula.includes(texto) || fullName.includes(texto);
       
       if (match && !mostrados.has(est.cedula)) {
          mostrados.add(est.cedula);
          const matsStr = matsMap[est.cedula] && matsMap[est.cedula].length > 0 ? matsMap[est.cedula].join(", ") : "Ninguna";
          
          const li = document.createElement("li");
          li.innerHTML = `
            <strong>${est.cedula}</strong><br>
            ${est.nombres} ${est.apellidos}<br>
            <small style="color:#2563eb; font-weight:bold;">Materias: ${matsStr}</small><br>
          `;
          
          const btnQr = document.createElement("button"); btnQr.className = "small secondary"; btnQr.textContent = "QR"; btnQr.onclick = () => mostrarQR(est.cedula);
          const btnEd = document.createElement("button"); btnEd.className = "small"; btnEd.textContent = "Editar"; btnEd.onclick = () => abrirEditarEstudiante(est.cedula);
          const btnDe = document.createElement("button"); btnDe.className = "small danger"; btnDe.textContent = "Eliminar"; btnDe.onclick = () => eliminarEstudiante(est.cedula);
          
          li.appendChild(btnQr); li.appendChild(btnEd); li.appendChild(btnDe);
          $("listaEstudiantes").appendChild(li);
       }
    });
    
    if (mostrados.size === 0) {
      $("listaEstudiantes").innerHTML = "<li>No se encontraron estudiantes.</li>";
    }

  } catch (error) {
    showMessage("Error al buscar estudiantes: " + error.message, "error");
  }
}

// ===============================
// EDICIÓN / ELIMINACIÓN DE ESTUDIANTE
// ===============================

async function abrirEditarEstudiante(cedula) {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede editar.", "error");
  clearFields(["editEstNombres", "editEstApellidos"]);
  
  const doc = await db.collection("estudiantes").doc(cedula).get();
  if(!doc.exists) return showMessage("El estudiante no existe.", "error");
  
  const data = doc.data();
  $("editEstCedula").value = data.cedula;
  $("editEstNombres").value = data.nombres;
  $("editEstApellidos").value = data.apellidos;
  
  tempMateriasEstudiante = [];
  const snap = await db.collection("materia_estudiante").where("cedula", "==", cedula).get();
  snap.forEach(d => tempMateriasEstudiante.push(d.data().materiaId));
  
  actualizarUIEditMateriasEst();
  $("editStudentModal").style.display = "block";
}

function cerrarEditStudentModal() {
  $("editStudentModal").style.display = "none";
}

function actualizarUIEditMateriasEst() {
  $("editEstMateriasList").innerHTML = "";
  if (tempMateriasEstudiante.length === 0) {
    $("editEstMateriasList").innerHTML = "<li><small>Ninguna materia asignada.</small></li>";
    return;
  }
  
  tempMateriasEstudiante.forEach(matId => {
    // Buscar nombre en el dropdown para mostrar
    const opt = $("editEstAddMateria").querySelector(`option[value="${matId}"]`);
    const nombre = opt ? opt.textContent : "Materia Desconocida";
    
    const li = document.createElement("li");
    li.innerHTML = `<span>${nombre}</span> <button class="small danger" onclick="removerTempMateria('${matId}')">X</button>`;
    $("editEstMateriasList").appendChild(li);
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
  clearFields(["editEstNombres", "editEstApellidos"]);
  const cedula = $("editEstCedula").value;
  const nombres = normalizarTexto($("editEstNombres").value);
  const apellidos = normalizarTexto($("editEstApellidos").value);
  
  if (!validarNombre(nombres)) return showFieldError("editEstNombres", "Nombres inválidos.");
  if (!validarNombre(apellidos)) return showFieldError("editEstApellidos", "Apellidos inválidos.");
  
  try {
    await db.collection("estudiantes").doc(cedula).update({ nombres, apellidos });
    
    // Reconstruir relaciones (borrar viejas, crear nuevas)
    const batch = db.batch();
    const oldSnap = await db.collection("materia_estudiante").where("cedula", "==", cedula).get();
    oldSnap.forEach(d => batch.delete(d.ref));
    
    tempMateriasEstudiante.forEach(matId => {
      const newRef = db.collection("materia_estudiante").doc();
      batch.set(newRef, {
        cedula,
        materiaId: matId,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp(),
        creadoPor: auth.currentUser.email
      });
    });
    
    await batch.commit();
    showMessage("Estudiante actualizado exitosamente.", "success");
    cerrarEditStudentModal();
    buscarEstudiantes();
  } catch(e) {
    showMessage("Error al guardar: " + e.message, "error");
  }
}

async function eliminarEstudiante(cedula) {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede eliminar.", "error");
  
  const password = await pedirPassword();
  if (!password) return;

  try {
    await auth.signInWithEmailAndPassword(auth.currentUser.email, password);
    const batch = db.batch();
    batch.delete(db.collection("estudiantes").doc(cedula));
    
    const matSnap = await db.collection("materia_estudiante").where("cedula", "==", cedula).get();
    matSnap.forEach(d => batch.delete(d.ref));
    
    await batch.commit();
    showMessage("Estudiante eliminado.", "success");
    buscarEstudiantes();
  } catch (e) {
    showMessage("Contraseña incorrecta o error al eliminar.", "error");
  }
}

function mostrarQR(cedulaValue) {
  $("qrModal").style.display = "block";
  QRCode.toCanvas($("qrCanvas"), cedulaValue, error => {
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
    const dup = await db.collection("materia_estudiante").where("cedula", "==", ced).where("materiaId", "==", matId).get();
    if (!dup.empty) return showMessage("Ya asignado.", "error");
    await db.collection("materia_estudiante").add({ cedula: ced, materiaId: matId, creadoEn: firebase.firestore.FieldValue.serverTimestamp() });
    showMessage("Asignado correctamente.", "success");
    limpiarInput("cedulaAsignar"); clearFields(["cedulaAsignar", "materiaSelect"]);
    buscarEstudiantes();
  } catch (e) { showMessage("Error: " + e.message, "error"); }
}

// ===============================
// PASAR LISTA (Manteniendo Lógica Principal)
// ===============================

async function iniciarLista() {
  if (!validarInicioListaCampos()) return;
  const materiaId = $("materiaLista").value;
  try {
    presentesSet.clear(); presentTimes.clear();
    limpiarLista("presentes"); limpiarLista("faltantes");
    estudiantesMateria = [];
    const rel = await db.collection("materia_estudiante").where("materiaId", "==", materiaId).get();
    if (rel.empty) return showMessage("No hay estudiantes asignados.", "error");
    
    for (const r of rel.docs) {
      const ced = r.data().cedula;
      const doc = await db.collection("estudiantes").doc(ced).get();
      if (doc.exists) estudiantesMateria.push(doc.data());
    }
    if (estudiantesMateria.length === 0) return showMessage("No hay válidos.", "error");
    $("zonaLista").style.display = "block";
    actualizarPresentes(); actualizarFaltantes();
    showMessage("Lista iniciada.", "success");
  } catch (e) { showMessage("Error: " + e.message, "error"); }
}

async function iniciarEscaner() {
  if (!validarInicioListaCampos()) return;
  if (estudiantesMateria.length === 0) return showMessage("Inicia la lista.", "error");
  if (html5QrCode) return showMessage("Cámara activa.", "info");
  try {
    html5QrCode = new Html5Qrcode("reader");
    await html5QrCode.start({ facingMode: "environment" }, { fps: 10, qrbox: 250 },
      async code => {
        if (bloqueadoScan) return;
        bloqueadoScan = true;
        await registrarAsistencia(code.trim());
        setTimeout(() => { bloqueadoScan = false; }, 2000);
      });
    showMessage("Cámara iniciada.", "success");
  } catch (e) {
    html5QrCode = null; showMessage("Error cámara.", "error");
  }
}

async function detenerEscaner() {
  if (!html5QrCode) return;
  try { await html5QrCode.stop(); html5QrCode.clear(); html5QrCode = null; } catch (e) { html5QrCode = null; }
}

function registrarManual() {
  if (!validarManualCedula()) return;
  registrarAsistencia($("manualCedula").value.trim());
}

async function registrarAsistencia(ced) {
  clearFieldError("manualCedula");
  if (!validarCedula(ced)) { showFieldError("manualCedula", "Inválido."); return showMessage("Inválido.", "error"); }
  if (estudiantesMateria.length === 0) return showMessage("Inicia lista.", "error");
  const materiaId = $("materiaLista").value; const fecha = $("fechaLista").value;
  if (!estudiantesMateria.some(e => e.cedula === ced)) { showFieldError("manualCedula", "No pertenece."); return; }
  if (presentesSet.has(ced)) return showMessage("Ya presente.", "error");
  
  const key = `${ced}_${fecha}_${materiaId}`;
  try {
    const asis = await db.collection("asistencias").doc(key).get();
    if (asis.exists) return showMessage("Registro guardado.", "error");
    presentesSet.add(ced); presentTimes.set(ced, horaActual());
    beep();
    actualizarPresentes(); actualizarFaltantes();
    limpiarInput("manualCedula"); clearFieldError("manualCedula");
    showMessage("Temporal registrado.", "success");
  } catch (e) { showMessage("Error.", "error"); }
}

function beep() {
  const audio = new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg"); audio.play();
}

function actualizarPresentes() {
  limpiarLista("presentes");
  if (presentesSet.size === 0) return $("presentes").innerHTML = "<li>No hay presentes.</li>";
  presentesSet.forEach(ced => {
    const est = estudiantesMateria.find(e => e.cedula === ced);
    const li = document.createElement("li");
    li.innerHTML = `✅ <strong>${ced}</strong><br>${est ? est.nombres + " " + est.apellidos : ""}<br><small>Hora: ${presentTimes.get(ced) || ""}</small>`;
    $("presentes").appendChild(li);
  });
}

function actualizarFaltantes() {
  limpiarLista("faltantes");
  const faltantes = estudiantesMateria.filter(e => !presentesSet.has(e.cedula));
  if (faltantes.length === 0) return $("faltantes").innerHTML = "<li>No hay faltantes.</li>";
  faltantes.forEach(est => {
    const li = document.createElement("li");
    li.innerHTML = `❌ <strong>${est.cedula}</strong><br>${est.nombres} ${est.apellidos}`;
    const btn = document.createElement("button"); btn.className = "secondary"; btn.textContent = "Corregir"; btn.onclick = () => corregirTemporal(est.cedula);
    li.appendChild(btn); $("faltantes").appendChild(li);
  });
}

async function cerrarLista() {
  if (!validarInicioListaCampos()) return;
  const matId = $("materiaLista").value; const fecha = $("fechaLista").value;
  const matNom = $("materiaLista").options[$("materiaLista").selectedIndex].text;
  if (estudiantesMateria.length === 0) return showMessage("Inicia lista.", "error");
  try {
    for (const est of estudiantesMateria) {
      const key = `${est.cedula}_${fecha}_${matId}`;
      const pres = presentesSet.has(est.cedula);
      await db.collection("asistencias").doc(key).set({
        cedula: est.cedula, nombres: est.nombres, apellidos: est.apellidos,
        materia: matId, materiaNombre: matNom, fecha: fecha, presente: pres,
        hora: pres ? (presentTimes.get(est.cedula) || horaActual()) : null,
        profesor: auth.currentUser.email, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: false });
    }
    showMessage("Lista guardada.", "success");
    await detenerEscaner();
  } catch (e) { showMessage("Error.", "error"); }
}

async function corregirTemporal(cedula) {
  const password = await pedirPassword();
  if (!password) return showMessage("Corrección cancelada.", "info");
  try {
    await auth.signInWithEmailAndPassword(auth.currentUser.email, password);
    presentesSet.add(cedula); presentTimes.set(cedula, horaActual());
    actualizarPresentes(); actualizarFaltantes();
    showMessage("Corregido.", "success");
  } catch (e) { showMessage("Contraseña incorrecta.", "error"); }
}

async function corregirRegistroCerrado(docId, cedula) {
  const password = await pedirPassword();
  if (!password) return showMessage("Cancelado.", "info");
  try {
    await auth.signInWithEmailAndPassword(auth.currentUser.email, password);
    await db.collection("asistencias").doc(docId).update({ presente: true, hora: horaActual(), corregido: true, corregidoPor: auth.currentUser.email });
    showMessage("Corregido en historial.", "success");
    cargarHistorial();
  } catch (e) { showMessage("Error.", "error"); }
}

// ===============================
// REPORTES, ALERTAS, DASHBOARD Y ROLES
// (Resto de funcionalidades mantenidas intactas)
// ===============================

async function cargarHistorial() {
  if (!validarRangoFechas()) return;

  limpiarLista("historialLista");

  const fechaInicio = $("filtroFechaInicio").value;
  const fechaFin = $("filtroFechaFin").value;

  try {
    let query = db.collection("asistencias");

    // Si hay un rango de fechas, aplicamos los filtros
    if (fechaInicio && fechaFin) {
      query = query
        .where("fecha", ">=", fechaInicio)
        .where("fecha", "<=", fechaFin);
    }
    
    // Ordenar por fecha descendente (lo más nuevo arriba)
    query = query.orderBy("fecha", "desc");

    const snap = await query.get();

    if (snap.empty) {
      $("historialLista").innerHTML = "<li>No hay registros para mostrar en estas fechas.</li>";
      return;
    }

    snap.forEach(doc => {
      const d = doc.data(); 
      const mat = d.materiaNombre || d.materia;
      const li = document.createElement("li");
      
      li.innerHTML = `
        ${d.cedula}<br>
        <strong>${d.nombres || ""} ${d.apellidos || ""}</strong><br>
        <strong>Materia: ${mat}</strong><br>
        <strong>Fecha: ${d.fecha}</strong><br>
        Estado: ${d.presente ? "✅ Presente" : "❌ Faltante"}<br>
        Hora: ${d.hora || "Sin hora"}<br>
        Profesor: ${d.profesor || "No registrado"}
      `;
      
      if (!d.presente) {
        const b = document.createElement("button"); 
        b.className = "secondary"; 
        b.textContent = "Corregir registro"; 
        b.onclick = () => corregirRegistroCerrado(doc.id, d.cedula); 
        li.appendChild(b);
      }
      
      $("historialLista").appendChild(li);
    });

  } catch (error) {
    showMessage("No se pudo cargar el historial: " + traducirErrorFirebase(error), "error");
  }
}

// ===============================
// REPORTES ACTUALIZADO
// ===============================

async function generarReporte() {
  if (!validarReporteCampos()) return;
  const ced = $("cedulaReporte").value.trim();
  try {
    const estDoc = await db.collection("estudiantes").doc(ced).get();
    if (!estDoc.exists) return showFieldError("cedulaReporte", "Estudiante no existe.");
    
    const snap = await db.collection("asistencias").where("cedula", "==", ced).orderBy("fecha", "desc").get();
    
    if (snap.empty) return $("reporte").innerHTML = "<p>Sin registros.</p>";

    let tot = 0, pres = 0;
    let html = `<h3>Historial de ${estDoc.data().nombres} ${estDoc.data().apellidos}</h3>`;
    
    // Botón de exportar
    html += `<button class="secondary" onclick="exportarReporteIndividual('${ced}')">Exportar a CSV este reporte</button>`;
    html += `<ul>`;

    snap.forEach(d => {
      const x = d.data();
      tot++; if (x.presente) pres++;
      
      html += `<li>
        <strong>Fecha:</strong> ${x.fecha} | <strong>Materia:</strong> ${x.materiaNombre || x.materia}<br>
        <strong>Estado:</strong> ${x.presente ? "✅ Presente" : "❌ Faltante"}<br>
        <strong>Hora:</strong> ${x.hora || "N/A"}<br>
        <strong>Profesor:</strong> ${x.profesor || "N/A"}
      </li>`;
    });
    
    html += `</ul><p><strong>Porcentaje de asistencia:</strong> ${((pres / tot) * 100).toFixed(1)}%</p>`;
    $("reporte").innerHTML = html;
  } catch (e) {
    showMessage("Error al generar reporte: " + e.message, "error");
  }
}

async function exportarReporteIndividual(cedula) {
  try {
    const snap = await db.collection("asistencias").where("cedula", "==", cedula).get();
    if (snap.empty) return showMessage("Sin datos para exportar.", "error");

    let csvContent = "\uFEFFCedula;Nombres;Apellidos;Fecha;Materia;Presente;Hora;Profesor\n";
    
    snap.forEach(d => { 
      const x = d.data(); 
      const m = x.materiaNombre || x.materia; 
      csvContent += `"${x.cedula}";"${x.nombres}";"${x.apellidos}";"${x.fecha}";"${m}";"${x.presente ? "Presente" : "Faltante"}";"${x.hora || ""}";"${x.profesor || ""}"\n`; 
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); 
    a.href = url; 
    a.download = `reporte_asistencia_${cedula}.csv`; 
    a.click();
  } catch (e) {
    showMessage("Error al exportar: " + e.message, "error");
  }
}


async function generarAlertas() {
  limpiarLista("alertas");
  try {
    const ests = await db.collection("estudiantes").get();
    if (ests.empty) return $("alertas").innerHTML = "<li>Sin registros.</li>";
    let cant = 0;
    for (const est of ests.docs) {
      const c = est.id; const asis = await db.collection("asistencias").where("cedula", "==", c).get();
      let t = 0, p = 0; asis.forEach(d => { t++; if (d.data().presente) p++; });
      if (t > 0 && p / t < 0.7) {
        cant++; const li = document.createElement("li"); li.innerHTML = `⚠️ <strong>${c}</strong><br>${est.data().nombres}<br>Asis: ${((p / t) * 100).toFixed(1)}%`; $("alertas").appendChild(li);
      }
    }
    if (cant === 0) $("alertas").innerHTML = "<li>Sin alertas.</li>";
  } catch (e) {}
}

async function cargarDashboard() {
  try {
    const s = await db.collection("asistencias").get(); let p = 0, f = 0;
    s.forEach(d => { if (d.data().presente) p++; else f++; });
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart($("grafico"), { type: "pie", data: { labels: ["Presentes", "Faltantes"], datasets: [{ data: [p, f], backgroundColor: ["#16a34a", "#dc2626"] }] } });
    showMessage("Dashboard actualizado.", "success");
  } catch (e) {}
}

async function asignarRol() {
  if (currentUserRole !== "admin") return showMessage("Solo admin.", "error");
  if (!validarAdminRolCampos()) return;
  try {
    await db.collection("users").doc($("uidRol").value.trim()).set({ email: $("emailRol").value.trim(), role: $("rolNuevo").value, actualizadoEn: firebase.firestore.FieldValue.serverTimestamp() });
    showMessage("Rol guardado.", "success");
    limpiarInput("uidRol"); limpiarInput("emailRol"); clearFields(["uidRol", "emailRol", "rolNuevo"]);
  } catch (e) {}
}

async function exportar() {
  try {
    const s = await db.collection("asistencias").get();
    if (s.empty) return showMessage("Sin datos.", "error");
    let c = "\uFEFFCedula;Nombres;Apellidos;Fecha;Materia;Presente;Hora;Profesor\n";
    s.forEach(d => { const x = d.data(); const m = x.materiaNombre || x.materia; c += `"${x.cedula}";"${x.nombres}";"${x.apellidos}";"${x.fecha}";"${m}";"${x.presente ? "Presente" : "Faltante"}";"${x.hora || ""}";"${x.profesor || ""}"\n`; });
    const b = new Blob([c], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = "asistencias.csv"; a.click();
  } catch (e) {}
}

// Escuchadores de Validación
document.addEventListener("DOMContentLoaded", () => {
  ["cedula", "cedulaAsignar", "manualCedula", "cedulaReporte"].forEach(id => {
    if ($(id)) $(id).addEventListener("input", e => { e.target.value = e.target.value.replace(/\D/g, ""); });
  });
});
