#!/usr/bin/env bash
# Arranca el CRM contra la BD LOCAL (Docker), sin tunel y sin tocar produccion.
#
#   ./iniciar-local.sh
#
# Para trabajar contra la RDS de produccion (solo si de verdad hace falta) el
# camino sigue siendo el de antes: scripts/dev_db_tunnel.sh + CRM_PYTHON/run.py.

set -euo pipefail

BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTENEDOR="crm-connecting-local"
PUERTO_DB="3309"

# ------------------------------------------------------------ base de datos
if ! docker ps --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
  if docker ps -a --format '{{.Names}}' | grep -qx "$CONTENEDOR"; then
    echo "Arrancando el contenedor $CONTENEDOR..."
    docker start "$CONTENEDOR" >/dev/null
  else
    echo "ERROR: no existe el contenedor $CONTENEDOR." >&2
    echo "Crealo con: bash CRM_PYTHON/scripts/init_local_db.sh" >&2
    exit 1
  fi
fi

echo -n "Esperando a MySQL en $PUERTO_DB"
for _ in $(seq 1 60); do
  if docker exec "$CONTENEDOR" mysqladmin ping -uroot -pdevlocal --silent >/dev/null 2>&1; then
    echo " — listo."; break
  fi
  echo -n "."; sleep 1
done

# --------------------------------------------------- comprobacion de aislamiento
# Barrera explicita: si por lo que sea la URL no apunta al MySQL local, no se
# arranca. Vale mas un arranque fallido que escribir en la base real.
export CRM_ENV_FILE=".env.local"
URL_DB="$(grep -E '^MYSQL_URL=' "${BASE_DIR}/CRM_PYTHON/.env.local" | cut -d= -f2-)"
if [[ "$URL_DB" != *"127.0.0.1:${PUERTO_DB}"* ]]; then
  echo "ERROR: .env.local no apunta a 127.0.0.1:${PUERTO_DB} — abortado." >&2
  exit 1
fi

echo
echo "  BD .......... MySQL local en Docker (127.0.0.1:${PUERTO_DB}) — datos anonimizados"
echo "  Produccion .. sin tocar (no hace falta el tunel SSH)"
echo "  CRM ......... http://localhost:8001"
echo "  Acceso ...... cualquier usuario del CRM, contrasena: local123"
echo

cd "${BASE_DIR}/CRM_PYTHON"
exec ./.venv/bin/python run.py
