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

async function guardarMiNombre() {
  clearFieldError("miNombre");
  const nombre = normalizarTexto($("miNombre").value);
  if (!validarNombre(nombre) || nombre.length > 80) {
    return showFieldError("miNombre", "Solo letras y espacios (2 a 80 caracteres).");
  }
  try {
    await db.collection("users").doc(auth.currentUser.uid).update({ nombre });
    currentUserNombre = nombre;
    if (usuariosMap[auth.currentUser.uid]) usuariosMap[auth.currentUser.uid].nombre = nombre;
    showMessage("Nombre guardado.", "success");
    cargarUsuarios();
  } catch (e) {
    showMessage("No se pudo guardar el nombre: " + traducirErrorFirebase(e), "error");
  }
}

async function cargarUsuarios() {
  if (currentUserRole !== "admin") return;
  $("miNombre").value = currentUserNombre;
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

