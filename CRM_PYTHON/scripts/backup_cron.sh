#!/usr/bin/env bash
# Wrapper del backup diario para cron. Reemplaza a la línea suelta que había en el
# crontab, que se rompió dos veces por el mismo motivo: rutas absolutas escritas a mano.
#
#   1. Las rutas se derivan de la ubicación de ESTE archivo, así que mover o renombrar
#      la carpeta del proyecto ya no rompe el backup (antes: "CRM DANIEL COPIA PA FUNAR"
#      → "Proyectos" dejó el cron apuntando a un directorio inexistente y, como el `cd`
#      fallaba antes del `&&`, ni siquiera quedaba rastro en el log).
#   2. Levanta el túnel SSH a la RDS privada si hace falta. backup_db.py se conecta a
#      127.0.0.1:3308, que sólo existe mientras el túnel está abierto; en cron nunca lo
#      estaba, de ahí los 14 "Can't connect to MySQL server on '127.0.0.1'".
#   3. Recupera el backup si el PC estaba apagado a las 03:00. cron no repite lo que se
#      perdió, y entre el 21-ago y el 16-sep faltaron 18 de 27 noches sin dejar rastro.
#      Ahora cron lo llama cada hora de 03 a 23 y el script sale en silencio si ya hay
#      un backup correcto hoy (marca .ultimo-ok) o si otro sigue en curso (flock).
#
# Uso manual:  bash CRM_PYTHON/scripts/backup_cron.sh          (FORZAR=1 ignora la marca de hoy)
# En cron:     0 3-23 * * * bash ".../CRM_PYTHON/scripts/backup_cron.sh" >> ".../logs/backup-cron.log" 2>&1

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"   # CRM_CONNECTING/
BACKUP_DIR="${BASE_DIR}/db-backups"
MARCA_OK="${BACKUP_DIR}/.ultimo-ok"   # fecha (YYYY-MM-DD) del último backup terminado bien

# Estas dos salidas no escriben nada: con el cron cada hora llenarían el log de ruido.
# Se comprueba la marca y no la fecha del .sql.gz porque backup_db.py crea el archivo
# al empezar: uno a medias o fallido parecería el backup de hoy.
mkdir -p "${BACKUP_DIR}"
exec 9>"${BACKUP_DIR}/.backup.lock"
flock -n 9 || exit 0
if [[ -z "${FORZAR:-}" && "$(cat "${MARCA_OK}" 2>/dev/null)" == "$(date +%F)" ]]; then
  exit 0
fi

# Entorno único del proyecto. Antes esto apuntaba a .venvlinux, que había quedado
# atrás (starlette 1.0.0 frente a 1.3.1): se probaba contra una versión y el cron
# corría sobre otra. .venvlinux se borró el 21-09-2026, junto con .venv-viejo:
# este .venv es ya el único entorno del proyecto.
# 10-nov-2026: ya no hay túnel ni MYSQL_URL en la PC. El volcado lo hace el EC2 con sus
# propias credenciales (que nunca salen del servidor) y llega comprimido por SSH: la
# misma vía que scripts/sync_prod_local.sh. Antes fallaba desde el 9-oct porque faltaba
# CRM_PYTHON/.env, y además obligaba a tener la contraseña de producción en la PC.
EC2="ubuntu@3.150.243.188"
SSH_KEY="${HOME}/.ssh/aws-crm/crm-connecting-key.pem"
KEEP="${BACKUP_KEEP:-7}"   # ~700 MB cada uno
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

log "=== backup CRM Connecting (vía EC2) — destino: ${BACKUP_DIR}"
DESTINO="${BACKUP_DIR}/crm-backup-$(date +%Y%m%d-%H%M%S).sql.gz"
PARCIAL="${DESTINO}.parcial"
trap 'rm -f "${PARCIAL}"' EXIT

if ! ssh -i "${SSH_KEY}" -o ConnectTimeout=20 -o ServerAliveInterval=30 "${EC2}" 'bash -s' > "${PARCIAL}" 9>&- <<'REMOTO'
set -euo pipefail
cd ~/app/CRM_PYTHON
U=$(grep -oE '^MYSQL_URL=.*' .env | sed -E 's#^MYSQL_URL=[^/]*//##')
USR=${U%%:*}; R=${U#*:}; export MYSQL_PWD=${R%%@*}; R=${R#*@}; HOST=${R%%[:/]*}
DB=$(echo "$R" | sed -E 's#^[^/]*/([^?]*).*#\1#')
CA=$(grep -oE '^MYSQL_SSL_CA=.*' .env | cut -d= -f2-)
mysqldump -h "$HOST" -u "$USR" --ssl-ca="$CA" --single-transaction --quick --no-tablespaces \
  --set-gtid-purged=OFF --column-statistics=0 --skip-triggers "$DB" | gzip -c
REMOTO
then
  log "ERROR: el volcado por SSH falló"
  exit 1
fi

# Integridad: gzip sano, trae tablas y terminó (mysqldump escribe "Dump completed" al final).
# (sin pipefail: cortar el zcat a propósito con head/grep -q no es un error)
integro() {
  set +o pipefail
  gzip -t "${PARCIAL}" 2>/dev/null \
    && zcat "${PARCIAL}" | head -c 2000000 | grep -q "CREATE TABLE" \
    && zcat "${PARCIAL}" | tail -c 200 | grep -q "Dump completed"
}
if ! integro; then
  log "ERROR: el backup llegó incompleto o dañado — descartado"
  exit 1
fi
mv "${PARCIAL}" "${DESTINO}"
date +%F > "${MARCA_OK}"
log "backup OK: $(basename "${DESTINO}") ($(du -h "${DESTINO}" | cut -f1))"

# Rotación: los últimos ${KEEP} backups diarios.
ls -1t "${BACKUP_DIR}"/crm-backup-*.sql.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r viejo; do
  rm -f "${viejo}"; log "rotado: $(basename "${viejo}")"
done
