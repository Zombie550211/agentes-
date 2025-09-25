/**
 * user-info.js - Carga y muestra la información del usuario en el sidebar
 * Este script debe incluirse en todas las páginas que muestren el sidebar
 */

document.addEventListener('DOMContentLoaded', function() {
  // Función para normalizar y mostrar la información del usuario en el sidebar
  function cargarInfoUsuario() {
    // Obtener datos del usuario del localStorage o sessionStorage
    let userStr = localStorage.getItem('user') || sessionStorage.getItem('user');
    let user = {};

    try {
      if (userStr) {
        user = JSON.parse(userStr) || {};
      } else {
        // Fallback: 1) intentar obtener desde el token JWT (modo legacy)
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        if (token && token.split('.').length === 3) {
          try {
            const payload = JSON.parse(atob(token.split('.')[1])) || {};
            user = {
              name: payload.username || payload.name || 'Usuario',
              role: payload.role || payload.rol || 'usuario'
            };
          } catch (e) {
            console.info('No se pudo decodificar el token para cargar usuario (se intentará cookie)');
          }
        }

        // Fallback: 2) si no hubo user ni token válido, intentar vía cookie HttpOnly
        if (!user || Object.keys(user).length === 0) {
          // Nota: esta llamada solo rellena UI; no impone redirecciones
          // y es segura para páginas con sidebar.
          // Se guarda en sessionStorage para evitar nuevas llamadas en la sesión.
          // Si el backend no está disponible o no hay sesión, simplemente
          // se mostrará el estado por defecto.
          try {
            // fetch con credenciales para que el servidor lea la cookie de sesión
            fetch('/api/auth/verify', { method: 'GET', credentials: 'include' })
              .then(r => r && r.ok ? r.json() : null)
              .then(data => {
                const apiUser = (data && data.user) || null;
                if (!apiUser) return; // sin sesión por cookie
                const normalized = {
                  username: apiUser.username || apiUser.name || 'Usuario',
                  name: apiUser.username || apiUser.name || 'Usuario',
                  role: (apiUser.role || 'usuario'),
                  team: apiUser.team || 'Sin equipo',
                  id: apiUser.id || apiUser._id || null
                };
                try { sessionStorage.setItem('user', JSON.stringify(normalized)); } catch {}
                // Pintar inmediatamente con los datos recibidos
                try {
                  const userNameElement = document.getElementById('user-name');
                  if (userNameElement) userNameElement.textContent = normalized.username || normalized.name;
                  const userRoleElement = document.getElementById('user-role');
                  if (userRoleElement) {
                    const raw = (normalized.role || '').toString().toLowerCase().trim();
                    const roleMap = { admin:'Administrador', supervisor:'Supervisor', agent:'Agente', backoffice:'Backoffice', 'b:o':'Backoffice', 'b.o':'Backoffice', 'b-o':'Backoffice', bo:'Backoffice' };
                    userRoleElement.textContent = roleMap[raw] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Usuario');
                  }
                  const userAvatar = document.querySelector('.user-info .user-avatar i') || document.querySelector('.user-info .avatar i');
                  if (userAvatar) {
                    const raw = (normalized.role || '').toString().toLowerCase().trim();
                    const roleIcons = { admin:'user-shield', supervisor:'user-tie', agent:'user', backoffice:'user-shield' };
                    userAvatar.className = `fas fa-${(roleIcons[raw] || 'user-circle')}`;
                  }
                } catch {}
              })
              .catch(() => {
                // Evitar ruido en consola si no hay cookie o el endpoint no responde
                console.info('No hay información de usuario en Storage y no se obtuvo sesión por cookie');
              });
          } catch (_) {
            console.info('No hay información de usuario en Storage y no se obtuvo sesión por cookie');
          }
        }
      }

      // Resolver nombre visible con múltiples posibles campos
      const displayName = (
        user.name ||
        user.fullName ||
        user.username ||
        (user.usuario && (user.usuario.name || user.usuario.fullName || user.usuario.username)) ||
        user.email ||
        'Usuario'
      ).toString();

      // Resolver rol soportando estructuras anidadas y variantes
      const rawRole = (
        user.role ||
        (user.usuario && user.usuario.role) ||
        'usuario'
      ).toString().toLowerCase().trim();

      // Mapeo completo de roles con variantes
      const roleMap = {
        // Administradores
        'admin': 'Administrador',
        'administrador': 'Administrador',
        'administrator': 'Administrador',
        'adm': 'Administrador',
        
        // Supervisores
        'supervisor': 'Supervisor',
        'super': 'Supervisor',
        'sup': 'Supervisor',
        'manager': 'Supervisor',
        
        // Agentes
        'agent': 'Agente',
        'agente': 'Agente',
        'user': 'Agente',
        'usuario': 'Agente',
        'operador': 'Agente',
        'operator': 'Agente',
        
        // Backoffice
        'backoffice': 'Backoffice',
        'back office': 'Backoffice',
        'back-office': 'Backoffice',
        'b.o': 'Backoffice',
        'b:o': 'Backoffice',
        'b-o': 'Backoffice',
        'bo': 'Backoffice',
        'soporte': 'Backoffice',
        'support': 'Backoffice'
      };
      const displayRole = roleMap[rawRole] || (rawRole ? rawRole.charAt(0).toUpperCase() + rawRole.slice(1) : 'Usuario');

      // Pintar nombre
      const userNameElement = document.getElementById('user-name');
      if (userNameElement) {
        userNameElement.textContent = displayName;
      }

      // Pintar rol
      const userRoleElement = document.getElementById('user-role');
      if (userRoleElement) {
        userRoleElement.textContent = displayRole;
      }

      // Avatar por rol
      const userAvatar = document.querySelector('.user-info .user-avatar i') || document.querySelector('.user-info .avatar i');
      if (userAvatar) {
        const roleIcons = {
          admin: 'user-shield',
          supervisor: 'user-tie',
          agent: 'user',
          backoffice: 'user-shield'
        };
        const iconClass = roleIcons[rawRole] || 'user-circle';
        userAvatar.className = `fas fa-${iconClass}`;
      }
    } catch (error) {
      console.error('Error al procesar la información del usuario:', error);
    }
  }

  // Cargar la información del usuario cuando el DOM esté listo
  cargarInfoUsuario();

  // Exponer globalmente
  window.cargarInfoUsuario = cargarInfoUsuario;
  // Volver a pintar cuando el sidebar compartido termine de inyectarse
  document.addEventListener('sidebar:loaded', cargarInfoUsuario);
});
