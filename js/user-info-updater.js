// Función universal para actualizar información del usuario en el sidebar
(function() {
  'use strict';

  // Mapeo de roles antiguos a nuevos roles unificados
  function normalizeRole(role) {
    const roleMap = {
      'admin': 'Administrador',
      'administrador': 'Administrador', 
      'Administrativo': 'Administrador',
      'backoffice': 'Backoffice',
      'b:o': 'Backoffice',
      'b.o': 'Backoffice', 
      'b-o': 'Backoffice',
      'bo': 'Backoffice',
      'supervisor': 'Supervisor',
      'agent': 'Agentes',
      'agente': 'Agentes',
      'teamlineas': 'Supervisor Team Lineas',
      'Team Líneas': 'Supervisor Team Lineas',
      'lineas': 'Lineas-Agentes'
    };
    
    return roleMap[role] || role;
  }

  // Función principal para actualizar información del usuario
  window.updateUserInfo = function(username, role) {
    try {
      const normalizedRole = normalizeRole(role);
      
      // Actualizar nombre de usuario
      const userNameElement = document.getElementById('user-name');
      if (userNameElement) {
        userNameElement.textContent = username || 'Usuario';
      }
      
      // Actualizar rol con badge y data-role
      const userRoleElement = document.getElementById('user-role');
      if (userRoleElement) {
        userRoleElement.textContent = normalizedRole || 'Rol';
        userRoleElement.setAttribute('data-role', normalizedRole);
        
        // Agregar clase para el badge si no la tiene
        if (!userRoleElement.classList.contains('user-role-badge')) {
          userRoleElement.classList.add('user-role-badge');
        }
      }
      
      // Guardar datos actualizados para uso posterior
      window.currentUser = { 
        username: username || 'Usuario', 
        role: normalizedRole || 'Rol' 
      };
      
      console.log('✅ Información del usuario actualizada:', {
        username: username,
        originalRole: role,
        normalizedRole: normalizedRole
      });
      
      return true;
    } catch (error) {
      console.error('❌ Error actualizando información del usuario:', error);
      return false;
    }
  };

  // Función para obtener token desde múltiples fuentes
  function getToken() {
    // Intentar localStorage primero
    let token = localStorage.getItem('token');
    if (token) return token;
    
    // Intentar sessionStorage
    token = sessionStorage.getItem('token');
    if (token) return token;
    
    // Intentar cookies
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'token' || name === 'authToken' || name === 'jwt') {
        return value;
      }
    }
    
    return null;
  }

  // Función para decodificar JWT y extraer información del usuario
  function decodeJWT(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return {
        username: payload.username || payload.user || payload.name || 'Usuario',
        role: payload.role || payload.rol || payload.userRole || 'Rol'
      };
    } catch (error) {
      console.warn('No se pudo decodificar el token JWT:', error);
      return null;
    }
  }

  // Auto-inicialización cuando el DOM esté listo
  function autoInitialize() {
    // Intentar obtener datos del usuario desde múltiples fuentes
    let userData = null;
    
    // 1. Intentar desde localStorage/sessionStorage
    try {
      const userStr = localStorage.getItem('user') || sessionStorage.getItem('user');
      if (userStr) {
        userData = JSON.parse(userStr);
      }
    } catch (e) {
      console.warn('Error leyendo datos de usuario desde storage:', e);
    }
    
    // 2. Si no hay datos, intentar decodificar desde token
    if (!userData) {
      const token = getToken();
      if (token) {
        userData = decodeJWT(token);
      }
    }
    
    // 3. Actualizar información si se encontraron datos
    if (userData && userData.username) {
      updateUserInfo(userData.username, userData.role);
    } else {
      console.log('No se encontraron datos del usuario para auto-inicialización');
    }
  }

  // Inicializar cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInitialize);
  } else {
    autoInitialize();
  }

  // También escuchar el evento personalizado del sidebar
  document.addEventListener('sidebar:loaded', function() {
    console.log('Sidebar cargado, re-inicializando información del usuario');
    setTimeout(autoInitialize, 100);
  });

})();
