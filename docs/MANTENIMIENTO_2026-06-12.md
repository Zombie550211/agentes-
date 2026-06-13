# Informe Técnico de Mantenimiento — CRM Connecting
**Fecha:** 2026-06-12
**Ejecutado por:** Daniel Martinez + Claude Code (Fable 5)
**Rama:** main
**Servidor:** FastAPI + MySQL (Aiven Cloud) · Puerto 8001

---

## 1. Seguridad Crítica

### 1.1 Path traversal en subida de archivos
- **Problema:** En `POST /api/files/upload`, los archivos no-imagen (PDF, audio, video) se guardaban en disco con el nombre `f"{ts}-{file.filename}"`, usando el nombre **enviado por el cliente sin sanitizar**. En Windows, un nombre con `..\..\` permitía escribir archivos fuera de `uploads/files/` (escritura arbitraria en el servidor).
- **Acción:** Nueva función `safe_filename()` que extrae solo el nombre base (neutraliza `/` y `\`), reemplaza caracteres peligrosos por `_` y limita a 200 caracteres. Probada con payloads reales: `..\..\..\windows\evil.exe` → `evil.exe`.
- **Archivos:** `CRM_PYTHON/routers/files.py`

### 1.2 Path traversal de lectura en avatares
- **Problema:** `GET /uploads/avatars/{filename}` y `GET /api/user-avatars/{file_ref}` hacían `_AVATAR_DIR / filename` directamente. En Windows, un nombre con `..%5C` (backslash codificado) escapaba del directorio y permitía **leer archivos arbitrarios del servidor** (ej. el `.env` con secretos).
- **Acción:** Nueva función `_avatar_path()` que resuelve la ruta y verifica con `is_relative_to()` que quede dentro de `uploads/avatars/`. Si intenta escapar, devuelve el SVG de fallback. Probado: `..\..\.env` → bloqueado.
- **Archivos:** `CRM_PYTHON/routers/avatars.py`

### 1.3 XSS almacenado vía /uploads
- **Problema:** Cualquier usuario autenticado podía subir un `.html` o `.svg` con JavaScript. Al servirse desde `/uploads` (mismo origen que la app), el script se ejecutaría con la sesión de quien abriera el enlace — robo de sesión/acciones en su nombre.
- **Acción (defensa en dos capas):**
  1. **Lista blanca de extensiones** (`ALLOWED_DISK_EXTENSIONS`) para todo archivo que vaya a disco: pdf, txt, csv, office (doc/xls/ppt), audio (mp3, wav, ogg, m4a, aac, opus), video (mp4, webm, mov, avi, mkv, 3gp) y comprimidos (zip, rar, 7z). Cualquier otra extensión → `415 Unsupported Media Type`. Aplica en `files.py` y `media.py`.
  2. **Headers de seguridad** en el mount estático `/uploads` (`_UploadsStaticFiles` en `main.py`): `X-Content-Type-Options: nosniff` en todo, y si el content-type es activo (html/svg/javascript/xml) se fuerza `Content-Disposition: attachment` + `application/octet-stream` — el navegador lo descarga en vez de ejecutarlo.
- **Archivos:** `CRM_PYTHON/routers/files.py`, `CRM_PYTHON/routers/media.py`, `CRM_PYTHON/main.py`

### 1.4 Extensión sin sanitizar en media.py
- **Problema:** `_ext()` devolvía la extensión cruda del filename del cliente, que se concatenaba al nombre de archivo en disco.
- **Acción:** Ahora solo acepta extensiones alfanuméricas (regex `\.[a-z0-9]{1,10}`); cualquier otra cosa se descarta.
- **Archivos:** `CRM_PYTHON/routers/media.py`

### 1.5 `GET /api/auth/verify` devolvía 500 siempre
- **Problema:** Llamaba a `verify_server(request)` omitiendo el parámetro `response` obligatorio → `TypeError` en cada petición. Latente (el frontend usa `/verify-server`), pero roto.
- **Acción:** Corregida la firma y la llamada.
- **Archivos:** `CRM_PYTHON/routers/auth.py`

### 1.6 Cookie de sesión — SameSite configurable
- **Problema:** `SameSite=None` fijo en producción (necesario solo porque frontend en Netlify y API en Render viven en dominios distintos) amplía la superficie CSRF de forma permanente.
- **Acción:** Nueva variable de entorno `COOKIE_SAMESITE`. Por defecto mantiene el comportamiento actual (`none` en producción, `lax` en local), así que **no requiere cambios en el deploy**. El día que todo se sirva desde FastAPI en un solo dominio, basta poner `COOKIE_SAMESITE=lax` en el `.env` de producción.
- **Archivos:** `CRM_PYTHON/deps.py`, `CRM_PYTHON/routers/auth.py`

---

## 2. Incidente de seguridad: token de Hugging Face expuesto

- **Hallazgo:** El remoto git `hf` tenía un token de acceso (`hf_aEmb…`) **incrustado en texto plano en la URL** dentro de `.git/config`. El token (`crmconnecting`) tenía rol **write sobre toda la cuenta** zombie55093 — verificado activo contra `https://huggingface.co/api/whoami-v2`.
- **Acciones:**
  1. Eliminado el token de la URL del remoto: `git remote set-url hf https://huggingface.co/spaces/zombie55093/CRM`.
  2. El usuario revocó el token en huggingface.co/settings/tokens — **verificado: la API devuelve 401**.
  3. Creado token nuevo **fine-grained** limitado a lectura/escritura **solo del Space `zombie55093/CRM`** (sin acceso al resto de la cuenta).
- **Operativa futura:** el próximo `git push hf` pedirá credenciales (usuario `zombie55093`, contraseña = token nuevo); Windows las guarda cifradas en el Administrador de credenciales. **Nunca volver a incrustar tokens en URLs de remotos.**

---

## 3. Limpieza del repositorio git (381 MB → 45 MB)

- **Diagnóstico:** `size-pack` de 380.94 MiB para solo 177 archivos versionados. El análisis de blobs (`git rev-list --objects --all`) reveló que el peso estaba en historia muerta: un directorio **`.git.bak/` completo commiteado** (pack interno de 115 MB), videos antiguos de `uploads/` e `images/`, y `js/` raíz — nada de eso existe en HEAD. La mayor parte vivía en la rama divergente `claude/objective-blackburn-e3ef61` y en `feat/estadisticas-equipos`.
- **Procedimiento:**
  1. **Backup completo** de todas las ramas: `git bundle create dashboard-backup-2026-06-12.bundle --all` (344 MB, en `Documents/`). Restaurable con `git clone dashboard-backup-2026-06-12.bundle`.
  2. Resguardo de los archivos con cambios sin commitear (el filtrado hace reset duro).
  3. Eliminado el worktree obsoleto `.claude/worktrees/objective-blackburn-e3ef61` y su rama.
  4. Creada rama local `master` desde `origin/master` para que también se reescribiera.
  5. `git filter-repo --invert-paths` sobre: `.git.bak`, `uploads`, `images`, `js`, `node_modules`, `backups`, `db-backups`, `exports`, `archive`, `scripts`, `licencia/node_modules`.
  6. Reconectados los remotos y **force-push** a `feat/estadisticas-equipos` y `master`. `main` no cambió de hash (su historia ya estaba limpia, el deploy no se vio afectado).
  7. Restaurados los cambios pendientes y verificado `import main` OK.
- **Resultado:** 380.94 MiB → **45.25 MiB** (−88 %). Clones nuevos bajan ~45 MB en vez de ~380 MB.
- **Nota:** quien tenga un clon viejo del repo debe clonar de nuevo (la historia de `feat/estadisticas-equipos` y `master` cambió).

---

## 4. Mantenimiento general

### 4.1 `requirements.txt` depurado
- **Antes:** 74 líneas mezclando dependencias reales, transitivas, herramientas de desarrollo y restos de la era MongoDB (`motor`, `pymongo`, `nltk`, `passlib`, `Authlib`…).
- **Acción:** Verificados los imports reales del código; reescrito con solo las **14 dependencias top-level** que la app usa (pip resuelve las transitivas). `bandit` y `safety` movidos a un nuevo `requirements-dev.txt` (no van a producción).
- **Nota:** los scripts históricos de migración Mongo→MySQL en `CRM_PYTHON/scripts/` necesitarían `motor` si alguna vez se re-ejecutan (ya cumplieron su función).
- **Archivos:** `CRM_PYTHON/requirements.txt`, `CRM_PYTHON/requirements-dev.txt` (nuevo)

### 4.2 Migraciones duplicadas eliminadas
- **Problema:** 6 sentencias `CREATE INDEX` aparecían dos veces en `_MIGRATIONS` (main.py) — fallaban silenciosamente en cada arranque ensuciando los logs.
- **Acción:** Eliminado el bloque duplicado.
- **Archivos:** `CRM_PYTHON/main.py`

### 4.3 `.gitignore` — cobertura de `.venv`
- **Problema:** Solo ignoraba `CRM_PYTHON/venv/`; el venv real está en `CRM_PYTHON/.venv/` y se salvaba únicamente por el `.gitignore` interno que crea el propio venv (frágil).
- **Acción:** Añadidos `venv/`, `.venv/`, `CRM_PYTHON/.venv/`.

### 4.4 Limpieza de restos locales
- Eliminados `scripts/.env.temp` (contenía un `MONGO_URI` local), `scripts/node_modules/` y la carpeta `scripts/` vacía de la raíz (restos de la era Node/Mongo, no versionados).

### 4.5 Renombrado de variable engañosa
- `_RESET_EXPIRY_MS` → `_RESET_EXPIRY_SECS` en auth.py (guardaba segundos, no milisegundos).

---

## 5. Verificaciones realizadas

| Verificación | Resultado |
|---|---|
| `py_compile` de los 6 módulos editados | ✅ |
| `import main` (app completa) tras cada tanda de cambios | ✅ |
| Test de sanitizadores con payloads de traversal reales | ✅ bloqueados |
| Token HF viejo contra la API | ✅ 401 (revocado) |
| Push a GitHub de ramas reescritas | ✅ |
| Dockerfile / render.yaml (usan `requirements.txt`) | ✅ sin cambios necesarios |

---

## 6. Pendientes

1. **Commit de los fixes** — los 9 archivos modificados están en el working tree sin commitear, a la espera de prueba funcional del CRM en local (especialmente subida de archivos e imágenes a leads).
2. **Borrar el backup** `Documents/dashboard-backup-2026-06-12.bundle` (344 MB) cuando se confirme que todo funciona tras unos días.
3. **`MYSQL_SSL_CA` sigue sin configurar** (pendiente desde el informe del 2026-06-02): la conexión a Aiven acepta cualquier certificado. Descargar el CA cert desde Aiven Console y configurar `MYSQL_SSL_CA` en `.env`.
4. Si algún día frontend y API se sirven desde el mismo dominio: poner `COOKIE_SAMESITE=lax` en producción.
