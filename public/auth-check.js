// --- Protección de rutas: Redirecciona al login si no hay token JWT guardado ---
const API_URL =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : "https://connecting-klf7.onrender.com"; // Cambia esta URL por la de tu backend en producción

if (!localStorage.getItem('token')) {
  window.location.href = "login.html";
}

(async function(){
  try {
    const resp = await fetch(`${API_URL}/api/agente/info`, {
      headers: { 'Authorization': 'Bearer ' + localStorage.getItem('token') }
    });
    if (!resp.ok) throw new Error();
    const user = await resp.json();
    // Guarda el nombre y rol actualizados por si cambia en backend
    localStorage.setItem('nombre', user.nombre);
    localStorage.setItem('rol', user.rol);

    // --- Lógica para mostrar/ocultar elementos según rol ---
    if (user.rol === 'admin') {
      // Mostrar funciones exclusivas para admin
      document.querySelectorAll('.solo-admin').forEach(el => el.style.display = '');
    } else {
      // Ocultar funciones solo para admin
      document.querySelectorAll('.solo-admin').forEach(el => el.style.display = 'none');
    }
    // Si quieres mostrar funciones solo para agentes:
    if (user.rol === 'agente') {
      document.querySelectorAll('.solo-agente').forEach(el => el.style.display = '');
    } else {
      document.querySelectorAll('.solo-agente').forEach(el => el.style.display = 'none');
    }
    // Si quieres mostrar el nombre del usuario en el dashboard:
    if(document.getElementById('nombreUsuario')) {
      document.getElementById('nombreUsuario').textContent = user.nombre + (user.rol === 'admin' ? " (Admin)" : "");
    }
  } catch (e) {
    localStorage.clear();
    window.location.href = "login.html";
  }
})();