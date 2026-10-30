#!/usr/bin/env bash
# Copia LOCAL con los datos reales de producción, al día (≈1 min de retraso).
#
#   bash CRM_PYTHON/scripts/sync_prod_local.sh --inicial   # una vez: copia completa (varios minutos)
#   bash CRM_PYTHON/scripts/sync_prod_local.sh             # después: sincroniza cada minuto (dejar corriendo)
#   bash CRM_PYTHON/scripts/sync_prod_local.sh --una-vez   # una sola vuelta
#
# Producción solo se LEE: la copia inicial es un mysqldump --single-transaction (foto
# consistente, sin bloquear tablas) y cada vuelta corre en el EC2 prod_export_cambios.py,
# que abre la sesión de BD en modo READ ONLY y devuelve SQL con lo que cambió. Las
# credenciales de producción no salen del EC2. El SQL se aplica en el MySQL local de Docker.
#
# En el local se puede registrar y editar sin afectar producción; lo que se pruebe puede
# quedar pisado si producción cambia esa misma fila, y cada 10 vueltas se borra en el local
# lo que ya no existe en producción.
set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
EC2="ubuntu@3.150.243.188"
KEY="$HOME/.ssh/aws-crm/crm-connecting-key.pem"
CONTENEDOR="crm-connecting-local"
DB="crm_connecting"
ESTADO="${BASE_DIR}/db-backups/.sync-prod-corte"
LOG="${BASE_DIR}/logs/sync-prod-local.log"
CADA=60
SSH=(ssh -i "$KEY" -o ConnectTimeout=15 -o ServerAliveInterval=30 "$EC2")
mkdir -p "${BASE_DIR}/logs" "${BASE_DIR}/db-backups"

mysql_local() { docker exec -i "$CONTENEDOR" mysql -uroot -pdevlocal --max-allowed-packet=1G --default-character-set=utf8mb4 "$@" 2>&1 | grep -v "Using a password" || true; }

# El exportador vive en el EC2 fuera de la app (no lo toca el auto-despliegue).
subir_exportador() {
  scp -q -i "$KEY" "${BASE_DIR}/CRM_PYTHON/scripts/prod_export_cambios.py" "${EC2}:~/prod_export_cambios.py"
}

inicial() {
  subir_exportador
  local dump="${BASE_DIR}/db-backups/prod-copia-$(date +%Y%m%d-%H%M%S).sql.gz"
  echo "Copia completa de producción → ${dump} (solo lectura, tarda unos minutos)…"
  # El corte se toma ANTES del dump: lo que cambie mientras tanto lo trae la primera vuelta.
  "${SSH[@]}" 'bash -s' > "$dump" <<'REMOTO'
set -euo pipefail
cd ~/app/CRM_PYTHON
U=$(grep -oE '^MYSQL_URL=.*' .env | sed -E 's#^MYSQL_URL=[^/]*//##')
USR=${U%%:*}; R=${U#*:}; export MYSQL_PWD=${R%%@*}; R=${R#*@}; HOST=${R%%[:/]*}
DB=$(echo "$R" | sed -E 's#^[^/]*/([^?]*).*#\1#')
CA=$(grep -oE '^MYSQL_SSL_CA=.*' .env | cut -d= -f2-)
CORTE=$(mysql -h "$HOST" -u "$USR" --ssl-ca="$CA" -N -e "SELECT DATE_FORMAT(NOW(),'%Y-%m-%d %H:%i:%s')")
{ echo "-- corte: $CORTE"
  mysqldump -h "$HOST" -u "$USR" --ssl-ca="$CA" --single-transaction --quick --no-tablespaces \
    --set-gtid-purged=OFF --column-statistics=0 --skip-triggers "$DB"; } | gzip -c
REMOTO
  cargar "$dump"
}

# Carga un dump hecho por inicial() (sirve para reintentar sin volver a pedirlo).
cargar() {
  local dump="$1" corte
  # head corta el zcat a propósito (SIGPIPE): con pipefail eso no es un error.
  corte=$( { zcat "$dump" || true; } | head -1 | sed -n 's/^-- corte: //p')
  [[ -n "$corte" ]] || { echo "ERROR: el dump no trae la marca de corte" >&2; exit 1; }
  echo "Dump listo ($(du -h "$dump" | cut -f1)). Reemplazando la base local…"
  mysql_local -e "DROP DATABASE IF EXISTS ${DB}; CREATE DATABASE ${DB} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  zcat "$dump" | tail -n +2 | mysql_local "$DB"
  echo "$corte" > "$ESTADO"
  echo "Copia local cargada. Corte: ${corte}. Ahora deja corriendo: bash CRM_PYTHON/scripts/sync_prod_local.sh"
}

vuelta() {   # $1 = 1 para hacer también tablas completas y borrados
  local desde corte extra=""
  desde=$(cat "$ESTADO")
  [[ "$1" == 1 ]] && extra="--completas"
  # 2 min de solape: una fila escrita justo en el corte no se pierde (REPLACE es idempotente).
  local sql; sql=$(mktemp)
  "${SSH[@]}" "~/app/CRM_PYTHON/.venv/bin/python ~/prod_export_cambios.py --desde \"\$(date -u -d '${desde} 2 minutes ago' '+%F %T' 2>/dev/null || echo '${desde}')\" ${extra}" > "$sql"
  corte=$(head -1 "$sql" | sed -n 's/^-- corte: //p')
  if [[ -z "$corte" ]]; then echo "$(date '+%F %T') sin respuesta del EC2" >> "$LOG"; rm -f "$sql"; return 1; fi
  mysql_local "$DB" < "$sql"
  echo "$corte" > "$ESTADO"
  echo "$(date '+%F %T') ok corte=${corte} sentencias=$(grep -c '^REPLACE\|^DELETE' "$sql" || true)${extra:+ (completas)}" >> "$LOG"
  rm -f "$sql"
}

case "${1:-}" in
  --inicial) inicial ;;
  --cargar) cargar "$2" ;;
  --una-vez) [[ -f "$ESTADO" ]] || { echo "Primero: --inicial" >&2; exit 1; }; subir_exportador; vuelta 1 ;;
  *)
    [[ -f "$ESTADO" ]] || { echo "Primero: bash CRM_PYTHON/scripts/sync_prod_local.sh --inicial" >&2; exit 1; }
    subir_exportador
    n=0
    echo "Sincronizando producción → local cada ${CADA}s (log: ${LOG}). Ctrl+C para parar."
    while true; do
      vuelta $(( n % 10 == 0 ? 1 : 0 )) || true
      n=$((n + 1)); sleep "$CADA"
    done ;;
esac
