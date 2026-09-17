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
# corría sobre otra. .venvlinux queda en desuso — se puede borrar una vez confirmado
# que backup y servidor funcionan desde aquí.
PYTHON="${BASE_DIR}/CRM_PYTHON/.venv/bin/python"
LOCAL_PORT="3308"
EC2_IP="3.150.243.188"
EC2_USER="ubuntu"
SSH_KEY="${HOME}/.ssh/aws-crm/crm-connecting-key.pem"
RDS_ENDPOINT="crm-connecting-db.cjcggw26guwj.us-east-2.rds.amazonaws.com"

TUNNEL_PID=""

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

cleanup() {
  # Sólo cerramos el túnel si lo abrimos nosotros: si ya estaba levantado (sesión de
  # desarrollo), matarlo dejaría al usuario sin conexión a la BD.
  if [[ -n "${TUNNEL_PID}" ]]; then
    log "cerrando túnel (pid ${TUNNEL_PID})"
    kill "${TUNNEL_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/${LOCAL_PORT}") 2>/dev/null; }

log "=== backup CRM Connecting — base: ${BASE_DIR}"

if [[ ! -x "${PYTHON}" ]]; then
  log "ERROR: no existe el intérprete ${PYTHON} — backup abortado"
  exit 1
fi

if port_open; then
  log "puerto ${LOCAL_PORT} ya en uso — reutilizando el túnel existente"
else
  if [[ ! -f "${SSH_KEY}" ]]; then
    log "ERROR: falta la clave SSH ${SSH_KEY} — no se puede abrir el túnel"
    exit 1
  fi
  log "abriendo túnel 127.0.0.1:${LOCAL_PORT} -> ${RDS_ENDPOINT}:3306 vía ${EC2_USER}@${EC2_IP}"
  ssh -N -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 \
      -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
      -i "${SSH_KEY}" \
      -L "${LOCAL_PORT}:${RDS_ENDPOINT}:3306" \
      "${EC2_USER}@${EC2_IP}" 9>&- &   # 9>&-: el túnel no hereda el candado
  TUNNEL_PID=$!

  # El túnel tarda en negociar; esperamos hasta 30s a que el puerto acepte conexiones.
  for _ in $(seq 1 30); do
    port_open && break
    sleep 1
  done

  if ! port_open; then
    log "ERROR: el túnel no llegó a levantar en 30s — backup abortado"
    exit 1
  fi
  log "túnel listo (pid ${TUNNEL_PID})"
fi

cd "${BASE_DIR}" || { log "ERROR: no se pudo entrar a ${BASE_DIR}"; exit 1; }

"${PYTHON}" CRM_PYTHON/scripts/backup_db.py
STATUS=$?

if [[ ${STATUS} -eq 0 ]]; then
  date +%F > "${MARCA_OK}"
  log "backup OK"
else
  log "ERROR: backup_db.py terminó con código ${STATUS}"
fi

exit ${STATUS}
