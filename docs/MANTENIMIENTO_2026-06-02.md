# Informe Técnico de Mantenimiento — CRM Connecting
**Fecha:** 2026-06-02  
**Ejecutado por:** Daniel Martinez + Claude Code (Sonnet 4.6)  
**Rama:** main  
**Servidor:** FastAPI + MySQL (Aiven Cloud) · Puerto 8001

---

## 1. Seguridad Crítica

### 1.1 Credenciales MongoDB eliminadas del `.env`
- **Problema:** `MONGODB_URI` y `MONGO_DETAILS` estaban en el `.env` con credenciales reales. MongoDB solo era usado por scripts de migración ya ejecutados — ningún router activo lo importaba.
- **Acción:** Eliminadas ambas variables de `CRM_PYTHON/.env`. También se eliminaron `ANTHROPIC_API_KEY` (vacía) y `TLS_INSECURE=1`.
- **Archivos:** `CRM_PYTHON/.env`

### 1.2 SSL de base de datos MySQL — verificación condicional
- **Problema:** `database_mysql.py` usaba `ssl.CERT_NONE` — aceptaba cualquier certificado, vulnerable a ataques MITM.
- **Acción:** Implementación condicional. Si `MYSQL_SSL_CA` está configurado, activa `CERT_REQUIRED + check_hostname`. Si no, advierte en consola.
- **Pendiente del operador:** Descargar CA cert desde Aiven Console → Overview → "Download CA cert" y configurar `MYSQL_SSL_CA=/ruta/ca.pem` en `.env`.
- **Archivos:** `CRM_PYTHON/database_mysql.py`

### 1.3 JWT_SECRET — eliminado default débil
- **Problema:** Ambos `deps.py` y `auth.py` tenían `os.getenv("JWT_SECRET", "tu_clave_secreta_super_segura")`. Si la variable no existía, el servidor arrancaba con un secret predecible.
- **Acción:** El servidor ahora lanza `RuntimeError` explícito si `JWT_SECRET` no está configurado.
- **Generar secret:** `python -c "import secrets; print(secrets.token_hex(32))"`
- **Archivos:** `CRM_PYTHON/deps.py`, `CRM_PYTHON/routers/auth.py`

### 1.4 Token de sesión — eliminado de localStorage
- **Problema:** `fetch-interceptor.js` leía `localStorage.getItem('token')` para agregar un header `Authorization: Bearer`. Era código muerto — nada en el frontend escribía ese token — pero representaba un vector XSS potencial.
- **Acción:** Eliminada la lectura de localStorage. Agregado `credentials: 'include'` en todas las peticiones fetch para enviar la cookie httpOnly automáticamente.
- **Archivos:** `frontend/js/fetch-interceptor.js`

### 1.5 Token en login.js — eliminado storage del token
- **Problema:** `login.html` guardaba `data.token` en `localStorage`/`sessionStorage` tras el login exitoso.
- **Acción:** Eliminado `storage.setItem('token', ...)`. Solo se guarda `user` (info de display). La autenticación opera exclusivamente por cookie httpOnly.
- **Archivos:** `frontend/js/login.js`

---

## 2. Seguridad Alta

### 2.1 Rate Limiting — instalado slowapi 0.1.9
- **Problema:** Los endpoints de autenticación no tenían protección contra ataques de fuerza bruta.
- **Acción:** Instalado `slowapi==0.1.9`. Configurado `Limiter` en `CRM_PYTHON/limiter.py` y registrado en `main.py`.
- **Límites aplicados:**

| Endpoint | Límite | Propósito |
|----------|--------|-----------|
| `POST /api/auth/login` | **3/minuto** por IP | Fuerza bruta de contraseñas |
| `POST /api/auth/forgot-password` | 5/minuto por IP | Spam de códigos |
| `POST /api/auth/verify-reset-code` | 10/minuto por IP | Adivinar códigos |
| `POST /api/auth/reset-password` | 5/minuto por IP | Intentos de reset |

- **Respuesta al superar límite:** `429 Too Many Requests`
- **Archivos:** `CRM_PYTHON/limiter.py`, `CRM_PYTHON/main.py`, `CRM_PYTHON/routers/auth.py`, `CRM_PYTHON/requirements.txt`

### 2.2 SMTP — eliminado fallback hardcodeado a Gmail
- **Problema:** Si `SMTP_HOST` no estaba configurado, el servidor usaba `smtp.gmail.com` silenciosamente como fallback, sin credenciales correctas.
- **Acción:** Si `SMTP_HOST` no está configurado, `_send_email()` lanza `RuntimeError` explícito.
- **Variables requeridas en `.env`:** `SMTP_HOST`, `SMTP_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`
- **Archivos:** `CRM_PYTHON/routers/auth.py`

### 2.3 Sesión — reducida a 30 minutos
- **Antes:** JWT con expiración de 7 días.
- **Acción:** `JWT_EXPIRES = 30 * 60` (30 minutos). El frontend ya tenía `inactivity-manager.js` configurado a 30 minutos (aviso a los 25, logout a los 30). Backend y frontend ahora están alineados.
- **Archivos:** `CRM_PYTHON/routers/auth.py`

### 2.4 Audit Log — implementado
- **Acción:** Nuevo módulo `CRM_PYTHON/audit.py`. Log rotativo diario en `logs/audit.log` (retención 30 días). Formato JSON por línea.
- **Eventos registrados:**

| Evento | Trigger |
|--------|---------|
| `LOGIN_OK` | Login exitoso |
| `LOGIN_FAIL` | Credenciales incorrectas o cuenta suspendida |
| `LOGOUT` | Cierre de sesión |
| `PASSWORD_RESET_REQUEST` | Solicitud de código de recuperación |
| `PASSWORD_RESET_OK` | Contraseña cambiada exitosamente |

- **Formato de entrada:**
```json
{"ts": "2026-06-02T18:09:42Z", "action": "LOGIN_OK", "username": "LUIS G", "ip": "127.0.0.1"}
```
- **Archivos:** `CRM_PYTHON/audit.py`, `CRM_PYTHON/routers/auth.py`, `.gitignore`

---

## 3. Mantenimiento y Deuda Técnica

### 3.1 Scripts de migración — reorganizados
- **Antes:** 6 scripts de migración en la raíz de `CRM_PYTHON/`.
- **Acción:** Movidos a `CRM_PYTHON/scripts/`.
- **Archivos movidos:**
  - `migrate_mongo_to_mysql.py`
  - `migrate_media_to_mysql.py`
  - `migrate_facturacion.py`
  - `check_gridfs.py`
  - `check_lineas.py`
  - `add_active_col.py`
  - `migrate.py`

### 3.2 Migraciones DML extraídas de main.py
- **Problema:** 8 `UPDATE` masivos sobre tablas `leads`, `lineas_clientes` y `users` corrían en cada arranque del servidor, aunque los datos ya estaban normalizados.
- **Acción:** Solo quedan en `_MIGRATIONS` las migraciones DDL idempotentes (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`). Los `UPDATE` se movieron a `CRM_PYTHON/scripts/data_migrations.py` como referencia histórica.
- **Archivos:** `CRM_PYTHON/main.py`, `CRM_PYTHON/scripts/data_migrations.py`

### 3.3 Archivos `.env` unificados
- **Antes:** Dos archivos `.env` idénticos — uno en la raíz del proyecto (legacy Node.js) y otro en `CRM_PYTHON/`.
- **Acción:** Eliminado el `.env` de la raíz. Fuente única: `CRM_PYTHON/.env`.
- **render.yaml:** Limpiado de `MONGODB_URI`. Agregadas variables `SMTP_HOST`, `EMAIL_USER`, `EMAIL_PASS`.

### 3.4 login.html — reducido de 66 KB a 12 KB
- **Acción:** CSS e JS extraídos a archivos independientes.

| Archivo | Tamaño | Contenido |
|---------|--------|-----------|
| `frontend/login.html` | 12 KB | Solo HTML estructural |
| `frontend/css/login.css` | 16 KB | Todos los estilos |
| `frontend/js/login.js` | 21 KB | Lógica completa |

- **Mejoras adicionales en login.js:**
  - `preheatPages()` ahora usa `credentials: 'include'` (cookies) en lugar de `Authorization: Bearer`
  - Eliminado `storage.setItem('token', ...)` — código muerto

### 3.5 Directorio accidental `nano ~` — eliminado
- Directorio creado accidentalmente al ejecutar `nano ~/` en terminal Windows.

### 3.6 `node_modules/` legacy — eliminado
- Dependencias del servidor Node.js anterior (~100 MB). No había `package.json` activo en la raíz. El servidor corre exclusivamente en Python/FastAPI.

### 3.7 Archivos temporales eliminados

| Archivo | Razón |
|---------|-------|
| `fix_costumer_encoding.ps1` | Script one-time de encoding |
| `equipos.html` (raíz) | Página huérfana sin referencias |
| `CRM_PYTHON/check_tables.py` | Script one-time de verificación |
| `CRM_PYTHON/descargar_avatares.py` | Script one-time de descarga |
| `CRM_PYTHON/models.py` | Archivo vacío, no importado |
| `CRM_PYTHON/database.py` | Módulo MongoDB legacy, no importado |

---

## 4. Estructura Final del Proyecto

```
dashboard/
├── CRM_PYTHON/
│   ├── main.py                  # Solo DDL migrations al arranque
│   ├── audit.py                 # Audit log (NUEVO)
│   ├── limiter.py               # Rate limiting slowapi (NUEVO)
│   ├── deps.py                  # JWT sin default débil
│   ├── database_mysql.py        # SSL condicional con CA cert
│   ├── run.py
│   ├── requirements.txt         # + slowapi==0.1.9
│   ├── .env                     # Fuente única de env vars
│   ├── routers/
│   │   ├── auth.py              # Rate limits + audit + SMTP fix + JWT 30min
│   │   └── [22 routers más]
│   └── scripts/                 # Scripts one-time (REORGANIZADO)
│       ├── data_migrations.py
│       ├── migrate.py
│       ├── migrate_mongo_to_mysql.py
│       ├── migrate_media_to_mysql.py
│       ├── migrate_facturacion.py
│       ├── check_gridfs.py
│       ├── check_lineas.py
│       └── add_active_col.py
├── frontend/
│   ├── login.html               # 12 KB (antes 66 KB)
│   ├── css/
│   │   └── login.css            # NUEVO — estilos login
│   ├── js/
│   │   ├── login.js             # NUEVO — lógica login
│   │   └── fetch-interceptor.js # Sin localStorage, con credentials:include
│   └── [resto del frontend]
├── logs/
│   └── audit.log                # Rotación diaria, 30 días retención
├── docs/
│   └── MANTENIMIENTO_2026-06-02.md  # Este archivo
├── render.yaml                  # Sin MONGODB_URI, con SMTP vars
├── CLAUDE.md
└── .gitignore                   # + logs/ y CRM_PYTHON/logs/
```

---

## 5. Pendientes del Operador

| Tarea | Prioridad | Instrucción |
|-------|-----------|-------------|
| Configurar CA cert SSL MySQL | Alta | Descargar desde Aiven Console → Overview → "Download CA cert". Agregar `MYSQL_SSL_CA=/ruta/ca.pem` en `.env` |
| Generar JWT_SECRET seguro | Alta | `python -c "import secrets; print(secrets.token_hex(32))"` y reemplazar en `.env` |
| Configurar SMTP | Media | Agregar `SMTP_HOST`, `SMTP_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM` en `.env` para que funcione la recuperación de contraseña |

---

## 6. Dependencias Nuevas

| Paquete | Versión | Propósito |
|---------|---------|-----------|
| `slowapi` | 0.1.9 | Rate limiting en endpoints de auth |
| `limits` | 5.8.0 | Dependencia de slowapi |
| `deprecated` | 1.3.1 | Dependencia de limits |
| `wrapt` | 2.2.1 | Dependencia de deprecated |
