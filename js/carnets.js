// ===============================
// CARNETS QR EN LOTE (PDF con varios carnets por hoja A4)
// ===============================

const CARNET_W = 90, CARNET_H = 65, CARNET_COLS = 2, CARNET_FILAS = 4;
const CARNETS_POR_HOJA = CARNET_COLS * CARNET_FILAS;

// Posición (en mm) del carnet número i dentro de su hoja
function posicionCarnet(i) {
  const k = i % CARNETS_POR_HOJA;
  const col = k % CARNET_COLS;
  const fila = Math.floor(k / CARNET_COLS);
  return { pagina: Math.floor(i / CARNETS_POR_HOJA), x: 10 + col * (CARNET_W + 10), y: 12 + fila * (CARNET_H + 5) };
}

// Estudiantes de una materia, ordenados por apellido (usa la caché ya cargada)
function estudiantesDeMateria(materiaId) {
  const cedulas = new Set(cacheEst.relaciones.filter(r => r.materiaId === materiaId).map(r => r.cedula));
  return cacheEst.estudiantes
    .filter(e => cedulas.has(e.cedula))
    .sort((a, b) => (a.apellidos || "").localeCompare(b.apellidos || "") || (a.nombres || "").localeCompare(b.nombres || ""));
}

async function descargarCarnetsMateria() {
  const materiaId = $("searchEstudianteMateria").value;
  if (!materiaId || materiaId === "todas") {
    return showMessage("Elige una materia en el filtro para generar sus carnets.", "error");
  }
  if (!materiasMap[materiaId]) return showMessage("No tienes acceso a esa materia.", "error");
  try {
    await Promise.all([cargarLibreria("qr"), cargarLibreria("pdf")]);
  } catch (e) {
    return showMessage(TEXTO_ERROR_LIBRERIA, "error");
  }

  const btn = $("btnCarnetsLote");
  btn.disabled = true;

  try {
    await cargarCacheEstudiantes();
    const lista = estudiantesDeMateria(materiaId);
    if (lista.length === 0) return showMessage("Esa materia no tiene estudiantes asignados.", "error");

    showMessage(`Generando ${lista.length} carnet(s)...`, "info");

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF("portrait", "mm", "a4");
    const materia = materiasMap[materiaId];

    for (let i = 0; i < lista.length; i++) {
      const est = lista[i];
      const { x, y } = posicionCarnet(i);
      if (i > 0 && i % CARNETS_POR_HOJA === 0) pdf.addPage();

      const qr = await QRCode.toDataURL(est.cedula, { width: 300, margin: 1 });

      pdf.setDrawColor(180);
      pdf.roundedRect(x, y, CARNET_W, CARNET_H, 3, 3);

      pdf.setTextColor(37, 99, 235);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(11);
      pdf.text("Carnet Estudiantil", x + 5, y + 8);

      pdf.setTextColor(17, 24, 39);
      pdf.setFontSize(12);
      const nombre = pdf.splitTextToSize(`${est.nombres} ${est.apellidos}`, 38);
      pdf.text(nombre.slice(0, 4), x + 5, y + 20);

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(107, 114, 128);
      pdf.text(`Cédula: ${est.cedula}`, x + 5, y + CARNET_H - 14);

      pdf.addImage(qr, "PNG", x + 43, y + 12, 42, 42);
    }

    const seguro = materia.replace(/[^A-Za-z0-9ÁÉÍÓÚáéíóúÑñ]+/g, "_");
    pdf.save(`Carnets_${seguro}.pdf`);
    showMessage(`PDF generado con ${lista.length} carnet(s).`, "success");
  } catch (e) {
    showMessage("No se pudo generar el PDF: " + traducirErrorFirebase(e), "error");
  } finally {
    btn.disabled = false;
  }
}
