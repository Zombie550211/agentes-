// --- Configuración de usuario por defecto (sin autenticación) ---
const API_URL =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3003"
    : "https://connecting-klf7.onrender.com"; // Cambia esta URL por la de tu backend en producción

// Establecer valores por defecto si no existen
if (!localStorage.getItem('nombre')) {
  localStorage.setItem('nombre', 'Usuario');
  localStorage.setItem('rol', 'agente');
}

// Mostrar nombre de usuario si el elemento existe
if(document.getElementById('nombreUsuario')) {
  document.getElementById('nombreUsuario').textContent = localStorage.getItem('nombre');
}

// Mostrar/ocultar elementos según rol (opcional)
const rol = localStorage.getItem('rol') || 'agente';
document.querySelectorAll('.solo-admin').forEach(el => el.style.display = 'none');
document.querySelectorAll('.solo-agente').forEach(el => el.style.display = '');