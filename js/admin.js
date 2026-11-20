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
  $("nuevoUsuarioPassword").value = pass;
  clearFieldError("nuevoUsuarioPassword");
}

async function crearUsuario() {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede crear usuarios.", "error");

  clearFields(["nuevoUsuarioNombre", "nuevoUsuarioEmail", "nuevoUsuarioPassword"]);
  const nombre = normalizarTexto($("nuevoUsuarioNombre").value);
  const email = $("nuevoUsuarioEmail").value.trim();
  const password = $("nuevoUsuarioPassword").value;
  const enviarCorreo = $("nuevoUsuarioCorreo").checked;
  const rol = $("nuevoUsuarioRol").value === "admin" ? "admin" : "profesor";

  let ok = true;
  if (!validarNombre(nombre)) { showFieldError("nuevoUsuarioNombre", "Solo letras y espacios."); ok = false; } else markFieldValid("nuevoUsuarioNombre");
  if (!validarEmail(email)) { showFieldError("nuevoUsuarioEmail", "Correo inválido."); ok = false; } else markFieldValid("nuevoUsuarioEmail");
  if (!validarPassword(password)) { showFieldError("nuevoUsuarioPassword", "Mínimo 6 caracteres (usa «Generar»)."); ok = false; } else markFieldValid("nuevoUsuarioPassword");
  if (!ok) return;

  const btn = $("btnCrearUsuario");
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
      return showFieldError("nuevoUsuarioEmail", "Ya existe una cuenta con ese correo (puede ser de un usuario eliminado). Búscala en la lista de usuarios; si no aparece, pídele que inicie sesión una vez y quedará como pendiente.");
    }
    return showMessage(traducirErrorFirebase(e), "error");
  }

  try {
    await db.collection("users").doc(uid).set({
      email,
      nombre,
      role: rol,
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
  limpiarInput("nuevoUsuarioNombre");
  limpiarInput("nuevoUsuarioEmail");
  limpiarInput("nuevoUsuarioPassword");
  clearFields(["nuevoUsuarioNombre", "nuevoUsuarioEmail", "nuevoUsuarioPassword"]);

  showMessage(
    (rol === "admin" ? "Administrador creado." : "Docente creado.") + (correoEnviado ? " Le enviamos un correo para elegir su contraseña." : "")
      + (rol === "admin" ? "" : " Asígnalo a sus materias en Materias > Docentes."),
    "success"
  );
  if (pantallaActual === "usuarioNuevo") volver();
  else cargarUsuarios();
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
  if ($("miNombre")) $("miNombre").value = currentUserNombre;
  const ul = $("listaUsuarios");
  ul.innerHTML = "<li class=\"vacio-lista\">Cargando…</li>";

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
      ul.innerHTML = "<li class=\"vacio-lista\">No hay usuarios registrados.</li>";
      return;
    }

    usuarios.forEach(u => {
      const li = document.createElement("li");
      li.className = "fila-est fila-lista";
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      const esYo = auth.currentUser && u.uid === auth.currentUser.uid;
      const nombre = u.nombre || u.email || u.uid;
      li.innerHTML = `<span class="avatar">${esc(iniciales(nombre, ""))}</span>
        <span class="fila-texto"><strong>${esc(nombre)}${esYo ? " (tú)" : ""}</strong>
        <small>${esc(u.email || "")}</small></span>
        <span class="chip ${claseRol(u.role)}">${esc(textoRol(u.role))}</span>${FLECHA_FILA}`;
      li.onclick = () => mostrar("usuarioDetalle", { param: u.uid });
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
// DETALLE DE USUARIO: nombre, rol y contraseña
// ===============================

let usuarioDetalleUid = "";

function claseRol(rol) {
  return rol === "admin" ? "chip-justif" : rol === "profesor" ? "chip-ok" : "chip-tarde";
}

async function pintarUsuarioDetalle(uid) {
  usuarioDetalleUid = uid || usuarioDetalleUid;
  if (!usuariosMap[usuarioDetalleUid]) {
    try { await cargarUsuariosCache(); } catch (e) { /* se muestra el error abajo */ }
  }
  const u = usuariosMap[usuarioDetalleUid];
  if (!u) {
    showMessage("No se encontró ese usuario.", "error");
    if (pantallaActual === "usuarioDetalle") volver();
    return;
  }
  const esYo = !!auth.currentUser && u.uid === auth.currentUser.uid;
  const nombre = u.nombre || u.email || u.uid;

  $("usuDetTitulo").textContent = esYo ? "Mi cuenta" : "Usuario";
  $("usuDetAvatar").textContent = iniciales(nombre, "");
  $("usuDetNombreTexto").textContent = nombre + (esYo ? " (tú)" : "");
  $("usuDetEmail").textContent = u.email || "";
  const chip = $("usuDetRolChip");
  chip.textContent = textoRol(u.role);
  chip.className = "chip " + claseRol(u.role);

  $("usuDetNombre").value = u.nombre || "";

  const select = $("usuDetRol");
  select.innerHTML = "";
  ROLES_VALIDOS.forEach(r => select.add(new Option(textoRol(r), r)));
  if (!ROLES_VALIDOS.includes(u.role)) select.add(new Option(textoRol(u.role), ""), 0);
  select.value = ROLES_VALIDOS.includes(u.role) ? u.role : "";
  select.disabled = esYo;
  $("btnUsuDetRol").style.display = esYo ? "none" : "";
  $("usuDetRolAviso").textContent = esYo ? "No puedes cambiar tu propio rol: otro administrador puede hacerlo." : "";

  $("usuDetEliminar").style.display = esYo ? "none" : "";
  $("usuDetEliminarYo").style.display = esYo ? "" : "none";
  $("usuDetOtro").style.display = !esYo && u.email ? "" : "none";
  $("usuDetYo").style.display = esYo ? "" : "none";
}

async function guardarNombreUsuario() {
  if (currentUserRole !== "admin") return showMessage("Solo admin.", "error");
  clearFieldError("usuDetNombre");
  const uid = usuarioDetalleUid;
  const nombre = normalizarTexto($("usuDetNombre").value);
  if (!validarNombre(nombre) || nombre.length > 80) {
    return showFieldError("usuDetNombre", "Solo letras y espacios (2 a 80 caracteres).");
  }
  const esYo = uid === auth.currentUser.uid;
  try {
    // Las reglas permiten a cada persona cambiar solo su nombre; el admin puede además marcar la fecha en los demás
    await db.collection("users").doc(uid).update(esYo ? { nombre } : { nombre, actualizadoEn: serverTs() });
    if (usuariosMap[uid]) usuariosMap[uid].nombre = nombre;
    if (esYo) currentUserNombre = nombre;
    showMessage("Nombre guardado.", "success");
    pintarUsuarioDetalle(uid);
  } catch (e) {
    showMessage("No se pudo guardar el nombre: " + traducirErrorFirebase(e), "error");
  }
}

async function guardarRolDetalle() {
  const uid = usuarioDetalleUid;
  const rol = $("usuDetRol").value;
  if (uid === auth.currentUser.uid) return showMessage("No puedes cambiar tu propio rol.", "error");
  await cambiarRolUsuario(uid, rol);
}

// Elimina el perfil de otra persona y la quita de sus materias (todo o nada).
// El admin no puede eliminarse a sí mismo; otro admin sí puede eliminarlo.
// La cuenta de acceso (Firebase Authentication) no se puede borrar desde la web: si esa persona
// vuelve a entrar, queda como «pendiente» y sin acceso a ningún dato.
async function eliminarUsuarioDetalle() {
  if (currentUserRole !== "admin") return showMessage("Solo admin puede eliminar usuarios.", "error");
  const uid = usuarioDetalleUid;
  if (!auth.currentUser || uid === auth.currentUser.uid) {
    return showMessage("No puedes eliminar tu propia cuenta. Otro administrador puede hacerlo.", "error");
  }
  const u = usuariosMap[uid];
  if (!u) return showMessage("No se encontró ese usuario.", "error");
  const nombre = u.nombre || u.email || uid;

  try {
    const snap = await db.collection("materias").where("profesores", "array-contains", uid).get();
    const materias = [];
    snap.forEach(d => materias.push(d));

    const detalle = [
      `¿Eliminar a ${nombre}${u.email ? " (" + u.email + ")" : ""}?`,
      u.role === "admin" ? "Es administrador." : "",
      `Se borra su perfil y se le quita de ${materias.length === 1 ? "1 materia" : materias.length + " materias"}. Ya no podrá usar el sistema.`,
      "Las asistencias que guardó se conservan."
    ].filter(Boolean).join("\n\n");
    if (!confirm(detalle)) return;

    const batch = db.batch();
    materias.forEach(d => {
      const resto = (d.data().profesores || []).filter(x => x !== uid);
      batch.update(d.ref, { profesores: resto });
    });
    batch.delete(db.collection("users").doc(uid));
    await batch.commit();

    delete usuariosMap[uid];
    showMessage(`${nombre} eliminado. Ya no tiene acceso al sistema.`, "success");
    if (pantallaActual === "usuarioDetalle") await volver();
    cargarUsuarios();
    try { await cargarMaterias(); } catch (e) { /* la lista de materias se actualiza al abrirla */ }
  } catch (e) {
    showMessage("No se pudo eliminar al usuario: " + traducirErrorFirebase(e), "error");
  }
}

async function enviarCorreoPasswordDetalle() {
  const u = usuariosMap[usuarioDetalleUid];
  if (u && u.email) await enviarCorreoPassword(u.email);
}

async function cambiarMiPassword() {
  ["miPasswordActual", "miPasswordNueva", "miPasswordRepetir"].forEach(clearFieldError);
  const actual = $("miPasswordActual").value;
  const nueva = $("miPasswordNueva").value;
  const repetida = $("miPasswordRepetir").value;

  let ok = true;
  if (!actual) { showFieldError("miPasswordActual", "Escribe tu contraseña actual."); ok = false; }
  if (!validarPassword(nueva)) { showFieldError("miPasswordNueva", "Mínimo 6 caracteres."); ok = false; }
  else if (nueva === actual) { showFieldError("miPasswordNueva", "Debe ser distinta de la actual."); ok = false; }
  if (nueva !== repetida) { showFieldError("miPasswordRepetir", "No coincide con la contraseña nueva."); ok = false; }
  if (!ok) return;

  try {
    await reautenticar(actual);
  } catch (e) {
    return showFieldError("miPasswordActual", "La contraseña actual es incorrecta.");
  }
  try {
    await auth.currentUser.updatePassword(nueva);
    ["miPasswordActual", "miPasswordNueva", "miPasswordRepetir"].forEach(limpiarInput);
    showMessage("Contraseña cambiada.", "success");
  } catch (e) {
    showMessage("No se pudo cambiar la contraseña: " + traducirErrorFirebase(e), "error");
  }
}
