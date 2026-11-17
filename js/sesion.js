
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
    if (!currentUserNombre) {
      showMessage(esAdmin
        ? "Tu perfil no tiene nombre. Escríbelo en Admin > Mi nombre para que aparezca en los reportes."
        : "Tu perfil no tiene nombre. Se te pedirá al guardar una lista para que aparezca en los reportes.", "info");
    }
  } catch (error) {
    showMessage("Error inicializando: " + traducirErrorFirebase(error), "error");
  }
}

