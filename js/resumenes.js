// ===============================
// RESÚMENES DIARIOS (para el dashboard)
// Un documento por materia y fecha: resumenes_dia/{materiaId_fecha}
// con los conteos de cada estado. Se recalculan completos (no con
// incrementos), así nunca se desincronizan por una doble escritura.
// ===============================

const ESTADOS_LISTA = ["presente", "tardanza", "justificado", "falta"];

function marcaServidorResumen() { return serverTs(); }

// Porcentaje y totales a partir de conteos
function resumenDeConteos(c) {
  const r = {
    presente: c.presente || 0,
    tardanza: c.tardanza || 0,
    justificado: c.justificado || 0,
    falta: c.falta || 0
  };
  r.total = r.presente + r.tardanza + r.justificado + r.falta;
  r.base = JUSTIFICADO_CUENTA_EN_CONTRA ? r.total : r.total - r.justificado;
  r.asistidas = r.presente + r.tardanza;
  r.porcentaje = r.base > 0 ? (r.asistidas / r.base) * 100 : null;
  return r;
}

// guardado = { email, nombre } de quien guarda (termina) la lista; opcional
function datosResumenDia(materiaId, fecha, c, marca, guardado) {
  const d = {
    materia: materiaId,
    fecha,
    presente: c.presente || 0,
    tardanza: c.tardanza || 0,
    justificado: c.justificado || 0,
    falta: c.falta || 0,
    actualizadoEn: marca
  };
  if (guardado && guardado.email) {
    d.guardadoPor = guardado.email;
    d.guardadoPorNombre = guardado.nombre || "";
  }
  return d;
}

// Nombre de quien guardó la lista (no el correo); los resúmenes antiguos no lo tienen
function nombreGuardador(resumen) {
  if (!resumen) return "";
  return (esNombreReal(resumen.guardadoPorNombre) ? resumen.guardadoPorNombre : "") ||
    nombreDeEmail(resumen.guardadoPor) || resumen.guardadoPor || "";
}

// Estado final del día = lo ya guardado + las operaciones que se van a escribir
function conteosDelDia(existentes, ops) {
  const estados = new Map();
  existentes.forEach((ex, ced) => estados.set(ced, estadoDe(ex.data)));
  ops.forEach(op => {
    const ced = op.tipo === "set" ? op.data.cedula : String(op.id).split("_")[0];
    estados.set(ced, op.data.estado);
  });
  const c = { presente: 0, tardanza: 0, justificado: 0, falta: 0 };
  estados.forEach(e => { c[e]++; });
  return c;
}

// Vuelve a contar un día concreto leyendo sus registros (tras corregir uno)
async function recalcularResumenDia(materiaId, fecha) {
  const snap = await db.collection("asistencias")
    .where("materia", "==", materiaId)
    .where("fecha", "==", fecha)
    .get();
  const c = { presente: 0, tardanza: 0, justificado: 0, falta: 0 };
  snap.forEach(d => { c[estadoDe(d.data())]++; });
  // merge: solo cambian los conteos; se conserva quién guardó la lista
  await db.collection("resumenes_dia").doc(`${materiaId}_${fecha}`)
    .set(datosResumenDia(materiaId, fecha, c, marcaServidorResumen()), { merge: true });
}

// Mapa "materia_fecha" -> nombre de quien guardó cada lista, para los registros dados
async function mapaGuardadores(registros) {
  const mapa = {};
  try {
    const materias = [...new Set(registros.map(r => r.materia).filter(Boolean))];
    if (materias.length === 0) return mapa;
    const desde = registros.reduce((m, r) => (r.fecha && r.fecha < m ? r.fecha : m), "9999-12-31");
    const docs = await consultarResumenes({ materiaIds: materias, desde });
    docs.forEach(d => { mapa[`${d.materia}_${d.fecha}`] = nombreGuardador(d); });
  } catch (e) { /* sin resúmenes: se usa el docente guardado en cada registro */ }
  return mapa;
}

function milisDe(t) {
  return t && typeof t.toMillis === "function" ? t.toMillis() : 0;
}

// Agrupa registros por materia y fecha -> lista de { id, data }.
// previos: resúmenes que ya existían (id -> datos); si tienen guardadoPor se conserva; si no,
// se deduce del registro modificado más recientemente de esa lista.
function construirResumenes(registros, marca, previos = {}) {
  const grupos = new Map();
  registros.forEach(x => {
    if (!x.materia || !x.fecha) return;
    const id = `${x.materia}_${x.fecha}`;
    if (!grupos.has(id)) grupos.set(id, { materia: x.materia, fecha: x.fecha, c: { presente: 0, tardanza: 0, justificado: 0, falta: 0 }, ultimo: null, ultimoMs: -1 });
    const g = grupos.get(id);
    g.c[estadoDe(x)]++;
    const ms = milisDe(x.actualizadoEn);
    if (x.profesor && ms > g.ultimoMs) { g.ultimo = x; g.ultimoMs = ms; }
  });
  return Array.from(grupos.entries()).map(([id, g]) => {
    const prev = previos[id];
    let guardado = null;
    if (prev && prev.guardadoPor) guardado = { email: prev.guardadoPor, nombre: prev.guardadoPorNombre || "" };
    else if (g.ultimo) guardado = { email: g.ultimo.profesor, nombre: esNombreReal(g.ultimo.profesorNombre) ? g.ultimo.profesorNombre : (nombreDeEmail(g.ultimo.profesor) || "") };
    return { id, data: datosResumenDia(g.materia, g.fecha, g.c, marca, guardado) };
  });
}

// Admin: reconstruye todos los resúmenes desde las asistencias (migración inicial o reparación)
async function recalcularTodosResumenes() {
  if (currentUserRole !== "admin") return showMessage("Solo admin.", "error");
  if (!confirm("Se leerán TODAS las asistencias para reconstruir los resúmenes del dashboard.\nPuede consumir bastantes lecturas si hay mucho historial. ¿Continuar?")) return;

  const btn = $("btnRecalcularResumenes");
  btn.disabled = true;
  try {
    try { await cargarUsuariosCache(); } catch (e) { /* sin nombres: se guardan los correos */ }
    const [asis, previos] = await Promise.all([
      db.collection("asistencias").get(),
      db.collection("resumenes_dia").get()
    ]);
    const registros = [];
    asis.forEach(d => registros.push(d.data()));

    const previosPorId = {};
    previos.forEach(d => { previosPorId[d.id] = d.data(); });
    const nuevos = construirResumenes(registros, marcaServidorResumen(), previosPorId);
    const idsNuevos = new Set(nuevos.map(n => n.id));
    const obsoletos = [];
    previos.forEach(d => { if (!idsNuevos.has(d.id)) obsoletos.push(d.id); });

    const ops = [
      ...nuevos.map(n => ({ tipo: "set", id: n.id, data: n.data })),
      ...obsoletos.map(id => ({ tipo: "delete", id }))
    ];
    for (let i = 0; i < ops.length; i += 400) {
      const batch = db.batch();
      ops.slice(i, i + 400).forEach(op => {
        const ref = db.collection("resumenes_dia").doc(op.id);
        if (op.tipo === "set") batch.set(ref, op.data);
        else batch.delete(ref);
      });
      await batch.commit();
    }
    showMessage(`Resúmenes reconstruidos: ${nuevos.length} día(s)/materia(s).`, "success");
  } catch (e) {
    showMessage("No se pudieron reconstruir los resúmenes: " + traducirErrorFirebase(e), "error");
  } finally {
    btn.disabled = false;
  }
}

// Lee los resúmenes del periodo. El docente solo consulta sus materias, una a una.
async function consultarResumenes({ materiaIds = null, desde = "" } = {}) {
  const esAdmin = currentUserRole === "admin";
  let ids = materiaIds;
  if (!esAdmin) {
    ids = (ids && ids.length ? ids : materiasLista.map(m => m.id)).filter(id => materiasMap[id]);
  }

  const consultas = [];
  if (ids === null) {
    let q = db.collection("resumenes_dia");
    if (desde) q = q.where("fecha", ">=", desde);
    consultas.push(q.get());
  } else {
    ids.forEach(id => consultas.push(db.collection("resumenes_dia").where("materia", "==", id).get()));
  }

  const snaps = await Promise.all(consultas);
  const docs = [];
  snaps.forEach(s => s.forEach(d => {
    const x = d.data();
    if (!desde || x.fecha >= desde) docs.push(x);
  }));
  return docs;
}

function sumarResumenes(docs) {
  const c = { presente: 0, tardanza: 0, justificado: 0, falta: 0 };
  docs.forEach(d => ESTADOS_LISTA.forEach(e => { c[e] += d[e] || 0; }));
  return c;
}
