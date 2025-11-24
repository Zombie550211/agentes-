# CRM Agente – Dashboard

## Descripción General

Este proyecto es un sistema de gestión y monitoreo para agentes, supervisores y equipos de ventas. Permite administrar clientes, leads, facturación, estadísticas, multimedia, empleados del mes y más, todo desde un panel centralizado con soporte para diferentes roles y módulos.

## Estructura de Carpetas y Archivos

- **agentes/**: Recursos y scripts relacionados con agentes.
- **components/**: Componentes HTML reutilizables (sidebar, navbar de usuario, etc).
- **config/**: Configuración de la base de datos y otros parámetros globales.
- **controllers/**: Lógica de negocio y controladores para autenticación, equipos, etc.
- **css/**: Hojas de estilo para los diferentes módulos y temas (incluye dark mode, tablas, sidebar, etc).
- **frontend/**: Vistas HTML para estadísticas y otros módulos.
- **images/**: Imágenes usadas en la aplicación.
- **js/**: Scripts de frontend para manejo de usuario, ranking, sidebar, etc.
- **js/core/**: (Reservado para lógica central de JS, si aplica).
- **licencia/**: Información de licencias.
- **middleware/**: Middlewares para autenticación y otras funciones de backend.
- **models/**: Modelos de datos (Costumer, Lead, User, etc).
- **public/**: Archivos públicos y estáticos (404.html, imágenes, etc).
- **routes/**: Definición de rutas y endpoints de la API.
- **scripts/**: Utilidades y scripts de mantenimiento, migración y pruebas.
- **TEAM LINEAS/**: Recursos y scripts específicos para el equipo Team Líneas.
- **uploads/**: Carpeta para archivos subidos.
- **utils/**: Utilidades y helpers generales.

## Instalación y Requisitos

1. Clona el repositorio:
   ```bash
   git clone <repo-url>
   cd dashboard
   ```
2. Instala dependencias:
   ```bash
   npm install
   ```
3. Configura la base de datos y variables de entorno en `config/db.js` y archivos `.env` si aplica.
4. Inicia el servidor:
   ```bash
   npm start
   ```

## Uso y Desarrollo

- Accede al panel principal en `index.html` o `inicio.html`.
- Los módulos principales están en archivos HTML y se comunican con el backend vía fetch/AJAX.
- Scripts de utilidad y mantenimiento están en la carpeta `scripts/`.
- Para desarrollo de estilos, modifica los archivos en `css/`.
- Para agregar lógica de negocio, usa los controladores en `controllers/` y modelos en `models/`.

## Scripts y Utilidades

- `npm start`: Inicia el servidor principal.
- `server.js`: Servidor backend principal.
- `server_backup.js`, `server_clean.js`: Scripts para respaldo y limpieza de datos.
- Scripts de prueba y migración en `scripts/` y archivos como `test.js`, `test-db-connection.js`.

## Endpoints y API

Las rutas de la API están definidas en la carpeta `routes/`:
- `api.js`: Endpoints principales.
- `auth.js`: Autenticación y gestión de usuarios.
- `equipoRoutes.js`: Gestión de equipos y agentes.
- `facturacion.js`: Facturación y reportes.
- Otros módulos según necesidades del negocio.

## Temas y Estilos

- El sistema soporta dark mode y estilos modernos en la carpeta `css/`.
- Los componentes visuales reutilizables están en `components/`.

## Créditos y Contacto

Desarrollado por el equipo de Zombie550211.

Para soporte o dudas, contacta a: [tu-email@dominio.com]

---

> Documentación generada automáticamente. Puedes ampliarla o personalizarla según las necesidades del proyecto.
