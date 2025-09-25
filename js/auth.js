// auth.js - Utilidades de autenticación y autorización

/**
 * Obtiene la información del usuario actual desde localStorage
 * @returns {Object|null} Objeto con la información del usuario o null si no está autenticado
 */
function getCurrentUser() {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    
    try {
        return JSON.parse(userStr);
    } catch (error) {
        console.error('Error al analizar los datos del usuario:', error);
        return null;
    }
}

/**
 * Verifica si el usuario actual tiene un rol específico
 * @param {string} role - Rol a verificar (admin, supervisor, agent)
 * @returns {boolean} true si el usuario tiene el rol, false en caso contrario
 */
function hasRole(role) {
    const user = getCurrentUser();
    return user && user.role === role;
}

/**
 * Verifica si el usuario actual tiene un permiso específico
 * @param {string} permission - Nombre del permiso a verificar
 * @returns {boolean} true si el usuario tiene el permiso, false en caso contrario
 */
function hasPermission(permission) {
    const user = getCurrentUser();
    return user && user.permissions && user.permissions[permission] === true;
}

/**
 * Verifica si el usuario está autenticado
 * @returns {boolean} true si el usuario está autenticado, false en caso contrario
 */
function isAuthenticated() {
    return localStorage.getItem('token') !== null && getCurrentUser() !== null;
}

/**
 * Cierra la sesión del usuario actual
 */
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

/**
 * Protege una ruta redirigiendo al login si el usuario no está autenticado
 */
function protectRoute() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
    }
}

/**
 * Actualiza la UI según el rol del usuario
 * Debe ser llamado en cada página después de cargar el DOM
 */
function updateUIForUserRole() {
    const user = getCurrentUser();
    if (!user) return;

    // Actualizar el nombre del usuario en la barra lateral si existe el elemento
    const userNameElement = document.getElementById('user-name');
    if (userNameElement) {
        userNameElement.textContent = user.name;
    }

    // Actualizar el rol del usuario si existe el elemento
    const userRoleElement = document.getElementById('user-role');
    if (userRoleElement) {
        const roleNames = {
            'admin': 'Administrador',
            'supervisor': 'Supervisor',
            'agent': 'Agente'
        };
        userRoleElement.textContent = roleNames[user.role] || user.role;
    }

    // Mostrar/ocultar elementos según los permisos
    const adminOnlyElements = document.querySelectorAll('.admin-only');
    const supervisorOnlyElements = document.querySelectorAll('.supervisor-only');
    const agentOnlyElements = document.querySelectorAll('.agent-only');

    adminOnlyElements.forEach(el => {
        el.style.display = user.role === 'admin' ? 'block' : 'none';
    });

    supervisorOnlyElements.forEach(el => {
        el.style.display = (user.role === 'admin' || user.role === 'supervisor') ? 'block' : 'none';
    });

    agentOnlyElements.forEach(el => {
        // Los agentes solo ven sus propios elementos, los supervisores y admin también pueden verlos
        el.style.display = (user.role === 'admin' || user.role === 'supervisor' || user.role === 'agent') ? 'block' : 'none';
    });
}

// Exportar funciones para su uso en otros archivos
window.auth = {
    getCurrentUser,
    hasRole,
    hasPermission,
    isAuthenticated,
    logout,
    protectRoute,
    updateUIForUserRole
};

// Proteger rutas automáticamente (excepto login.html y register.html)
if (!window.location.pathname.includes('login.html') && 
    !window.location.pathname.includes('register.html')) {
    protectRoute();
}
