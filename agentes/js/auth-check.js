/**
 * Script de verificación de autenticación
 * Verifica si el usuario está autenticado antes de cargar páginas protegidas
 */

(async function() {
  // No ejecutar en páginas públicas
  const publicPages = ['/login.html', '/register.html', '/reset-password.html'];
  const currentPath = window.location.pathname;
  
  if (publicPages.some(page => currentPath.endsWith(page))) {
    console.log('[AUTH] Página pública, no se requiere autenticación');
    return;
  }

  try {
    // Primero verificar si hay token en storage local
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    
    // Preparar headers
    const headers = {
      'Accept': 'application/json'
    };
    
    // Si hay token en storage, incluirlo en el header Authorization
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      console.log('[AUTH] Token encontrado en storage, enviando en Authorization header');
    }
    
    // Verificar autenticación con el servidor
    const response = await fetch('/api/auth/verify-server', {
      method: 'GET',
      credentials: 'include', // Importante: incluir cookies en la solicitud
      headers: headers
    });

    const data = await response.json();
    
    console.log('[AUTH] Respuesta del servidor:', data);
    console.log('[AUTH] authenticated:', data.authenticated);
    console.log('[AUTH] success:', data.success);

    // IMPORTANTE: Verificar que el usuario esté autenticado
    if (!data.authenticated) {
      console.log('[AUTH] Usuario no autenticado (authenticated=false), redirigiendo a login');
      
      // Verificar si hay datos de usuario válidos en storage antes de redirigir
      const savedUser = localStorage.getItem('user') || sessionStorage.getItem('user');
      if (savedUser) {
        try {
          const user = JSON.parse(savedUser);
          const role = String(user?.role || user?.rol || '').toLowerCase();
          const allowedRoles = ['admin','backoffice','b:o','b.o','b-o','bo'];
          
          if (user && allowedRoles.includes(role)) {
            console.log('[AUTH] Usuario con rol permitido encontrado en storage, permitiendo acceso');
            return; // No redirigir
          }
        } catch (e) {
          console.warn('[AUTH] Error parseando usuario guardado:', e);
        }
      }
      
      // Limpiar cualquier dato de sesión antiguo
      localStorage.removeItem('user');
      localStorage.removeItem('token');
      sessionStorage.removeItem('user');
      sessionStorage.removeItem('token');
      
      // Redirigir al login con la página actual como redirect
      const currentUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?redirect=${currentUrl}`);
      return;
    }

    // Usuario autenticado correctamente
    console.log('[AUTH] Usuario autenticado:', data.user?.username);

    // Guardar información del usuario en storage para uso en la aplicación
    const userInfo = {
      id: data.user.id,
      username: data.user.username,
      role: data.user.role,
      team: data.user.team,
      supervisor: data.user.supervisor,
      name: data.user.name || data.user.username,
      permissions: data.user.permissions || []
    };

    // Guardar en sessionStorage (más seguro que localStorage)
    sessionStorage.setItem('user', JSON.stringify(userInfo));

    // También verificar si hay preferencia de "recordar sesión" en localStorage
    const rememberUser = localStorage.getItem('user');
    if (rememberUser) {
      // Actualizar la información en localStorage también
      localStorage.setItem('user', JSON.stringify(userInfo));
    }

  } catch (error) {
    console.error('[AUTH] Error verificando autenticación:', error);
    
    // En caso de error de red, intentar verificar si hay datos de usuario guardados
    const savedUser = localStorage.getItem('user') || sessionStorage.getItem('user');
    
    if (!savedUser) {
      // No hay información guardada, redirigir al login
      console.log('[AUTH] Error de autenticación y sin datos guardados, redirigiendo');
      const currentUrl = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.replace(`/login.html?redirect=${currentUrl}`);
    } else {
      // Verificar rol antes de permitir acceso temporal
      try {
        const user = JSON.parse(savedUser);
        const role = String(user?.role || user?.rol || '').toLowerCase();
        const allowedRoles = ['admin','backoffice','b:o','b.o','b-o','bo'];
        
        if (user && allowedRoles.includes(role)) {
          console.warn('[AUTH] Error verificando con servidor, pero usuario con rol permitido - permitiendo acceso temporal'); 
        } else {
          console.log('[AUTH] Usuario sin rol permitido, redirigiendo a login');
          const currentUrl = encodeURIComponent(window.location.pathname + window.location.search);
          window.location.replace(`/login.html?redirect=${currentUrl}`);
        }
      } catch (e) {
        console.log('[AUTH] Error parseando datos guardados, redirigiendo');
        const currentUrl = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.replace(`/login.html?redirect=${currentUrl}`);
      }
    }
  }
})();
