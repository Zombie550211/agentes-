#!/usr/bin/env bash
# Despliegue del CRM al EC2 (crm-connecting-backend).
#
# Copia SOLO los archivos que cambian entre la rama desplegada y la que se quiere
# desplegar, en vez de sincronizar el árbol entero: así un fichero que exista en el
# servidor y no en git (un .bak, un script de debug) no se borra por accidente, y
# se ve exactamente qué se está tocando antes de tocarlo.
#
# Uso:
#   bash CRM_PYTHON/scripts/deploy_ec2.sh              # muestra qué haría y pregunta
#   bash CRM_PYTHON/scripts/deploy_ec2.sh --si         # sin preguntar
#
# Variables (con valores por defecto):
#   RAMA_PROD=main                    rama que corre hoy en el servidor
#   RAMA_NUEVA=<rama actual>          rama a desplegar
#
# Antes de nada crea un punto de retorno en /home/ubuntu del propio EC2:
#   app-rollback-FECHA.tar.gz  +  pip-rollback-FECHA.txt
# Para revertir:
#   ssh ... 'cd /home/ubuntu && tar xzf app-rollback-FECHA.tar.gz && sudo systemctl restart crm-backend'

set -euo pipefail

EC2_IP="3.150.243.188"
EC2_USER="ubuntu"
SSH_KEY="$HOME/.ssh/aws-crm/crm-connecting-key.pem"
DESTINO="/home/ubuntu/app"
SERVICIO="crm-backend"
URL_PUBLICA="https://connecting.lat/login.html"

RAMA_PROD="${RAMA_PROD:-main}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"
RAMA_NUEVA="${RAMA_NUEVA:-$(git rev-parse --abbrev-ref HEAD)}"

SSH=(ssh -o ConnectTimeout=20 -i "$SSH_KEY" "${EC2_USER}@${EC2_IP}")

auto_si=0
[ "${1:-}" = "--si" ] && auto_si=1

echo "== Despliegue CRM =="
echo "   repo   : $REPO"
echo "   rama   : $RAMA_PROD -> $RAMA_NUEVA"
echo "   destino: ${EC2_USER}@${EC2_IP}:${DESTINO}"
echo

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ABORTADO: hay cambios sin commitear. Se despliega lo que está en git, no lo"
  echo "que hay en el disco, para que el servidor sea siempre una rama identificable."
  exit 1
fi

LISTA="$(mktemp)"
trap 'rm -f "$LISTA"' EXIT
git diff --name-only --diff-filter=d "$RAMA_PROD".."$RAMA_NUEVA" > "$LISTA"
N=$(wc -l < "$LISTA")

if [ "$N" -eq 0 ]; then
  echo "No hay nada que desplegar: $RAMA_NUEVA no añade archivos sobre $RAMA_PROD."
  exit 0
fi

echo "Archivos a copiar: $N"
awk -F/ '{print "   " $1 "/" $2}' "$LISTA" | sort | uniq -c | sort -rn | head -12
echo

BORRADOS="$(git diff --name-only --diff-filter=D "$RAMA_PROD".."$RAMA_NUEVA" || true)"
if [ -n "$BORRADOS" ]; then
  echo "Archivos borrados en git (se eliminan del servidor si están):"
  echo "$BORRADOS" | sed 's/^/   /'
  echo
fi

if [ "$auto_si" -ne 1 ]; then
  read -r -p "¿Continuar? [s/N] " r
  [ "$r" = "s" ] || [ "$r" = "S" ] || { echo "Cancelado."; exit 1; }
fi

echo
echo "-- 1/5 punto de retorno en el EC2"
TAG="$("${SSH[@]}" 'set -e
  F=$(date +%Y%m%d-%H%M%S)
  cd /home/ubuntu
  tar czf "app-rollback-$F.tar.gz" --exclude="CRM_PYTHON/.venv" app
  /home/ubuntu/app/CRM_PYTHON/.venv/bin/pip freeze > "pip-rollback-$F.txt"
  echo "$F"')"
echo "   app-rollback-${TAG}.tar.gz"

echo "-- 2/5 copiando $N archivos"
rsync -az --files-from="$LISTA" -e "ssh -o ConnectTimeout=20 -i $SSH_KEY" \
  ./ "${EC2_USER}@${EC2_IP}:${DESTINO}/"

if [ -n "$BORRADOS" ]; then
  echo "-- 2b/5 eliminando los borrados en git"
  # Separador NUL, no salto de línea: `xargs` parte por CUALQUIER espacio en
  # blanco, así que un archivo como "mejor requipo.png" llegaba a rm como dos
  # argumentos ("mejor" y "requipo.png"). Ninguno existe, rm -f los ignora en
  # silencio y el archivo real sobrevivía. Pasó de verdad: cuatro imágenes con
  # espacio en el nombre se quedaron en el EC2 tras el despliegue.
  printf '%s\0' "$BORRADOS" | "${SSH[@]}" "cd $DESTINO && tr '\n' '\0' | xargs -0 -r rm -f --"
fi

echo "-- 3/5 dependencias"
"${SSH[@]}" "cd ${DESTINO}/CRM_PYTHON && .venv/bin/pip install -q -r requirements.txt"

echo "-- 4/5 reiniciando ${SERVICIO}"
"${SSH[@]}" "sudo systemctl restart ${SERVICIO}"
sleep 4

echo "-- 5/5 verificación"
fallos=0

estado="$("${SSH[@]}" "systemctl is-active ${SERVICIO}" || true)"
echo "   servicio      : $estado"
[ "$estado" = "active" ] || fallos=$((fallos+1))

codigo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL_PUBLICA" || echo 000)"
echo "   login.html    : $codigo"
[ "$codigo" = "200" ] || fallos=$((fallos+1))

csp="$(curl -sI --max-time 20 "$URL_PUBLICA" | grep -i '^content-security-policy:' || true)"
if printf '%s' "$csp" | grep -q "script-src"; then
  echo "   CSP           : activa (script-src presente)"
else
  echo "   CSP           : NO activa — sigue la política vieja"
  fallos=$((fallos+1))
fi
if printf '%s' "$csp" | grep -qE 'cdnjs|jsdelivr|unpkg|jquery\.com|tailwindcss\.com'; then
  echo "   CDNs          : SIGUEN PERMITIDOS"
  fallos=$((fallos+1))
else
  echo "   CDNs          : ninguno permitido"
fi

echo
if [ "$fallos" -eq 0 ]; then
  echo "OK — despliegue verificado."
  echo "Punto de retorno: /home/ubuntu/app-rollback-${TAG}.tar.gz"
else
  echo "ATENCIÓN: $fallos comprobación(es) fallaron. Últimas líneas del servicio:"
  "${SSH[@]}" "sudo journalctl -u ${SERVICIO} -n 25 --no-pager" || true
  echo
  echo "Para revertir:"
  echo "  ssh -i $SSH_KEY ${EC2_USER}@${EC2_IP} \\"
  echo "    'cd /home/ubuntu && tar xzf app-rollback-${TAG}.tar.gz && sudo systemctl restart ${SERVICIO}'"
  exit 1
fi
