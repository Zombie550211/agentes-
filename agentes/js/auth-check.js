/**
 * Verificación de autenticación para rutas protegidas
 * Soporta autenticación por token JWT y cookies HttpOnly
 */
(async function checkAuth() {
  // No verificar autenticación en la página de login
  if (window.location.pathname.endsWith('login.html')) {
    return;
  }

  console.log('[AUTH] Verificando autenticación...');
  
  try {
    // 1. Verificar si hay un token en localStorage o sessionStorage
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    
    // 2. Intentar autenticación con el token si existe
    if (token) {
      console.log('[AUTH] Token encontrado, verificando validez...');
      
      try {
        // Limpiar el token de posibles comillas o espacios en blanco
        const cleanToken = token.replace(/^['"]|['"]$/g, '').trim();
        console.log('[AUTH] Token limpio para verificación');
        
        const response = await fetch('/api/auth/verify', {
          method: 'GET',
          headers: { 
            'Authorization': `Bearer ${cleanToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          credentials: 'include'
        });
        
        const data = await response.json();
        
        if (response.ok && data.success) {
          console.log('[AUTH] Token válido, usuario autenticado');
          
          // Actualizar información del usuario en el almacenamiento local
          if (data.user) {
            const userData = {
              id: data.user.id,
              username: data.user.username,
              role: data.user.role,
              permissions: data.user.permissions || []
            };
            
            // Guardar en el mismo almacenamiento donde está el token
            const storage = localStorage.getItem('token') ? localStorage : sessionStorage;
            storage.setItem('user', JSON.stringify(userData));
            
            console.log('[AUTH] Datos de usuario actualizados');
          }
          
          return; // Usuario autenticado, salir
        } else {
          console.warn('[AUTH] Token inválido o expirado:', data.message || 'Sin mensaje de error');
          // Limpiar token inválido
          localStorage.removeItem('token');
          sessionStorage.removeItem('token');
        }
      } catch (tokenError) {
        console.error('[AUTH] Error al verificar el token:', tokenError);
      }
    }
    
    // 3. Si no hay token o es inválido, intentar con cookie de sesión
    console.log('[AUTH] Intentando autenticación con cookie de sesión...');
    
    try {
      const response = await fetch('/api/auth/verify', { 
        method: 'GET', 
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      });
      
      const data = await response.json();
      
      if (response.ok && data.success) {
        console.log('[AUTH] Autenticación por cookie exitosa');
        
        // Guardar el token en el almacenamiento local para futuras peticiones
        if (data.token) {
          const storage = localStorage.getItem('token') ? localStorage : sessionStorage;
          // Limpiar el token antes de guardarlo
          const cleanToken = data.token.replace(/^['"]|['"]$/g, '').trim();
          storage.setItem('token', cleanToken);
          
          // Guardar información del usuario
          if (data.user) {
            storage.setItem('user', JSON.stringify({
              id: data.user.id,
              username: data.user.username,
              role: data.user.role,
              permissions: data.user.permissions || []
            }));
          }
          
          console.log('[AUTH] Token y datos de usuario guardados');
        }
        
        return; // Usuario autenticado, salir
      } else {
        console.warn('[AUTH] No se pudo autenticar con cookie de sesión:', data.message || 'Sin mensaje de error');
      }
    } catch (cookieError) {
      console.error('[AUTH] Error al verificar la cookie de sesión:', cookieError);
    }
    
    // 4. Si llegamos aquí, la autenticación falló
    console.warn('[AUTH] No se pudo autenticar al usuario, redirigiendo a login...');
    
    // Limpiar datos de sesión
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('user');
    
    // Redirigir a la página de login con parámetro de redirección
    const currentPath = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login.html?redirect=${currentPath}`;
    
  } catch (error) {
    console.error('[AUTH] Error en el proceso de autenticación:', error);
    
    // En caso de error de red, intentar continuar si hay un token
    const token = localStorage.getItem('token') || sessionStorage.getItem('token');
    if (!token) {
      console.warn('[AUTH] No hay token disponible, redirigiendo a login...');
      window.location.href = '/login.html';
    } else {
      console.warn('[AUTH] Usando token existente a pesar del error de red');
    }
  }
})();