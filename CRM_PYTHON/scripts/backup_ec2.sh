#!/usr/bin/env bash
# Backup de la BD pensado para ejecutarse DENTRO del EC2 (crm-connecting-backend),
# no en un portátil. Sustituye a backup_cron.sh + backup_db.py para producción.
#
# Por qué existe:
#   - El EC2 vive en la misma VPC que la RDS, así que no hace falta túnel SSH ni
#     que la máquina de nadie esté encendida a las 03:00.
#   - Usa mysqldump, que hace streaming nativo. backup_db.py recorre las filas
#     desde Python y arma los INSERT a mano: con la tabla note_files (LONGBLOB con
#     los adjuntos, ~300 MB) se quedó colgado consumiendo 228 MB de RAM sin
#     avanzar un solo byte en 20 minutos.
#   - Sube el dump a S3 cifrado, de modo que el respaldo no viva en el mismo disco
#     que puede fallar.
#
# Requisitos en el EC2 (el script los verifica y aborta con un mensaje claro):
#   sudo apt-get install -y mysql-client awscli
#   Un rol IAM en la instancia con permiso s3:PutObject sobre el bucket (preferible
#   a poner claves en el archivo), y el bucket creado con versionado activado.
#
# Instalación en el EC2:
#   1. Copiar este script a /opt/crm/backup_ec2.sh y `chmod +x`.
#   2. Crear /opt/crm/backup.env con permisos 600:
#        MYSQL_HOST=crm-connecting-db.cjcggw26guwj.us-east-2.rds.amazonaws.com
#        MYSQL_USER=...
#        MYSQL_PASSWORD=...
#        MYSQL_DB=crm_connecting
#        S3_BUCKET=s3://mi-bucket-backups-crm
#   3. Programarlo:
#        0 3 * * * /opt/crm/backup_ec2.sh >> /var/log/crm-backup.log 2>&1

set -uo pipefail

# Fuente de credenciales. Por defecto se reutiliza el .env que ya usa el backend:
# así hay UNA sola copia de la contraseña en la máquina, y si algún día se rota no
# queda un segundo archivo desincronizado que haga fallar el backup en silencio.
APP_ENV="${APP_ENV_FILE:-/home/ubuntu/app/CRM_PYTHON/.env}"
ENV_FILE="${BACKUP_ENV_FILE:-/opt/crm/backup.env}"   # opcional, tiene prioridad
BACKUP_DIR="${BACKUP_DIR:-/var/backups/crm}"
KEEP="${BACKUP_KEEP:-7}"          # copias locales; en S3 la retención la lleva el versionado
FECHA="$(date +%Y%m%d-%H%M%S)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

fallo() { log "ERROR: $*"; exit 1; }

# ── Comprobaciones previas ───────────────────────────────────────
command -v mysqldump >/dev/null || fallo "falta mysqldump — sudo apt-get install -y mysql-client"

if [[ -f "${ENV_FILE}" ]]; then
  # shellcheck source=/dev/null
  source "${ENV_FILE}"
elif [[ -f "${APP_ENV}" ]]; then
  # Deriva host/usuario/clave/base desde MYSQL_URL del backend. Se parsea con
  # python3 y no con `cut`, para no romperse si la contraseña lleva ':', '@' o
  # caracteres percent-encoded.
  eval "$(
    APP_ENV="${APP_ENV}" python3 - <<'PY'
import os, re, shlex, urllib.parse
ruta = os.environ["APP_ENV"]
url = ""
with open(ruta, encoding="utf-8", errors="ignore") as fh:
    for linea in fh:
        if linea.startswith("MYSQL_URL"):
            url = linea.split("=", 1)[1].strip().strip('"').strip("'")
            break
if not url:
    raise SystemExit("echo 'ERROR: no hay MYSQL_URL en el .env del backend'; exit 1")
url = re.sub(r"^[a-z+]+://", "//", url)
p = urllib.parse.urlsplit(url)
d = urllib.parse.unquote
print(f"MYSQL_HOST={shlex.quote(p.hostname or '')}")
print(f"MYSQL_PORT={p.port or 3306}")
print(f"MYSQL_USER={shlex.quote(d(p.username or ''))}")
print(f"MYSQL_PASSWORD={shlex.quote(d(p.password or ''))}")
print(f"MYSQL_DB={shlex.quote((p.path or '/').lstrip('/').split('?')[0])}")
PY
  )"
else
  fallo "no hay credenciales: falta ${ENV_FILE} y tampoco existe ${APP_ENV}"
fi

: "${MYSQL_HOST:?no se pudo determinar MYSQL_HOST}"
: "${MYSQL_USER:?no se pudo determinar MYSQL_USER}"
: "${MYSQL_PASSWORD:?no se pudo determinar MYSQL_PASSWORD}"
: "${MYSQL_DB:?no se pudo determinar MYSQL_DB}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

mkdir -p "${BACKUP_DIR}" || fallo "no se pudo crear ${BACKUP_DIR}"

# El dump es una copia íntegra de los datos de clientes: que nazca en 600 y no en
# el 644 que dejaría el umask por defecto.
umask 077

DESTINO="${BACKUP_DIR}/crm-backup-${FECHA}.sql.gz"

log "=== backup de ${MYSQL_DB} en ${MYSQL_HOST}"

# ── Volcado ──────────────────────────────────────────────────────
# --single-transaction: consistente sin bloquear escrituras (InnoDB).
# --quick: no carga la tabla entera en memoria antes de escribir — es justo lo que
#          hacía fallar al script Python con note_files.
# --set-gtid-purged=OFF: evita un dump que al restaurar intente fijar GTIDs.
# La contraseña va por MYSQL_PWD y no como argumento, para que no aparezca en `ps`.
MYSQL_PWD="${MYSQL_PASSWORD}" mysqldump \
  --host="${MYSQL_HOST}" \
  --port="${MYSQL_PORT}" \
  --user="${MYSQL_USER}" \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  --default-character-set=utf8mb4 \
  --ssl-mode=REQUIRED \
  "${MYSQL_DB}" 2>/tmp/crm-backup-err.$$ | gzip -6 > "${DESTINO}"

# PIPESTATUS[0] es mysqldump: sin esto, un fallo suyo pasaría desapercibido porque
# gzip terminaría con éxito produciendo un .gz válido pero vacío.
# Se copia el array COMPLETO en una sola sentencia: leer PIPESTATUS[0] en una
# asignación ya lo resetea, y el acceso posterior a PIPESTATUS[1] reventaba con
# "unbound variable" por el `set -u`.
ESTADOS=("${PIPESTATUS[@]}")
ESTADO_DUMP=${ESTADOS[0]}
ESTADO_GZIP=${ESTADOS[1]:-0}

if [[ ${ESTADO_DUMP} -ne 0 ]]; then
  log "mysqldump falló (código ${ESTADO_DUMP}):"
  sed 's/^/    /' /tmp/crm-backup-err.$$ | head -20
  rm -f /tmp/crm-backup-err.$$ "${DESTINO}"
  exit 1
fi
[[ ${ESTADO_GZIP} -ne 0 ]] && { rm -f /tmp/crm-backup-err.$$ "${DESTINO}"; fallo "gzip falló (${ESTADO_GZIP})"; }
rm -f /tmp/crm-backup-err.$$

TAMANO=$(stat -c%s "${DESTINO}")
# Un dump real de esta base ronda los cientos de MB; por debajo de 1 MB es sospechoso.
[[ ${TAMANO} -lt 1048576 ]] && fallo "el dump pesa sólo ${TAMANO} bytes — sospechoso, revisar"

log "dump OK: $(basename "${DESTINO}") — $(( TAMANO / 1048576 )) MB"

# ── Verificación de integridad ───────────────────────────────────
# Que el .gz esté completo y contenga CREATE TABLE: descubre un dump truncado
# ahora y no el día que haya que restaurarlo.
gzip -t "${DESTINO}" || fallo "el archivo .gz está corrupto"
# El subshell desactiva pipefail a propósito: `head -c` cierra el pipe en cuanto
# tiene sus bytes, zcat muere con SIGPIPE (141) y con pipefail activo el pipeline
# devolvería error AUNQUE grep sí hubiera encontrado el patrón. Sin esto, la
# comprobación da un falso negativo y tira por tierra un dump que está perfecto.
if ! ( set +o pipefail; zcat "${DESTINO}" 2>/dev/null | head -c 2000000 | grep -q "CREATE TABLE" ); then
  fallo "el dump no contiene CREATE TABLE — contenido inesperado"
fi
log "integridad verificada (gzip OK + CREATE TABLE presente)"

# ── Subida a S3 ──────────────────────────────────────────────────
if [[ -n "${S3_BUCKET:-}" ]]; then
  if command -v aws >/dev/null; then
    log "subiendo a ${S3_BUCKET}"
    if aws s3 cp "${DESTINO}" "${S3_BUCKET}/$(basename "${DESTINO}")" \
         --sse AES256 --only-show-errors; then
      log "subida OK"
    else
      # No abortamos: la copia local ya existe y es mejor que nada.
      log "AVISO: falló la subida a S3 — la copia local queda en ${DESTINO}"
    fi
  else
    log "AVISO: falta awscli, no se sube a S3 — sudo apt-get install -y awscli"
  fi
else
  log "AVISO: S3_BUCKET no definido — el respaldo sólo queda en disco local"
fi

# ── Rotación local ───────────────────────────────────────────────
mapfile -t ANTIGUOS < <(ls -1t "${BACKUP_DIR}"/crm-backup-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)))
for viejo in "${ANTIGUOS[@]:-}"; do
  [[ -n "${viejo}" ]] || continue
  rm -f "${viejo}" && log "rotado: $(basename "${viejo}")"
done

log "=== backup completado"
