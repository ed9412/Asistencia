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
      chartInstance.options.color = colorTextoGrafico();
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
