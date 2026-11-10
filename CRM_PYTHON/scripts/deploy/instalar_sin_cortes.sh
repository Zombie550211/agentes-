#!/usr/bin/env bash
# Pasa el EC2 al despliegue sin cortes (una sola vez, como root, en una ventana sin uso:
# corta el CRM unos segundos, lo que tarda en arrancar en el puerto nuevo).
#
#   sudo bash ~/app/CRM_PYTHON/scripts/deploy/instalar_sin_cortes.sh            # instalar
#   sudo bash ~/app/CRM_PYTHON/scripts/deploy/instalar_sin_cortes.sh --revertir # volver a crm-backend
#
# Antes: crm-backend.service en el 8000 y nginx con proxy_pass http://127.0.0.1:8000.
# Después: crm-backend@8000 (o @8002) y nginx con proxy_pass http://crm_backend, cuyo
# puerto lo fija /etc/nginx/conf.d/crm-backend-upstream.conf. aplicar_release.sh detecta
# ese archivo y despliega alternando puertos; sin él sigue con el reinicio de siempre.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITIO=/etc/nginx/sites-enabled/crm-connecting
# Copia fuera de sites-enabled: nginx carga todo lo que hay ahí.
COPIA=/etc/nginx/crm-connecting.antes-sin-cortes
UPSTREAM=/etc/nginx/conf.d/crm-backend-upstream.conf
UNIDAD=/etc/systemd/system/crm-backend@.service

[[ $(id -u) -eq 0 ]] || { echo "Ejecutar con sudo" >&2; exit 1; }

sano() {   # $1 puerto
  for _ in $(seq 1 40); do
    sleep 1
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://127.0.0.1:$1/login.html")" == 200 ]] || continue
    curl -s --max-time 3 "http://127.0.0.1:$1/api/auth/verify-server" | grep -q '"authenticated"' && return 0
  done
  return 1
}

if [[ "${1:-}" == "--revertir" ]]; then
  cp -a "${COPIA}" "${SITIO}"
  rm -f "${UPSTREAM}"
  nginx -t
  systemctl disable --now crm-backend@8000 crm-backend@8002 2>/dev/null || true
  systemctl enable --now crm-backend
  sano 8000 && systemctl reload nginx
  echo "Revertido: crm-backend en el 8000, despliegue con reinicio."
  exit 0
fi

[[ -f "${UPSTREAM}" ]] && { echo "Ya instalado (${UPSTREAM} existe)"; exit 0; }
grep -q 'proxy_pass http://127.0.0.1:8000;' "${SITIO}" || { echo "nginx no tiene el proxy_pass esperado" >&2; exit 1; }

install -m 644 "${DIR}/crm-backend@.service" "${UNIDAD}"
systemctl daemon-reload

cp -a "${SITIO}" "${COPIA}"
echo 'upstream crm_backend { server 127.0.0.1:8000; }' > "${UPSTREAM}"
sed -i 's#proxy_pass http://127.0.0.1:8000;#proxy_pass http://crm_backend;#' "${SITIO}"
if ! nginx -t; then
  cp -a "${COPIA}" "${SITIO}"; rm -f "${UPSTREAM}"
  echo "nginx -t falló: no se cambió nada" >&2; exit 1
fi

# Mismo puerto 8000: se para el servicio viejo y arranca la instancia @8000.
systemctl disable --now crm-backend
systemctl enable --now crm-backend@8000
if ! sano 8000; then
  echo "crm-backend@8000 no responde: revirtiendo" >&2
  exec bash "$0" --revertir
fi
systemctl reload nginx
echo "Listo: crm-backend@8000 activo; los próximos despliegues no cortan el CRM."
