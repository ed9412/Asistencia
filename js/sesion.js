
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

async function logout(motivo = "") {
  try {
    await detenerEscaner();
    try {
      localStorage.removeItem(CLAVE_ACTIVIDAD);
      if (motivo) sessionStorage.setItem(CLAVE_MOTIVO_SALIDA, motivo);
    } catch (e) { /* sin almacenamiento */ }
    await auth.signOut();
    // En equipos compartidos no debe quedar información de estudiantes guardada en el navegador
    try {
      if (typeof db.terminate === "function" && typeof db.clearPersistence === "function") {
        await db.terminate();
        await db.clearPersistence();
      }
    } catch (e) { /* si no se puede borrar ahora, se intentará en el siguiente cierre de sesión */ }
    location.reload();
  } catch (error) {
    showMessage("Error al salir: " + traducirErrorFirebase(error), "error");
  }
}


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
    currentUserNombre = snap.data().nombre || "";

    $("loginScreen").style.display = "none";
    $("app").style.display = "block";
    $("rolInfo").textContent = `${user.email} · Rol: ${textoRol(currentUserRole)}`;

    const navs = document.querySelectorAll(".navbar");

    if (!ROLES_STAFF.includes(currentUserRole)) {
      navs.forEach(n => { n.style.display = "none"; });
      await mostrar("pendienteScreen");
      return;
    }

    navs.forEach(n => { n.style.display = ""; });
    const esAdmin = currentUserRole === "admin";
    document.querySelectorAll(".solo-admin").forEach(b => { b.style.display = esAdmin ? "" : "none"; });
    document.querySelectorAll(".texto-estudiantes").forEach(t => { t.textContent = esAdmin ? "Estudiantes" : "Mis estudiantes"; });
    if ($("fabNuevoEst")) $("fabNuevoEst").dataset.admin = esAdmin ? "1" : "";
    $("estudiantesTitulo").textContent = esAdmin ? "👨‍🎓 Estudiantes" : "👨‍🎓 Mis estudiantes";
    $("formNuevoEstudiante").style.display = esAdmin ? "block" : "none";

    establecerFechaActualPorDefecto();
    const inicio = rutaInicial();
    await mostrar(inicio.id, { param: inicio.param, reemplazar: true });
    await cargarMaterias();
    if (typeof alCargarMaterias === "function") alCargarMaterias();
    if (!esAdmin && materiasLista.length === 0) {
      showMessage("Todavía no tienes materias asignadas. Pide a un administrador que te asigne.", "info");
    }
    await ofrecerRestaurarBorrador();
    if (!currentUserNombre) {
      showMessage(esAdmin
        ? "Tu perfil no tiene nombre. Escríbelo en Admin > Mi nombre para que aparezca en los reportes."
        : "Tu perfil no tiene nombre. Se te pedirá al guardar una lista para que aparezca en los reportes.", "info");
    }
  } catch (error) {
    showMessage("Error inicializando: " + traducirErrorFirebase(error), "error");
  }
}



// ===============================
// CIERRE DE SESIÓN POR INACTIVIDAD
// Si nadie toca la app durante INACTIVIDAD_MS, se cierra la sesión. La última actividad se guarda
// en el navegador, así que también se aplica al recargar o volver días después (y se comparte
// entre pestañas: usar una mantiene viva la otra). Con la cámara escaneando cuenta como actividad.
// ===============================

const INACTIVIDAD_MS = 30 * 60 * 1000;   // 30 minutos
const AVISO_INACTIVIDAD_MS = 60 * 1000;  // aviso 1 minuto antes
const CLAVE_ACTIVIDAD = "asistencia_ultima_actividad";
const CLAVE_MOTIVO_SALIDA = "asistencia_motivo_salida";
let inactividadTimer = null;
let ultimaEscrituraActividad = 0;
let avisoInactividadMostrado = false;

function leerUltimaActividad() {
  try { return Number(localStorage.getItem(CLAVE_ACTIVIDAD)) || 0; } catch (e) { return 0; }
}

function marcarActividad() {
  const ahora = Date.now();
  avisoInactividadMostrado = false;
  if (ahora - ultimaEscrituraActividad < 15000) return;   // no escribir en cada movimiento
  ultimaEscrituraActividad = ahora;
  try { localStorage.setItem(CLAVE_ACTIVIDAD, String(ahora)); } catch (e) { /* sin almacenamiento */ }
}

// ¿La sesión guardada lleva demasiado tiempo sin usarse? (se mira al abrir/recargar la página)
function sesionCaducada() {
  const ultima = leerUltimaActividad();
  return ultima > 0 && Date.now() - ultima > INACTIVIDAD_MS;
}

function revisarInactividad() {
  if (!auth.currentUser) return;
  if (typeof html5QrCode !== "undefined" && html5QrCode) { marcarActividad(); return; }
  const inactivo = Date.now() - Math.max(leerUltimaActividad(), ultimaEscrituraActividad);
  if (inactivo >= INACTIVIDAD_MS) {
    logout("Tu sesión se cerró tras 30 minutos sin actividad. Vuelve a entrar.");
  } else if (inactivo >= INACTIVIDAD_MS - AVISO_INACTIVIDAD_MS && !avisoInactividadMostrado) {
    avisoInactividadMostrado = true;
    showMessage("Por inactividad, la sesión se cerrará en 1 minuto. Toca la pantalla para seguir.", "info");
  }
}

function iniciarControlInactividad() {
  ultimaEscrituraActividad = 0;
  marcarActividad();
  if (inactividadTimer) return;
  ["pointerdown", "keydown", "touchstart", "wheel"].forEach(ev =>
    document.addEventListener(ev, marcarActividad, { passive: true, capture: true }));
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") revisarInactividad(); });
  inactividadTimer = setInterval(revisarInactividad, 20000);
}

// Muestra en el login por qué se cerró la sesión (si fue automático)
function mostrarMotivoSalida() {
  try {
    const motivo = sessionStorage.getItem(CLAVE_MOTIVO_SALIDA);
    if (motivo) {
      sessionStorage.removeItem(CLAVE_MOTIVO_SALIDA);
      setLoginError(motivo);
    }
  } catch (e) { /* sin almacenamiento */ }
}
