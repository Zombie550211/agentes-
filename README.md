# CRM Connecting

CRM interno de Connecting para agentes, supervisores, Back Office y administración:
ventas residenciales y de Líneas, comisiones, ranking, horarios, monitoreo,
transferencias, facturación, chat, tickets y estadísticas, con permisos por rol.

## Tecnología

| Parte | Qué usa |
|---|---|
| Backend | Python 3.12 + **FastAPI** (`CRM_PYTHON/`), SQLAlchemy async + MySQL |
| Frontend | HTML, CSS y JavaScript sin framework (`frontend/`), servido por el mismo backend |
| Tiempo real | Server-Sent Events (`/api/stream`) |
| Producción | EC2 (Ubuntu) + nginx + systemd, base de datos en Amazon RDS (MySQL) |

## Estructura

```
CRM_PYTHON/
  main.py              app FastAPI: middlewares, cabeceras de seguridad, registro de routers
  routers/             un archivo por módulo de la API (leads, lineas, auth, horarios…)
  deps.py              sesión (JWT en cookie httponly) — fuente única
  rbac.py              roles y permisos (acciones en código, asignación en la BD)
  scoring.py           puntajes por servicio
  estado_comision.py   status de comisión y sus grupos
  tests/               pruebas automáticas (pytest)
  scripts/             migraciones, respaldos, despliegue (scripts/deploy/)
frontend/              páginas HTML, js/, css/, imágenes
docs/                  notas de mantenimiento
```

## Arrancar en local

Requisitos: Python 3.12+ y, para la base de datos local, Docker.

```bash
cd CRM_PYTHON
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt -r requirements-dev.txt   # Windows
# .venv/bin/pip install -r requirements.txt -r requirements-dev.txt     # Linux/Mac
```

- **Con la BD local (recomendado):** crear el contenedor una vez con
  `bash CRM_PYTHON/scripts/init_local_db.sh` y luego `./iniciar-local.sh`.
  Usa `CRM_PYTHON/.env.local` y se niega a arrancar si la URL no apunta al MySQL local.
- **Windows:** `iniciar-servidor.bat` o `iniciar-servidor.ps1`.

El CRM queda en <http://localhost:8001> (solo en este equipo; para abrirlo desde
otro dispositivo: `CRM_HOST=0.0.0.0`). La documentación de la API está en `/py-docs`
fuera de producción.

### Variables de entorno (`CRM_PYTHON/.env`, nunca se sube al repo)

| Variable | Para qué |
|---|---|
| `JWT_SECRET` | **Obligatoria.** Firma de las sesiones. `python -c "import secrets; print(secrets.token_hex(32))"` |
| `MYSQL_URL` | Conexión a MySQL |
| `NODE_ENV=production` | Activa el modo producción (cookies `secure`, sin `/py-docs`, HSTS) |
| `CORS_ORIGINS` | Orígenes permitidos |
| `CRM_DATA_KEY` | Cifrado de datos sensibles |
| `EMAIL_*`, `SMTP_*` | Correo de recuperación de contraseña |
| `CLOUDINARY_*` | Imágenes y avatares |
| `CUADRATURA_*` | Integración con el sistema de cuadratura |

## Pruebas

```bash
cd CRM_PYTHON
python -m pytest
```

No necesitan base de datos. Cubren contraseñas, sesiones, validaciones anti-XSS,
status de comisión, puntajes, permisos por rol y que **ninguna ruta `/api`
entregue datos sin sesión** (`tests/test_rutas.py`: si agregas un endpoint público
a propósito, anótalo en `PUBLICAS`).

## Despliegue

Automático: el EC2 revisa `main` cada minuto (`scripts/deploy/auto_desplegar.sh`).
Antes de publicar comprueba que el Python compila y **corre las pruebas**; si algo
falla, no despliega y avisa por correo. Cada despliegue guarda un punto de retorno
y vuelve atrás solo si el servicio no responde.

> Todo lo que se sube a `main` llega a producción en ~1 minuto. Trabaja en ramas y
> corre `python -m pytest` antes de fusionar.

El CI de GitHub (`.github/workflows/comprobar.yml`) revisa la sintaxis y corre las
pruebas en cada push.
