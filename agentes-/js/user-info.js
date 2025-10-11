/**
 * Utilidades para obtener información del usuario actual
 */

/**
 * Obtiene la información del usuario desde el storage
 * @returns {Object|null} Información del usuario o null si no está autenticado
 */
function getCurrentUser() {
  try {
    // Intentar obtener desde sessionStorage primero (más seguro)
    let userStr = sessionStorage.getItem('user');
    
    // Si no está en sessionStorage, intentar localStorage
    if (!userStr) {
      userStr = localStorage.getItem('user');
    }
    
    if (!userStr) {
      console.warn('[USER INFO] No se encontró información de usuario en storage');
      return null;
    }
    
    const user = JSON.parse(userStr);
    return user;
  } catch (error) {
    console.error('[USER INFO] Error al obtener usuario:', error);
    return null;
  }
}

/**
 * Obtiene el rol del usuario actual
 * @returns {string} El rol del usuario o 'guest' si no está autenticado
 */
function getCurrentUserRole() {
  const user = getCurrentUser();
  return user?.role || 'guest';
}

/**
 * Obtiene el nombre de usuario actual
 * @returns {string} El nombre de usuario o 'Usuario' si no está autenticado
 */
function getCurrentUsername() {
  const user = getCurrentUser();
  return user?.username || user?.name || 'Usuario';
}

/**
 * Verifica si el usuario tiene un rol específico
 * @param {...string} roles - Los roles a verificar
 * @returns {boolean} True si el usuario tiene alguno de los roles especificados
 */
function hasRole(...roles) {
  const userRole = getCurrentUserRole();
  return roles.includes(userRole);
}

/**
 * Verifica si el usuario es administrador
 * @returns {boolean} True si es administrador
 */
function isAdmin() {
  return hasRole('Administrador', 'admin', 'administrador');
}

/**
 * Verifica si el usuario está autenticado
 * @returns {boolean} True si hay información de usuario en storage
 */
function isAuthenticated() {
  return getCurrentUser() !== null;
}

/**
 * Actualiza la información del usuario en el DOM
 */
function updateUserInfoInDOM() {
  const user = getCurrentUser();
  
  if (!user) {
    console.warn('[USER INFO] No hay usuario para actualizar en DOM');
    return;
  }
  
  // Actualizar nombre de usuario en elementos con clase 'user-name'
  const userNameElements = document.querySelectorAll('.user-name');
  userNameElements.forEach(el => {
    el.textContent = user.name || user.username || 'Usuario';
  });
  
  // Actualizar rol en elementos con clase 'user-role'
  const userRoleElements = document.querySelectorAll('.user-role');
  userRoleElements.forEach(el => {
    el.textContent = user.role || 'Usuario';
  });
  
  // Actualizar avatar con iniciales
  const avatarElements = document.querySelectorAll('.user-avatar');
  avatarElements.forEach(el => {
    const name = user.name || user.username || 'U';
    const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
    el.textContent = initials;
  });
  
  console.log('[USER INFO] Información de usuario actualizada en DOM');
}

// Exponer funciones globalmente
window.getCurrentUser = getCurrentUser;
window.getCurrentUserRole = getCurrentUserRole;
window.getCurrentUsername = getCurrentUsername;
window.hasRole = hasRole;
window.isAdmin = isAdmin;
window.isAuthenticated = isAuthenticated;
window.updateUserInfoInDOM = updateUserInfoInDOM;

// Actualizar info cuando el DOM esté listo
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateUserInfoInDOM);
} else {
  updateUserInfoInDOM();
}

console.log('[USER INFO] Inicializado correctamente');
