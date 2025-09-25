/**
 * Manejador de cierre de sesión para todas las páginas
 * Este script debe incluirse en todas las páginas que requieran funcionalidad de cierre de sesión
 */

// Función para configurar botones de logout
function configurarBotonesLogout() {
    console.log('[LOGOUT] Configurando botones de logout...');
    
    // Configurar botones con atributo data-logout-button
    const logoutButtons = document.querySelectorAll('[data-logout-button]');
    console.log('[LOGOUT] Botones con data-logout-button encontrados:', logoutButtons.length);
    
    logoutButtons.forEach((button, index) => {
        if (!button.hasAttribute('data-logout-configured')) {
            console.log(`[LOGOUT] Configurando botón ${index + 1}:`, button);
            button.addEventListener('click', function(e) {
                e.preventDefault();
                console.log('[LOGOUT] Botón clickeado, cerrando sesión...');
                cerrarSesion();
            });
            button.setAttribute('data-logout-configured', 'true');
        }
    });
    
    // También configurar por ID como fallback
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn && !logoutBtn.hasAttribute('data-logout-configured')) {
        console.log('[LOGOUT] Configurando botón por ID:', logoutBtn);
        logoutBtn.addEventListener('click', function(e) {
            e.preventDefault();
            console.log('[LOGOUT] Botón ID clickeado, cerrando sesión...');
            cerrarSesion();
        });
        logoutBtn.setAttribute('data-logout-configured', 'true');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    console.log('[LOGOUT] Inicializando logout handler...');
    configurarBotonesLogout();
    
    // Observar cambios en el DOM para elementos que se cargan dinámicamente
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                configurarBotonesLogout();
            }
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // Función para cerrar sesión
    async function cerrarSesion() {
        console.log('[LOGOUT] Iniciando proceso de cierre de sesión...');
        try {
            // Llamar al endpoint de logout del servidor para limpiar la cookie
            await fetch('/api/auth/logout', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });
        } catch (error) {
            console.warn('[LOGOUT] Error al llamar al endpoint de logout:', error);
        }
        
        // Eliminar tokens y datos de usuario de todos los almacenamientos
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
        
        // Limpiar todas las cookies manualmente (fallback)
        document.cookie.split(";").forEach(function(c) { 
            document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
        });
        
        // Redirigir a la página de login
        window.location.href = '/login.html';
    }

    // Hacer la función disponible globalmente
    window.cerrarSesion = cerrarSesion;
});
