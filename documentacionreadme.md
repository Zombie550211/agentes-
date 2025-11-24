## Introducción

**CRM Connecting SA.CV** es una plataforma integral de gestión de relaciones con clientes (Customer Relationship Management) diseñada para optimizar y automatizar los procesos comerciales, operativos y de seguimiento de clientes en la empresa. Permite a agentes, supervisores y administradores gestionar leads, clientes, equipos, facturación, multimedia y estadísticas en tiempo real, centralizando la información y facilitando la toma de decisiones. El sistema está construido sobre una arquitectura moderna con Node.js, Express y MongoDB en el backend, y una interfaz web dinámica en el frontend, garantizando seguridad, escalabilidad y eficiencia operativa.


#### Monitoreo y persistencia en ciberseguridad

La base de datos es monitoreada activamente desde un entorno Kali Linux, utilizando herramientas especializadas de ciberseguridad para detectar accesos no autorizados, intentos de intrusión y vulnerabilidades. Este monitoreo incluye:

- **Escaneo de puertos y servicios:** Se realizan análisis periódicos para identificar servicios expuestos y posibles vectores de ataque.
- **Detección de intrusiones:** Uso de IDS/IPS (Intrusion Detection/Prevention Systems) para alertar sobre patrones sospechosos o intentos de acceso indebido.
- **Auditoría de logs:** Revisión continua de logs de acceso y operaciones críticas, buscando anomalías o comportamientos inusuales.
- **Pruebas de penetración:** Ejecución de pentesting controlado desde Kali Linux para identificar y corregir vulnerabilidades antes de que puedan ser explotadas.
- **Persistencia en seguridad:** El monitoreo es constante, con alertas automáticas y respuesta rápida ante cualquier incidente detectado.

#### Acciones adicionales para proteger la información

- **Segmentación de red:** La base de datos se encuentra en una red segmentada, aislada del acceso público directo.
- **Rotación de credenciales:** Las contraseñas y claves de acceso se rotan periódicamente y se almacenan de forma segura.
- **Principio de mínimo privilegio:** Cada usuario y servicio tiene solo los permisos estrictamente necesarios para operar.
- **Cifrado en tránsito y en reposo:** Los datos sensibles se cifran tanto durante la transmisión como en almacenamiento.
- **Pruebas de vulnerabilidad:** Se realizan escaneos automáticos y manuales para detectar configuraciones inseguras o software desactualizado.
- **Actualización y parches:** El sistema operativo, la base de datos y las dependencias se mantienen actualizados con los últimos parches de seguridad.

Estas acciones, sumadas al monitoreo activo desde Kali Linux, refuerzan la postura de ciberseguridad del CRM y aseguran la protección continua de la información almacenada.
### Resguardo de la Base de Datos y Ciberseguridad

Para proteger la base de datos y la información almacenada, el CRM implementa las siguientes técnicas y buenas prácticas de ciberseguridad:

- **Conexión segura:**
   - Uso de cadenas de conexión con credenciales en variables de entorno, nunca expuestas en el código fuente.
   - Soporte para conexiones cifradas (SSL/TLS) hacia MongoDB en producción.
- **Acceso restringido:**
   - Solo el backend tiene acceso directo a la base de datos; el frontend interactúa exclusivamente mediante APIs validadas.
   - Roles y permisos estrictos en los endpoints para evitar accesos no autorizados a datos sensibles.
- **Backups y recuperación:**
   - Scripts y endpoints para respaldos automáticos y manuales de la base de datos (`server_backup.js`, `api_backup.js`).
   - Procedimientos de restauración y limpieza controlada (`api_before_restore.js`, `api_clean.js`).
- **Auditoría y monitoreo:**
   - Registro de operaciones críticas y monitoreo de accesos a la base de datos.
   - Health checks periódicos para detectar caídas o anomalías.
- **Protección contra inyección y ataques:**
   - Validación y sanitización de todas las entradas antes de interactuar con la base de datos.
   - Uso de Mongoose para evitar inyección de queries y manipulación directa.
- **Ciberseguridad adicional:**
   - Actualización regular de dependencias y parches de seguridad.
   - Despliegue en servidores protegidos, con firewalls y acceso restringido por IP.
   - Eliminación de datos sensibles en logs y respuestas.

Estas medidas aseguran que la base de datos esté resguardada ante accesos no autorizados, pérdida de información y ataques comunes, alineándose con estándares modernos de ciberseguridad.

## Seguridad de la Información

La seguridad es un pilar fundamental en **CRM Connecting SA.CV**. El sistema implementa múltiples capas y tácticas para proteger la información sensible de clientes, usuarios y operaciones:

- **Autenticación y autorización:**
   - Uso de JWT (JSON Web Tokens) para sesiones seguras y control de acceso basado en roles (agente, supervisor, admin).
   - Middleware `protect` y `authorize` para restringir rutas críticas solo a usuarios autenticados y con permisos adecuados.
- **Encriptación:**
   - Contraseñas almacenadas con hash seguro (bcrypt).
   - Tokens y datos sensibles nunca se exponen en el frontend ni en logs.
- **Protección contra ataques comunes:**
   - Helmet para reforzar cabeceras HTTP y mitigar XSS, clickjacking y otros vectores.
   - Rate limiting para prevenir ataques de fuerza bruta y denegación de servicio.
   - CORS estricto, solo permitiendo orígenes autorizados.
- **Validación y sanitización:**
   - Validaciones exhaustivas en entradas de usuario y archivos.
   - Sanitización de datos para evitar inyección de código o comandos.
- **Gestión de archivos segura:**
   - Subida de archivos controlada con Multer y validación de tipo/tamaño.
   - Limpieza automática de archivos temporales y referencias huérfanas.
- **Gestión de sesiones y cookies:**
   - Cookies seguras, con atributos HttpOnly y SameSite.
   - Expiración automática de sesiones inactivas.
- **Auditoría y monitoreo:**
   - Logs de operaciones críticas y endpoints de diagnóstico.
   - Health checks y alertas ante fallos o accesos sospechosos.

Estas tácticas garantizan la confidencialidad, integridad y disponibilidad de la información, cumpliendo con buenas prácticas de seguridad para aplicaciones web modernas.


#### Herramientas para detección de accesos no autorizados

Para detectar accesos no autorizados y amenazas, se emplean herramientas especializadas de ciberseguridad, entre ellas:

- **Fail2Ban:** Monitorea logs de acceso y bloquea automáticamente IPs con intentos fallidos repetidos.
- **Snort:** IDS/IPS de código abierto que analiza el tráfico de red en tiempo real y detecta patrones de ataque conocidos.
- **Wireshark:** Para análisis profundo de paquetes y detección de tráfico sospechoso o anómalo.
- **OSSEC:** Sistema de detección de intrusos basado en host, que alerta sobre cambios no autorizados en archivos y configuraciones.
- **Nmap:** Escaneo regular de puertos y servicios para identificar posibles vectores de ataque.
- **Herramientas de Kali Linux:** Utilización de scripts y utilidades como Hydra, Nikto y Metasploit para pruebas de penetración y simulación de ataques controlados.

Estas herramientas permiten una vigilancia activa y respuesta rápida ante cualquier intento de acceso no autorizado, reforzando la seguridad de la base de datos y del sistema en general.
---

## Funcionamiento de la Base de Datos y Colecciones

### Arquitectura y conexión
- **Base de datos:** MongoDB, gestionada mediante Mongoose (ODM).
- **Ubicación:** Configurada en `config/db.js` y conectada desde `server.js`.
- **Conexión:** Persistente, con reconexión automática y fallback si falla.
- **Colecciones principales:**
   - `users`: Usuarios, roles, credenciales, tokens.
   - `leads`/`customers`: Clientes, leads, historial, status, comentarios.
   - `mediafiles`: Archivos multimedia (Cloudinary/local), metadatos.
   - `teams`: Equipos, agentes, supervisores.
   - `employeesofmonth`: Reconocimientos mensuales.
   - Otras: logs, backups, configuraciones temporales.

### ¿Quién hace peticiones y para qué?
- **Frontend (HTML/JS):**
   - Usa `fetch`/AJAX para consumir APIs REST (`/api/*`, `/api/auth/*`, `/api/media`, etc).
   - Scripts como `js/user-info.js`, `js/ranking.js`, `js/sidebar-loader.js`, `js/auth-logout.js` hacen peticiones para:
      - Autenticación y sesión (`/api/auth/login`, `/api/auth/logout`, `/api/auth/verify-server`).
      - Obtener leads/clientes filtrados (`/api/customers`, `/api/leads`, `/api/estadisticas/leads-dashboard`).
      - Subir/consultar multimedia (`/api/media`, `/api/upload`).
      - Consultar ranking, equipos, empleados del mes (`/api/ranking`, `/api/teams`, `/api/employeesOfMonth`).
      - Guardar comentarios, actualizar status, registrar acciones (`/api/comments`, `/api/leads/:id/status`).
- **Backend (Express):**
   - Los controladores (`controllers/`) y rutas (`routes/`) reciben las peticiones, validan, y consultan la base de datos usando los modelos (`models/`).
   - Ejemplo: `controllers/authController.js` maneja login, registro, validación de tokens, y consulta/actualiza la colección `users`.
   - Ejemplo: `controllers/equipoController.js` consulta equipos y agentes en la colección `teams`.

### Frecuencia y flujo de peticiones
- **Frecuencia:**
   - Depende de la interacción del usuario y la lógica de cada página.
   - Ejemplo: Al cargar `lead.html`, se hacen varias peticiones para obtener leads, agentes, status, comentarios y multimedia.
   - Acciones como login, cambio de status, subida de archivos, o comentarios disparan peticiones inmediatas.
   - Algunos scripts usan intervalos o recarga automática para refrescar datos (ej: ranking, estadísticas).
- **Flujo típico:**
   1. Usuario interactúa con la UI (ej: filtra leads, sube archivo, comenta).
   2. Script JS hace petición `fetch` a la API correspondiente.
   3. Ruta Express recibe, valida y delega al controlador.
   4. Controlador usa el modelo Mongoose para consultar/actualizar la colección.
   5. Respuesta se envía al frontend, que actualiza la UI.

### Relación scripts ↔ API ↔ colecciones
- **js/user-info.js** → `/api/auth/userinfo` → `users`
- **js/ranking.js** → `/api/ranking` → `leads`, `users`
- **js/sidebar-loader.js** → `/api/users/agents` → `users`
- **js/auth-logout.js** → `/api/auth/logout` → `users`
- **js/fetch-interceptor.js** → Intercepta todas las peticiones para añadir JWT/cookies.
- **js/inactivity-manager.js** → `/api/auth/verify-server` → `users`
- **js/core/** (varios) → `/api/*` (leads, equipos, multimedia, comentarios, status, etc) → colecciones correspondientes.

### Resumen
El sistema implementa una arquitectura desacoplada: el frontend solicita datos y acciones a través de APIs REST, el backend valida y opera sobre la base de datos MongoDB usando modelos Mongoose, y cada colección representa una entidad clave del negocio. La frecuencia de peticiones depende de la interacción y lógica de cada página, garantizando eficiencia y seguridad en el acceso a los datos.

---
# CRM Agente – Dashboard

## Arquitectura General (Diagrama Escrito)

```
┌───────────────┐        HTTP/API         ┌───────────────┐         MongoDB         ┌───────────────┐
│   Frontend    │ <---------------------> │   Backend     │ <--------------------> │ Base de Datos │
│ (HTML/JS/CSS) │   (Express/Node.js)     │ (APIs/Control)│                      │   MongoDB     │
**Flujo principal:**
- El usuario interactúa con vistas HTML que cargan JS y CSS.
- El backend procesa la lógica, accede a la base de datos y responde con datos JSON.
- El frontend renderiza los datos y actualiza la UI.


```
│ index.html   │
│ inicio.html  │
│ ...          │
└──────┬───────┘
│  - user-info.js
│  - ranking.js
   │
   ▼
┌──────────────┐

## Detalle de Archivos y Carpetas del Frontend
**Propósito:**
Vista principal para la gestión de clientes/leads. Permite visualizar, filtrar, editar y actualizar información de clientes en tiempo real.
- Al cargar, el JS realiza una petición fetch/AJAX a `/api/leads` para obtener la lista de clientes desde la base de datos MongoDB, a través del backend Express.
- Los datos recibidos se procesan y renderizan dinámicamente en la tabla HTML.
   - Actualizan la información del usuario en la UI.
- Lógica de renderizado de la tabla:
   - Funciones como `renderCostumerTable`, `applyRowStatusColors`, `syncStatusDatasets` procesan los datos y actualizan la tabla.
**¿Por qué se programa así?**
- El uso de fetch/AJAX permite que la UI sea reactiva y no requiera recargar la página.
- El uso de observadores (MutationObserver) y eventos garantiza que los cambios en la tabla se reflejen de inmediato.
- La modularidad de los scripts permite reutilizar lógica en otras vistas y facilita la personalización por rol.
- **Propósito:** Son las páginas de entrada al sistema. Renderizan el dashboard principal y la navegación inicial.
- **Flujo:** Al cargar, incluyen el sidebar y la navbar, y cargan scripts para mostrar información general del usuario y accesos rápidos. Desde aquí el usuario puede navegar a los diferentes módulos.
- **Interacción:** El usuario puede buscar, filtrar, editar y cambiar el estado de los clientes. Los cambios se envían al backend y la tabla se actualiza dinámicamente.
### crear-cuenta.html / register.html / login.html / forgot-password.html / reset-password.html
- **Propósito:** Formularios de autenticación y registro de usuarios.
- **Flujo:** Solicita datos al backend y muestra el ranking o selección mensual. Permite destacar empleados y mostrar reconocimientos.

- **Propósito:** Dashboard de estadísticas y métricas clave.
- **Flujo:** Realiza peticiones a `/api/estadisticas/leads-dashboard` y otros endpoints para mostrar gráficos, tablas y KPIs. Permite filtrar por fechas y equipos.
- **Flujo:** Solicita datos a `/api/facturacion/:ano/:mes` y `/api/facturacion/anual/:ano`, mostrando tablas y gráficos de facturación. Permite agregar o editar registros si el usuario tiene permisos.

- **Propósito:** Visualizar el puntaje de agentes/equipos según reglas del negocio.

### Reglas.html
- **Flujo:** Permiten probar flujos de autenticación, conexión y lógica de negocio sin afectar datos reales.

- **Propósito:** Gestión y visualización de archivos multimedia relacionados con clientes o agentes.
- **Flujo:** Permite subir, ver y descargar archivos multimedia, integrando lógica de permisos y almacenamiento.
- **Flujo:** Adaptan la lógica y presentación a las necesidades de este equipo, mostrando datos filtrados y acciones específicas.

- **Costumer.html**: Vista principal para la gestión de clientes/leads. Incluye tablas dinámicas, filtros y lógica para mostrar, editar y actualizar clientes. Carga JS para manejo de datos y CSS para estilos oscuros.
- **empleado-del-mes.html, equipos.html, Estadisticas.html, facturacion.html, Ranking y Promociones.html, Tabla de puntaje.html, Reglas.html**: Módulos especializados para reportes, rankings, reglas y estadísticas. Cada uno carga scripts y estilos específicos según su función.
- **debug.html, test-auth.html, verificar-israel.html**: Vistas de prueba y depuración, útiles para desarrollo y QA.

### Carpeta components/

- **sidebar.html**: Componente HTML reutilizable para la barra lateral de navegación. Permite mantener la UI consistente y facilita cambios globales en la navegación.
- **user-navbar.html**: Barra superior con información del usuario y accesos rápidos. Se incluye en varias vistas para mantener la experiencia de usuario homogénea.

### Carpeta css/

- **theme.css**: Define variables CSS, colores base, fuentes y estilos globales. Permite cambiar el tema (oscuro/claro) de forma centralizada.
- **costumer-modern.css, costumer-table-clean.css, costumer-table-actions.css, costumer-table-comments.css**: Estilos específicos para tablas de clientes, acciones y comentarios. Permiten personalizar la experiencia visual y mejorar la usabilidad.
- **dashboard-styles.css, estadisticas.css, facturacion-styles.css, form-styles.css**: Estilos para módulos y páginas específicas.
- **sidebar-inicio.css, sidebar-shared.css, sidebar.css**: Estilos para la barra lateral, tanto en modo inicio como compartido.
- **tabla-puntaje.css, team-filters.css**: Estilos para tablas de puntaje y filtros de equipos.

### Carpeta js/

- **auth-logout.js**: Lógica para cerrar sesión y limpiar datos de usuario.
- **crm-config.js, crm-init.js**: Configuración y lógica de inicialización del CRM en el frontend.
- **fetch-interceptor.js**: Intercepta y gestiona peticiones fetch/AJAX, permitiendo manejo global de errores y autenticación.
- **inactivity-manager.js**: Detecta inactividad del usuario y puede cerrar sesión automáticamente por seguridad.
- **logout-handler.js**: Gestiona el proceso de logout y redirección.
- **ranking.js**: Lógica para mostrar y actualizar rankings de agentes o equipos.
- **sidebar-loader.js**: Carga dinámica del sidebar en las vistas, permitiendo modularidad y reutilización.
- **user-info-updater.js, user-info.js**: Actualizan y muestran la información del usuario en la UI.
- **core/**: Espacio reservado para lógica JS centralizada o utilidades compartidas.

### Justificación técnica del frontend

- **Separación de responsabilidades**: Cada archivo y carpeta tiene una función clara (vistas, lógica, estilos, componentes), facilitando el mantenimiento y la escalabilidad.
- **Uso de componentes reutilizables**: El sidebar y la navbar se incluyen como componentes para evitar duplicidad y permitir cambios globales rápidos.
- **Estilos modulares**: Los CSS están divididos por módulo y función, permitiendo personalización y temas (dark mode, tablas, etc).
- **Lógica desacoplada**: Los scripts JS se cargan según la vista, evitando cargar código innecesario y mejorando el rendimiento.
- **Comunicación vía API**: Todo el frontend interactúa con el backend mediante fetch/AJAX, siguiendo buenas prácticas de aplicaciones SPA modernas.

---

## Descripción General

Este proyecto es un sistema de gestión y monitoreo para agentes, supervisores y equipos de ventas. Permite administrar clientes, leads, facturación, estadísticas, multimedia, empleados del mes y más, todo desde un panel centralizado con soporte para diferentes roles y módulos.

## Estructura de Carpetas y Archivos

### Archivos y carpetas raíz

- `.editorconfig`, `.env`, `.gitignore`, `.renderignore`: Archivos de configuración para el entorno de desarrollo, variables de entorno y control de versiones.
- `package.json`, `package-lock.json`: Definen las dependencias, scripts y metadatos del proyecto Node.js.
- `jsconfig.json`: Configuración para el soporte de JavaScript en editores como VS Code.
- `netlify.toml`, `render.yaml`: Configuración para despliegue en plataformas Netlify y Render.
- `_redirects`: Reglas de redirección para Netlify.
- `README.md`, `documentacionreadme.md`: Documentación general y técnica del proyecto.

### Frontend (vistas y recursos)

- `index.html`, `inicio.html`, `Costumer.html`, `crear-cuenta.html`, `empleado-del-mes.html`, `equipos.html`, `Estadisticas.html`, `facturacion.html`, `forgot-password.html`, `lead.html`, `lead-lineas.html`, `login.html`, `multimedia.html`, `Ranking y Promociones.html`, `register.html`, `Reglas.html`, `Tabla de puntaje.html`, `test-auth.html`, `debug.html`, `reset-password.html`, `verificar-israel.html`: Vistas HTML principales del sistema, cada una enfocada en un módulo o funcionalidad específica.
- `frontend/`: Vistas HTML adicionales, por ejemplo, para estadísticas.
- `components/`: Componentes HTML reutilizables, como `sidebar.html` y `user-navbar.html`.
- `css/`: Hojas de estilo CSS para temas, tablas, sidebar, formularios, dark mode, etc. Ejemplo: `costumer-modern.css`, `dashboard-styles.css`, `theme.css`.
- `images/`: Imágenes y recursos gráficos usados en la interfaz.
- `public/`: Archivos estáticos públicos, como `404.html` e imágenes accesibles directamente.

### Lógica de frontend (JavaScript)

- `js/`: Scripts de frontend para manejo de usuario, ranking, sidebar, autenticación, etc. Ejemplo: `auth-logout.js`, `crm-config.js`, `ranking.js`, `sidebar-loader.js`, `user-info.js`.
- `js/core/`: Espacio reservado para lógica central de JS si aplica.

### Backend y lógica de negocio

- `server.js`: Servidor principal Node.js/Express.
- `server_backup.js`, `server_clean.js`: Scripts para respaldo y limpieza de datos en el servidor.
- `config/`: Configuración de la base de datos y parámetros globales (`db.js`).
- `controllers/`: Controladores de negocio, como `authController.js` y `equipoController.js`.
- `middleware/`: Middlewares para autenticación y otras funciones (`auth.js`).
- `models/`: Modelos de datos Mongoose/MongoDB, como `Costumer.js`, `Lead.js`, `User.js`, etc.
- `routes/`: Definición de rutas y endpoints de la API (`api.js`, `auth.js`, `equipoRoutes.js`, `facturacion.js`, etc).

### Scripts, utilidades y mantenimiento

- `scripts/`: Scripts de mantenimiento, migración, pruebas y utilidades para la base de datos y el sistema.
- Archivos sueltos como `check-data.js`, `check-status-values.js`, `find-completed-record.js`, `fix-agents-supervisor.js`, `remove_unique_index.js`, `test-db-connection.js`, `test.js`, etc: Scripts para tareas específicas de verificación, migración, pruebas y corrección de datos.
- `utils/`: Utilidades generales, helpers y módulos de apoyo (`phoneNormalizer.js`, `roles.js`, `scoring-system.js`, `teams.js`).

### Módulos y recursos especializados

- `agentes/`: Recursos y scripts relacionados con la gestión de agentes.
- `TEAM LINEAS/`: Recursos, scripts y vistas específicas para el equipo Team Líneas (por ejemplo, `COSTUMER-LINEAS.html`, `EMPLEADO-LINEAS.html`, etc).
- `licencia/`: Documentación de licencias del software (`LICENCIA_PROPIETARIA_CRM_DanielErnesto.pdf`).
- `uploads/`: Carpeta para archivos subidos por los usuarios o el sistema.

### Otros archivos relevantes

- `PERMISOS_POR_ROL.md`, `TABLA_PUNTAJES.md`, `FECHAS-README.md`: Documentación adicional sobre permisos, reglas y fechas relevantes para el negocio.
- `sidebar-content.txt`: Contenido o configuración del sidebar.

---

Cada archivo y carpeta cumple una función específica dentro del flujo de trabajo del sistema, permitiendo una separación clara entre frontend, backend, utilidades, recursos estáticos y documentación. El proyecto está estructurado para facilitar el mantenimiento, la escalabilidad y la colaboración entre desarrolladores.

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

Las rutas de la API están definidas en la carpeta `routes/` y son el núcleo de la comunicación entre el frontend y el backend. A continuación se describen los endpoints principales, su funcionamiento y su importancia:

### auth.js – Autenticación y gestión de usuarios

- **POST /api/auth/register**: Registra un nuevo usuario. Importante para la administración de usuarios y pruebas iniciales. (Debe protegerse en producción).
- **POST /api/auth/login**: Inicia sesión, valida credenciales y genera un token JWT. Esencial para la seguridad y control de acceso.
- **POST /api/auth/logout**: Cierra sesión y elimina el token de autenticación.
- **GET /api/auth/me**: Devuelve la información del usuario autenticado. Útil para mostrar datos personalizados en el frontend.
- **POST /api/auth/forgot-password**: Envía un código de recuperación al correo del usuario. Clave para recuperación de cuentas.
- **POST /api/auth/verify-reset-code**: Verifica el código de recuperación enviado por email.
- **POST /api/auth/reset-password-by-email**: Permite restablecer la contraseña usando el código recibido por email.
- **POST /api/auth/reset-password**: Permite a un administrador restablecer la contraseña de cualquier usuario.
- **GET /api/auth/verify-server** y **GET /api/auth/verify**: Verifican la validez del token JWT, permitiendo comprobar si el usuario está autenticado.
- **GET /api/auth/debug-storage**: Endpoint de depuración para revisar cookies y headers.

**Importancia:**
Estos endpoints son fundamentales para la seguridad, gestión de sesiones y recuperación de cuentas. Permiten controlar el acceso a los recursos protegidos y mantener la integridad de los datos de usuario.

### api.js – Gestión de leads, estadísticas, facturación y Team Líneas

- **GET /api/leads**: Devuelve la lista de leads/clientes, con filtros por fecha, mes y estado. Es el endpoint principal para mostrar datos en la tabla de clientes.
- **GET /api/leads/debug-dates**: Diagnóstico de formatos de fecha en los leads, útil para depuración y migraciones.
- **GET /api/estadisticas/leads-dashboard**: Devuelve datos agregados y preprocesados para el dashboard de estadísticas (por día, producto, equipo, etc). Esencial para la visualización de métricas y reportes.
- **PUT /api/leads/:id/status**: Actualiza el estado de un lead. Permite cambiar el status desde el frontend y mantener la información actualizada.
- **GET /api/lineas-team**: Devuelve los leads del equipo Team Líneas, filtrando por rol y permisos. Importante para la gestión segmentada de equipos.
- **POST /api/seed-lineas-leads**: Crea datos de prueba para Team Líneas (solo administradores). Útil para pruebas y desarrollo.
- **GET /api/facturacion/:ano/:mes**: Devuelve la facturación de un mes específico. Clave para reportes financieros.
- **GET /api/facturacion/anual/:ano**: Devuelve los totales anuales de facturación, agrupados por mes.
- **POST /api/facturacion**: Guarda o actualiza un registro de facturación diario.
- **GET /api/leads/check-dates**: Diagnóstico de fechas en la base de datos de leads.

**Importancia:**
Estos endpoints permiten la gestión integral de clientes, ventas, estadísticas y facturación. Son el puente entre la lógica de negocio y la interfaz de usuario, asegurando que los datos estén siempre actualizados y disponibles para análisis, reportes y toma de decisiones.

### Otros archivos de rutas

- **equipoRoutes.js**: Endpoints para la gestión de equipos y agentes.
- **facturacion.js**: Endpoints adicionales para facturación y reportes.
- **employeesOfMonth.js, ranking.js, ranking-test.js, etc**: Endpoints especializados para módulos como empleados del mes, rankings y pruebas.

---

Cada API está diseñada para ser segura, eficiente y flexible, permitiendo que el sistema crezca y se adapte a nuevas necesidades del negocio.

## Temas y Estilos

- El sistema soporta dark mode y estilos modernos en la carpeta `css/`.
- Los componentes visuales reutilizables están en `components/`.

## Créditos y Contacto

Desarrollado por el equipo de Zombie550211.

Para soporte o dudas, contacta a: [tu-email@dominio.com]

---

> Documentación generada automáticamente. Puedes ampliarla o personalizarla según las necesidades del proyecto.

---

## Detalle técnico de server.js

### Propósito general
`server.js` es el punto de entrada principal del backend. Orquesta la inicialización del servidor Express, la conexión a MongoDB, la configuración de middlewares de seguridad, CORS, autenticación, subida de archivos, rutas API y la gestión de recursos estáticos. Es el núcleo de la lógica de negocio y la puerta de entrada para todas las operaciones del sistema.

### Arquitectura y flujo principal
- **Inicialización:**
   - Fuerza DNS a Google para evitar problemas de red.
   - Carga variables de entorno y módulos críticos (Express, CORS, Multer, JWT, Mongoose, etc).
   - Carga condicional de middlewares de seguridad (`helmet`, `rate-limit`, `cookie-parser`).
   - Importa la configuración de base de datos y middlewares de autenticación.
   - Importa y monta rutas modulares (`auth`, `api`, `ranking`, `equipoRoutes`, `employeesOfMonth`).
- **Configuración de Express:**
   - Define el puerto dinámicamente según entorno (Render, local, producción).
   - Sirve archivos estáticos y recursos multimedia (imágenes, videos, uploads).
   - Configura CORS con lista blanca dinámica y reglas estrictas.
   - Inicializa middlewares globales: JSON, URL-encoded, cookies, seguridad, rate limiting.
   - Configura Multer y Cloudinary para subida de archivos multimedia.
- **Conexión a MongoDB:**
   - Usa funciones centralizadas de `config/db.js` para conectar, obtener y cerrar la base de datos.
   - Soporta fallback y modo offline si la base de datos no está disponible.
- **Middlewares y helpers:**
   - `protect` y `authorize` para proteger rutas y controlar acceso por rol.
   - Helpers para cookies, validación de archivos, normalización de datos y manejo de errores.
- **Arranque y cierre:**
   - Arranca el servidor solo cuando la base de datos está lista (o en modo degradado si falla).
   - Maneja cierre graceful con SIGINT/SIGTERM, cerrando conexiones y liberando recursos.

### Endpoints y rutas principales
- **/health:** Health check de la base de datos y el servidor.
- **/images, /uploads, /public:** Servir recursos estáticos y multimedia.
- **/api/auth/**: Rutas de autenticación y gestión de usuarios (login, register, reset-password, verify-server, debug-storage).
- **/api/**: Rutas de negocio (leads, clientes, facturación, multimedia, comentarios, equipos, empleados del mes, etc).
- **/api/lineas:** Gestión avanzada de Team Líneas (filtros, validaciones, guardado dinámico).
- **/api/upload, /api/media:** Subida, consulta y eliminación de archivos multimedia (local y Cloudinary).
- **/api/customers:** Consulta avanzada de clientes/leads con filtros por rol, agente, supervisor, fechas, paginación y enriquecimiento de datos.
- **/api/leads/:id/status:** Actualización de status de leads con validaciones y diagnóstico avanzado.
- **/api/comments, /api/leads/:id/comentarios:** Gestión de comentarios por lead (listar, crear, actualizar, eliminar).
- **/api/teams, /api/supervisors/:team:** Consulta de equipos y supervisores.
- **/api/create-admin:** Creación de usuario admin inicial (solo desarrollo).
- **/api/users/agents:** Listado de agentes para hidratar el sidebar.
- **/favicon.ico:** Servir icono por defecto.
- **Catch-all:** Sirve `lead.html` para rutas no encontradas (SPA fallback).

### Funciones y lógica destacada
- **Seguridad:**
   - JWT para autenticación y autorización.
   - Rate limiting y helmet para mitigar ataques.
   - CORS estricto y dinámico.
   - Validaciones exhaustivas en endpoints críticos (registro, subida de archivos, status, etc).
- **Gestión de archivos:**
   - Multer para uploads temporales, Cloudinary para almacenamiento externo.
   - Limpieza automática de archivos locales tras subir a la nube.
   - Verificación y limpieza de referencias a archivos inexistentes.
- **Gestión de roles y permisos:**
   - `protect` y `authorize` para controlar acceso a rutas según rol.
   - Filtros avanzados en endpoints de clientes/leads para mostrar solo datos permitidos según el rol (agente, supervisor, admin).
- **Diagnóstico y debugging:**
   - Endpoints de debug para usuarios, media, health, y limpieza de archivos.
   - Logs detallados de cada operación relevante.
- **Arranque resiliente:**
   - Espera activa a la base de datos antes de iniciar el servidor.
   - Modo degradado si la base de datos no está disponible.
- **Cierre graceful:**
   - Maneja SIGINT/SIGTERM para cerrar conexiones y liberar recursos correctamente.

### Resumen
`server.js` es el corazón del backend, integrando seguridad, modularidad, gestión de archivos, roles, autenticación, lógica de negocio y resiliencia operativa. Su diseño permite escalar, mantener y depurar el sistema de manera profesional y segura.

---

---

## Detalle técnico de archivos JS principales

### auth-logout.js
**Tipo:** Alias/stub
**Propósito:** Alias de `logout-handler.js` para compatibilidad con vistas o scripts antiguos. No contiene lógica propia, solo un log de carga. Toda la funcionalidad real está en `logout-handler.js`.

---

### crm-config.js
**Propósito:** Define la configuración global del CRM en el frontend (timeouts de inactividad, claves de storage, endpoints base, flags de seguridad). Expone el objeto `window.CRM_CONFIG` para uso global. Permite centralizar parámetros críticos y facilita cambios de política sin modificar múltiples archivos.

---

### crm-init.js
**Propósito:** Inicialización global del sistema CRM. Verifica autenticación del usuario en cada carga de página (excepto públicas), redirige a login si no está autenticado, y expone hooks para inicialización de módulos. Modulariza el arranque y asegura que solo usuarios válidos accedan a vistas protegidas.

---

### fetch-interceptor.js
**Propósito:** Intercepta todas las peticiones `fetch` del frontend para agregar automáticamente el token JWT a los headers. Si la respuesta es 401, limpia el storage y redirige a login. Permite manejo global de autenticación y errores de sesión, desacoplando la lógica de cada módulo individual.

---

### inactivity-manager.js
**Propósito:** Gestiona el cierre de sesión por inactividad. Usa timers configurables (desde `CRM_CONFIG`), muestra advertencias antes de cerrar sesión, y limpia el storage/redirige si el usuario no interactúa. Escucha eventos de usuario (mouse, teclado, scroll) para resetear los timers. Refuerza la seguridad y cumplimiento de políticas.

---

### logout-handler.js
**Propósito:** Maneja el proceso de logout en toda la app. Limpia storage, llama al endpoint de logout, y redirige a login. Se integra con botones y menús de logout en todas las vistas. Usa confirmaciones y asegura que la sesión se cierre correctamente en frontend y backend.

---

### ranking.js
**Tipo:** Stub
**Propósito:** Stub para evitar errores 404/MIME en vistas que esperan lógica de ranking. Actualmente solo loguea su carga, pero está preparado para futuras mejoras (como cargar `/api/ranking` en portada). Permite despliegue incremental y compatibilidad.

---

### sidebar-loader.js
**Propósito:** Carga dinámica del sidebar en todas las páginas. Obtiene datos del usuario (localStorage o API), genera el HTML del sidebar según rol/equipo, y lo inserta en el DOM. Emite el evento `sidebar:loaded` para sincronizar otros módulos. Incluye fallback para Team Líneas, setup de auto-ocultamiento, y manejo de errores. Es el núcleo de la navegación y experiencia de usuario.

---

### user-info.js
**Propósito:** Actualiza la información del usuario en el sidebar (ventas, puntos, equipo). Obtiene datos del usuario autenticado y de leads del mes, calcula KPIs, y actualiza el DOM. Expone la función `window.loadUserStats` para uso externo. Usa caché y headers de autenticación. Modulariza la lógica de estadísticas personales.

---

### user-info-updater.js
**Propósito:** Actualiza periódicamente la información del usuario en la UI. Llama a `loadUserStats` cada 5 minutos (o cuando el sidebar se recarga), asegurando que los KPIs estén siempre actualizados. Escucha el evento `sidebar:loaded` y limpia timers al salir de la página. Refuerza la reactividad y precisión de la UI.

---

### core/dashboard.js
**Propósito:** KPIs y lógica de dashboard de inicio. Obtiene usuario autenticado, carga leads del mes, ranking, calcula mejores vendedores/equipos, y expone helpers para normalización y análisis. Usa fetch con headers de autenticación, fallback de datos, y procesamiento avanzado de métricas. Modulariza la lógica de inicio y permite extensión fácil.

---

### agentes/js/auth-check.js
**Tipo:** Stub
**Propósito:** Stub para validar sesión de usuario de forma no intrusiva en vistas de agentes. Llama `/api/auth/verify-server` y emite evento `user:authenticated` si el usuario es válido. Permite compatibilidad y pruebas sin lógica invasiva.

---
