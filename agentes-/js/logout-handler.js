/**
 * Manejador de cierre de sesión
 */

async function logout() {
  try {
    console.log('[LOGOUT] Cerrando sesión...');
    
    // Llamar al endpoint de logout
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (response.ok && data.success) {
      console.log('[LOGOUT] Sesión cerrada correctamente');
    } else {
      console.warn('[LOGOUT] Error al cerrar sesión:', data.message);
    }
  } catch (error) {
    console.error('[LOGOUT] Error:', error);
  } finally {
    // Limpiar datos locales independientemente del resultado
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    sessionStorage.removeItem('user');
    sessionStorage.removeItem('token');
    
    console.log('[LOGOUT] Datos locales limpiados, redirigiendo a login');
    
    // Redirigir al login
    window.location.replace('/login.html?message=Sesión cerrada correctamente');
  }
}

// Exponer función globalmente
window.logout = logout;

console.log('[LOGOUT HANDLER] Inicializado correctamente');
