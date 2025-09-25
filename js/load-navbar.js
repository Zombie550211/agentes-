// Función para cargar dinámicamente la barra de navegación
function loadNavbar() {
  // Verificar si el navbar ya existe
  const existingNavbar = document.getElementById('main-navbar');
  if (existingNavbar) return;

  // Crear el elemento nav
  const nav = document.createElement('nav');
  nav.id = 'main-navbar';
  nav.className = 'navbar';
  
  // Contenido del navbar
  nav.innerHTML = `
    <div class="navbar-container">
      <div class="navbar-brand">
        <a href="/inicio.html" class="logo">
          <i class="fas fa-chart-line"></i>
          <span>CRM Dashboard</span>
        </a>
      </div>
      <div class="navbar-menu">
        <ul class="navbar-nav">
          <li class="nav-item">
            <a href="/inicio.html" class="nav-link">
              <i class="fas fa-home"></i>
              <span>Inicio</span>
            </a>
          </li>
          <li class="nav-item">
            <a href="/leads.html" class="nav-link">
              <i class="fas fa-users"></i>
              <span>Leads</span>
            </a>
          </li>
          <li class="nav-item">
            <a href="/clientes.html" class="nav-link">
              <i class="fas fa-user-tie"></i>
              <span>Clientes</span>
            </a>
          </li>
          <li class="nav-item">
            <a href="/reportes.html" class="nav-link">
              <i class="fas fa-chart-bar"></i>
              <span>Reportes</span>
            </a>
          </li>
        </ul>
      </div>
      <div class="navbar-user">
        <div class="user-dropdown">
          <button class="user-button">
            <img src="/images/avatar.png" alt="Avatar" class="user-avatar">
            <span class="user-name">Usuario</span>
            <i class="fas fa-chevron-down"></i>
          </button>
          <div class="dropdown-menu">
            <a href="/perfil.html" class="dropdown-item">
              <i class="fas fa-user"></i> Perfil
            </a>
            <a href="#" id="logout-button" class="dropdown-item">
              <i class="fas fa-sign-out-alt"></i> Cerrar sesión
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  // Insertar el navbar al principio del body
  document.body.insertBefore(nav, document.body.firstChild);

  // Botón de cerrar sesión deshabilitado temporalmente
  const logoutButton = document.getElementById('logout-button');
  if (logoutButton) {
    logoutButton.addEventListener('click', function(e) {
      e.preventDefault();
      console.log('La función de cierre de sesión está deshabilitada temporalmente');
      // Opcional: Redirigir a inicio en lugar de login
      // window.location.href = '/inicio.html';
    });
  }

  // Actualizar la información del usuario si está disponible
  updateUserInfo();
}

// Función para actualizar la información del usuario en la barra de navegación
function updateUserInfo() {
  try {
    const userData = {
      name: 'Usuario Demo',
      role: 'admin',
      email: 'demo@example.com',
      password: 'demo123'  // Solo para referencia, no es seguro exponer contraseñas en el frontend
    };
    
    // Mostrar credenciales en consola (solo para desarrollo)
    console.log('Credenciales de acceso:');
    console.log('Email:', userData.email);
    console.log('Contraseña:', userData.password);
    
    // Actualizar el nombre de usuario en la barra de navegación
    const userNameElement = document.querySelector('.user-name');
    if (userNameElement) {
      userNameElement.textContent = userData.name;
    }
    
    // Actualizar el avatar si es necesario
    const userAvatar = document.querySelector('.user-avatar');
    if (userAvatar && !userAvatar.src) {
      userAvatar.src = '/images/avatar.png';
      userAvatar.alt = userData.name;
    }
  } catch (error) {
    console.error('Error al actualizar la información del usuario:', error);
  }
}

// Cargar el navbar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', function() {
  loadNavbar();
  
  // Marcar el elemento de menú activo según la página actual
  const currentPage = window.location.pathname.split('/').pop() || 'inicio.html';
  const menuItems = document.querySelectorAll('.nav-link');
  
  menuItems.forEach(item => {
    const href = item.getAttribute('href');
    if (href && currentPage.includes(href.replace('/', ''))) {
      item.classList.add('active');
    }
  });
});
