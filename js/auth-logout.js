/**
 * Manejador de cierre de sesión unificado
 * Este script debe ser incluido en todas las páginas que requieran funcionalidad de cierre de sesión
 */

// Función para cerrar sesión
function cerrarSesion(e) {
    if (e) e.preventDefault();
    
    console.log('Cerrando sesión...');
    
    // 1. Eliminar datos de autenticación
    localStorage.removeItem('token');
    sessionStorage.removeItem('token');
    localStorage.removeItem('userData');
    
    // 2. Redirigir a la página de inicio
    window.location.href = 'inicio.html';
}

// Función para configurar los botones de cierre de sesión
function setupLogoutButtons() {
    // Buscar botones de cierre de sesión
    const logoutButtons = document.querySelectorAll('#logoutBtn, [id^=logout-], [id$=-logout], .logout-button, [data-logout-button]');
    
    if (logoutButtons.length > 0) {
        console.log('Configurando botones de cierre de sesión:', logoutButtons.length);
        logoutButtons.forEach(button => {
            // Remover listeners antiguos para evitar duplicados
            button.removeEventListener('click', cerrarSesion);
            // Agregar nuevo listener
            button.addEventListener('click', cerrarSesion);
            // Asegurar que el cursor sea un puntero
            button.style.cursor = 'pointer';
        });
    }
}

// Configurar botones cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
    // Configurar botones iniciales
    setupLogoutButtons();
    
    // Configurar un MutationObserver para detectar cambios en el DOM
    const observer = new MutationObserver(function(mutations) {
        let shouldCheck = false;
        
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes.length > 0) {
                shouldCheck = true;
            }
        });
        
        if (shouldCheck) {
            setupLogoutButtons();
        }
    });
    
    // Empezar a observar el documento con los parámetros configurados
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    // También exponer la función globalmente por si se necesita llamar desde otros scripts
    window.cerrarSesion = cerrarSesion;
});
