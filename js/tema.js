// ===============================
// TEMA CLARO / OSCURO
// Se carga en el <head> para aplicar el tema antes de pintar la página (sin parpadeo).
// ===============================

const TEMA_CLAVE = "asistencia_tema";
let temaVigente = "light";

function temaGuardado() {
  try { return localStorage.getItem(TEMA_CLAVE); } catch (e) { return null; }
}

function temaInicial() {
  const t = temaGuardado();
  if (t === "dark" || t === "light") return t;
  try {
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch (e) {
    return "light";
  }
}

function colorTextoGrafico() {
  return temaVigente === "dark" ? "#e5e7eb" : "#374151";
}

// Colores del gráfico: los mismos que las chips de asistencia (variables --presente, --tardanza…)
const COLORES_GRAFICO_BASE = { presente: "#1a7f4b", tardanza: "#a16207", justificado: "#4f46b8", falta: "#b42318", card: "#ffffff" };

function variableCss(nombre, defecto) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    return v || defecto;
  } catch (e) { return defecto; }
}

function fuenteGrafico() {
  try { return getComputedStyle(document.body).fontFamily || "sans-serif"; } catch (e) { return "sans-serif"; }
}

function coloresGrafico() {
  const b = COLORES_GRAFICO_BASE;
  return {
    estados: [
      variableCss("--presente", b.presente), variableCss("--tardanza", b.tardanza),
      variableCss("--justificado", b.justificado), variableCss("--falta", b.falta)
    ],
    borde: variableCss("--card", b.card),
    texto: colorTextoGrafico()
  };
}

function aplicarTema(t) {
  temaVigente = t === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-tema", temaVigente);

  const btn = document.getElementById("btnTema");
  if (btn) {
    btn.textContent = temaVigente === "dark" ? "☀️" : "🌙";
    btn.title = temaVigente === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
  }

  // Si el gráfico ya está dibujado, adaptar el color de sus textos
  try {
    if (typeof chartInstance !== "undefined" && chartInstance) {
      const c = coloresGrafico();
      chartInstance.options.color = c.texto;
      chartInstance.data.datasets[0].backgroundColor = c.estados;
      chartInstance.data.datasets[0].borderColor = c.borde;
      chartInstance.update();
    }
  } catch (e) { /* el gráfico se redibuja al abrir el dashboard */ }
}

function alternarTema() {
  const nuevo = temaVigente === "dark" ? "light" : "dark";
  try { localStorage.setItem(TEMA_CLAVE, nuevo); } catch (e) { /* sin almacenamiento: solo esta sesión */ }
  aplicarTema(nuevo);
}

aplicarTema(temaInicial());
