#!/usr/bin/env bash
# Crea (o recrea) la BD LOCAL de desarrollo: un MySQL 8.4 en Docker sembrado con
# el ultimo dump diario y anonimizado.
#
#   bash CRM_PYTHON/scripts/init_local_db.sh              # ultimo dump, anonimizado
#   bash CRM_PYTHON/scripts/init_local_db.sh --sin-anonimizar
#   bash CRM_PYTHON/scripts/init_local_db.sh --dump ruta/al/backup.sql.gz
#
# Es destructivo SOLO sobre el contenedor local: borra el contenedor y su volumen
# y los vuelve a crear. No toca la RDS ni necesita el tunel SSH.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CONTENEDOR="crm-connecting-local"
VOLUMEN="crm-connecting-local-data"
PUERTO="3309"
ANONIMIZAR=1
DUMP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --sin-anonimizar) ANONIMIZAR=0; shift ;;
    --dump) DUMP="$2"; shift 2 ;;
    *) echo "Opcion desconocida: $1" >&2; exit 1 ;;
  esac
done

# El puerto 3307 lo ocupa el contenedor del pentest y el 3308 el tunel a la RDS.
# Si alguien cambia PUERTO, que al menos no choque en silencio.
if ss -ltn 2>/dev/null | grep -q ":${PUERTO} "; then
  if ! docker ps --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
    echo "ERROR: el puerto ${PUERTO} esta ocupado por otra cosa." >&2; exit 1
  fi
fi

if [[ -z "$DUMP" ]]; then
  DUMP="$(ls -1t "${BASE_DIR}"/db-backups/crm-backup-*.sql.gz 2>/dev/null | head -1 || true)"
fi
[[ -n "$DUMP" && -f "$DUMP" ]] || { echo "ERROR: no se encontro ningun dump en db-backups/." >&2; exit 1; }
echo "Dump: $(basename "$DUMP") ($(du -h "$DUMP" | cut -f1))"

echo "Recreando el contenedor ${CONTENEDOR}..."
docker rm -f "$CONTENEDOR" >/dev/null 2>&1 || true
docker volume rm "$VOLUMEN"  >/dev/null 2>&1 || true

# max-allowed-packet=1G: hay filas (adjuntos en media_files) que superan de largo
# los 64 MB por defecto, y la carga se cortaba a mitad del dump.
docker run -d --name "$CONTENEDOR" \
  -e MYSQL_ROOT_PASSWORD=devlocal \
  -e MYSQL_DATABASE=crm_connecting \
  -e MYSQL_USER=crm -e MYSQL_PASSWORD=devlocal \
  -p "127.0.0.1:${PUERTO}:3306" \
  -v "${VOLUMEN}:/var/lib/mysql" \
  --restart unless-stopped \
  mysql:8.4 \
  --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci \
  --max-allowed-packet=1G --innodb-log-file-size=512M >/dev/null

echo -n "Esperando a MySQL"
for _ in $(seq 1 90); do
  docker exec "$CONTENEDOR" mysqladmin ping -uroot -pdevlocal --silent >/dev/null 2>&1 && break
  echo -n "."; sleep 1
done
echo " — listo."

echo "Cargando el dump (tarda un par de minutos)..."
zcat "$DUMP" | docker exec -i "$CONTENEDOR" \
  mysql -uroot -pdevlocal --max-allowed-packet=1G --default-character-set=utf8mb4 crm_connecting

TABLAS="$(docker exec "$CONTENEDOR" mysql -uroot -pdevlocal -N -e \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='crm_connecting';" 2>/dev/null)"
echo "Tablas cargadas: ${TABLAS}"

if [[ "$ANONIMIZAR" == "1" ]]; then
  echo "Anonimizando datos personales..."
  docker exec -i "$CONTENEDOR" mysql -uroot -pdevlocal --max-allowed-packet=1G crm_connecting \
    < "${SCRIPT_DIR}/anonymize_local.sql" >/dev/null
  echo "Hecho. Todas las contrasenas quedan en 'local123'."
else
  echo "AVISO: datos SIN anonimizar — hay PII real de clientes en el portatil."
fi

echo
echo "Listo. Arranca el CRM con:  ./iniciar-local.sh"
