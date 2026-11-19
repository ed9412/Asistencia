
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