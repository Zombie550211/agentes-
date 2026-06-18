# Informe Técnico de Mantenimiento — CRM Connecting
**Fecha:** 2026-06-18
**Ejecutado por:** Daniel Martinez
**Rama:** main
**Servidor:** FastAPI + MySQL (Aiven Cloud) · Puerto 8001

> Origen: análisis "Buenos días Code". Se aplicaron los puntos críticos de seguridad,
> luego mejoras de mantenibilidad y, por último, mantenimiento. Todo validado
> (import/sintaxis, `node --check`, y prueba en vivo de migraciones contra Aiven).

---

## 1. Seguridad (crítico)

### 1.1 Path traversal en el servidor de páginas HTML
- **Problema:** El catch-all `serve_page` (y `find_html`) construía la ruta con `d / page`
  y comprobaba `is_file()` **sin validar contención**. Una petición con `../` o ruta
  absoluta (p. ej. `../CRM_PYTHON/.env`) podía leer archivos fuera de `frontend/`.
- **Acción:** Nuevo helper `_resolve_within(base, rel)` que resuelve la ruta y exige
  `is_relative_to(base)`; si se sale, devuelve `None`. Aplicado en `serve_page` y `find_html`.
- **Verificado:** `login.html` y `lineas/costumer.html` siguen sirviéndose; `../CRM_PYTHON/.env`,
  `../../etc/passwd` y rutas absolutas → **bloqueados**.
- **Archivos:** `CRM_PYTHON/main.py`

### 1.2 Operaciones destructivas de Líneas sin control de rol
- **Problema:** `DELETE /api/lineas-team/delete` solo exigía estar autenticado → **cualquier
  agente podía borrar** registros de clientes. Igual sin control: `update`, `status`,
  `line-status` y edición/borrado de notas (IDOR: un agente podía modificar registros/notas
  de otro).
- **Acción:**
  - **DELETE** → restringido a **admin/backoffice** (decisión del usuario; igual que residencial).
  - **update / status / line-status** → helper `_ensure_can_modify()` con la regla
    *"lo que ves = lo que puedes editar"* (admin/BO: todo; supervisor: su equipo; agente:
    solo lo suyo), reutilizando `_user_scope_clause()` como **fuente única** alineada con el
    listado `GET /api/lineas-team`. Se incluyó `/update` porque si no, el límite de `/status`
    se saltaría por ahí.
  - **notas edit/delete** → solo el **autor** de la nota o admin/BO.
- **Archivos:** `CRM_PYTHON/routers/lineas.py`

### 1.3 Documentación interactiva expuesta en producción
- **Problema:** `docs_url="/py-docs"` quedaba activo siempre (expone el esquema completo de la API).
- **Acción:** `docs_url`, `redoc_url` y `openapi_url` → `None` cuando `NODE_ENV=production`.
  En desarrollo siguen en `/py-docs`.
- **Archivos:** `CRM_PYTHON/main.py`

### 1.4 Verificación TLS de MySQL desactivada sin CA
- **Problema:** Sin `MYSQL_SSL_CA`, la conexión usaba `CERT_NONE` + `check_hostname=False`
  (cifrada pero vulnerable a MITM).
- **Acción:** En `NODE_ENV=production` **se aborta el arranque** si falta `MYSQL_SSL_CA`.
  En desarrollo mantiene el aviso.
- **Archivos:** `CRM_PYTHON/database_mysql.py`

---

## 2. Mantenibilidad

### 2.1 Lógica de autenticación unificada
- **Problema:** `current_user`, `require_roles`, creación/decodificación de token y la config
  JWT/cookie estaban **duplicadas** en `deps.py` (lo que importan los 22 routers) y en
  `auth.py`. Cambiar `JWT_EXPIRES`/`COOKIE_SAMESITE` en un sitio y olvidar el otro divergía
  el comportamiento de sesión.
- **Acción:** `deps.py` es ahora la **fuente única** (config + `make_token`, `decode_token`,
  `set_token_cookie`, `current_user`, `require_roles`, `ADMIN_ROLES`). `auth.py` importa todo
  de `deps` (con alias para no tocar el resto del código). Eliminadas ~63 líneas duplicadas.
- **Verificado:** `auth.current_user is deps.current_user` (mismo objeto), token round-trip OK.
- **Archivos:** `CRM_PYTHON/deps.py`, `CRM_PYTHON/routers/auth.py`

### 2.2 `datetime.utcnow()` deprecado
- **Problema:** Deprecado desde Python 3.12 (el proyecto corre 3.14).
- **Acción:** Helper `_utcnow()` → `datetime.now(timezone.utc).replace(tzinfo=None)` (UTC
  *naive*, idéntico a lo que devuelve MySQL; no rompe las comparaciones del flujo de reset).
  12 llamadas migradas.
- **Pendiente:** 18 routers más aún usan `datetime.utcnow()` (fuera de alcance de esta sesión).
- **Archivos:** `CRM_PYTHON/routers/auth.py`, `CRM_PYTHON/routers/lineas.py`

### 2.3 Limpieza de `console.log` en el frontend
- **Problema:** ~84 `console.log/info/debug` de depuración en `frontend/lineas/` y `frontend/js/`
  (ruido y posible exposición de datos en la consola del navegador).
- **Acción:** **83 eliminados**; **138 `console.error/warn` conservados** (útiles). Método seguro:
  tokenizador JS (respeta strings/plantillas/comentarios/regex, balancea paréntesis) + validación
  con `node --check` antes/después. `comisiones.html` (React/JSX vía Babel) se trató con borrado
  por línea completa. Casos especiales preservados (p. ej. inline con `return`).
- **Archivos:** `frontend/lineas/{estadisticas,costumer,comisiones,llamadas-ventas}.html`,
  `frontend/js/realtime.js`, `frontend/js/core/dashboard.js`

---

## 3. Mantenimiento

### 3.1 Control de versión de esquema (migraciones DDL)
- **Problema:** Las ~34 migraciones DDL corrían y **fallaban con "ya existe" en cada arranque**
  (logs sucios + arranque más lento).
- **Acción:** Cada migración lleva **nombre estable** y se registra en una tabla nueva
  `schema_migrations`. `_run_migrations()` ejecuta **solo las pendientes**; si un DDL falla por
  "ya existe" se marca como aplicada, y si falla por una razón real no se registra (se reintenta).
- **Verificado en vivo (Aiven):** primer arranque `34/34` registradas; segundo arranque **0
  pendientes** (ya no se re-ejecutan).
- **Archivos:** `CRM_PYTHON/main.py`

### 3.2 Auditoría de dependencias (bandit + safety)
- **bandit:** 51 MEDIUM (todas B608) = **falsos positivos** verificados (f-strings con nombre de
  tabla/placeholder generados por código; los valores siempre van enlazados). 35 LOW = `try/except/pass`
  intencionales + `random` no-cripto. Sin hallazgos reales.
- **safety:** **`aiomysql 0.2.0` → CVE-2025-62611** (info disclosure vía `local_infile`; relevante
  con MySQL remoto). El `.venv` ya corría 0.3.2, pero `requirements.txt` pineaba 0.2.0 → un deploy
  habría **degradado a la versión vulnerable**.
  - **Acción:** `aiomysql==0.3.2` y `Pillow==12.2.0` (antes sin pinear) en `requirements.txt`.
    Resultado: **safety → 0 vulnerabilidades**.
- **Archivos:** `CRM_PYTHON/requirements.txt`

### 3.3 Backups
- Revisado: `backups/` (1.9 MB) son 3 archivos estáticos del 5-ene (snapshot puntual, no crece),
  bien ignorados en git. Sin acción.

---

## 4. Estado

- **Validación:** import/sintaxis de todos los módulos, `node --check` del frontend, prueba en
  vivo de migraciones contra Aiven. **No** se ejecutó QA funcional completo (login real, respuestas
  403 reales) — recomendado probar tras el deploy.
- **Commit/push:** commiteado y pusheado a `origin` (GitHub) a petición del usuario.
