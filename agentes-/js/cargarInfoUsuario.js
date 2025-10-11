document.addEventListener('DOMContentLoaded', function() {
    // Función para cargar la información del usuario
    function cargarInfoUsuario() {
        // Obtener el token del localStorage o sessionStorage
        const token = localStorage.getItem('token') || sessionStorage.getItem('token');
        
        if (!token) {
            console.log('No se encontró el token de autenticación en localStorage');
            // Mostrar información por defecto
            document.getElementById('user-name').textContent = 'Invitado';
            document.getElementById('user-role').textContent = 'Usuario';
            return;
        }

        // Hacer la petición para obtener la información del usuario
        console.log('Realizando petición a /api/usuarios/perfil con token:', token ? 'Token presente' : 'Sin token');
        
        fetch('/api/usuarios/perfil', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            credentials: 'include' // Incluir cookies en la solicitud
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar la información del usuario');
            }
            return response.json();
        })
        .then(data => {
            if (data.success && data.data) {
                const user = data.data;
                // Actualizar la información del usuario en el sidebar
                const userNameElement = document.getElementById('user-name');
                const userRoleElement = document.getElementById('user-role');
                const userAvatar = document.querySelector('.avatar i');
                
                if (userNameElement && user.name) {
                    userNameElement.textContent = user.name;
                }
                
                if (userRoleElement && user.role) {
                    // Formatear el rol para mostrarlo en mayúscula inicial
                    const roleFormatted = user.role.charAt(0).toUpperCase() + user.role.slice(1).toLowerCase();
                    userRoleElement.textContent = roleFormatted;
                }
                
                if (userAvatar && user.avatar) {
                    userAvatar.className = `fas fa-${user.avatar}`;
                }
            }
        })
        .catch(error => {
            console.error('Error al cargar la información del usuario:', error);
            // Si hay un error, mostrar información por defecto
            document.getElementById('user-name').textContent = 'Usuario';
            document.getElementById('user-role').textContent = 'Invitado';
        });
    }

    // Función para manejar el cierre de sesión
    function configurarCerrarSesion() {
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function(e) {
                e.preventDefault();
                // Eliminar el token de ambos storages
                localStorage.removeItem('token');
                sessionStorage.removeItem('token');
                // Redirigir a la página de inicio de sesión
                window.location.href = 'login.html';
            });
        }
    }

    // Cargar la información del usuario cuando el DOM esté listo
    cargarInfoUsuario();
    configurarCerrarSesion();
});
