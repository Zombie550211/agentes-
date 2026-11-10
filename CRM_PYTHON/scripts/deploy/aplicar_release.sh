#!/usr/bin/env bash
# Aplica en el EC2 una release: la lanza auto_desplegar.sh (timer de systemd, con
# el paquete en un directorio local) o un workflow vía SSM (con el paquete en S3).
# Corre como root; no está pensada para ejecutarse a mano.
#
# Uso: aplicar_release.sh <s3://bucket/releases/SHA | /directorio> <SHA> \
#        <sha256 release.tgz> <sha256 borrados.txt> <sha256 cambiados.txt>
#
# Pasos: descarga y comprueba los hashes → punto de retorno → copia los archivos
# cambiados y borra los que se eliminaron en git → pip si cambió requirements.txt
# → reinicia el servicio → verifica. Si algo falla después de empezar a tocar la
# app, restaura el punto de retorno y sale con error (el workflow queda en rojo).
#
# Sin cortes (si existe /etc/nginx/conf.d/crm-backend-upstream.conf, ver
# instalar_sin_cortes.sh): en vez de reiniciar, arranca la versión nueva en el otro puerto
# (crm-backend@8000 ↔ @8002), espera a que responda, cambia nginx a ella (reload: no corta
# conexiones) y apaga la vieja; las páginas abiertas se reconectan solas. Si la nueva no
# responde, la vieja nunca dejó de atender: se restauran los archivos y listo.
#
# Los hashes llegan por SSM desde el workflow y no desde S3: aunque alguien
# sustituyera los archivos del bucket, el EC2 se negaría a aplicarlos.
set -euo pipefail

if [[ $# -ne 5 ]]; then
  echo "uso: $0 <s3://…/releases/SHA> <SHA> <sha256 tgz> <sha256 borrados> <sha256 cambiados>" >&2
  exit 2
fi
ORIGEN="$1"; SHA="$2"; H_REL="$3"; H_BOR="$4"; H_CAM="$5"

APP="${APP_DIR:-/home/ubuntu/app}"
BASE="$(dirname "${APP}")"
USUARIO="${APP_USER:-ubuntu}"
SERVICIO="${SERVICIO:-crm-backend}"
URL_LOCAL="${URL_LOCAL:-http://127.0.0.1:8000}"
UPSTREAM="${UPSTREAM:-/etc/nginx/conf.d/crm-backend-upstream.conf}"
SIN_CORTES=0; ACTIVO=""; NUEVO=""; CAMBIADO=0
if [[ -f "${UPSTREAM}" ]]; then
  ACTIVO="$(grep -oE '127\.0\.0\.1:[0-9]+' "${UPSTREAM}" | head -1 | cut -d: -f2)"
  case "${ACTIVO}" in
    8000) NUEVO=8002 ;;
    8002) NUEVO=8000 ;;
    *) echo "ERROR: ${UPSTREAM} no apunta a 8000 ni 8002" >&2; exit 1 ;;
  esac
  SIN_CORTES=1
fi
MANTENER="${MANTENER_RETORNOS:-5}"
AWS="${AWS_BIN:-$(command -v aws || echo /snap/bin/aws)}"
REGISTRO="${REGISTRO:-/var/log/crm-deploy.log}"

exec > >(tee -a "${REGISTRO}") 2>&1
log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] $*"; }
# En el EC2 corre como root (SSM) y la app es de ${USUARIO}: lo que escribe en la
# app se hace como ese usuario para no dejar archivos de root que luego no se
# puedan sobrescribir.
como_usuario() { if [[ $(id -u) -eq 0 ]]; then runuser -u "${USUARIO}" -- "$@"; else "$@"; fi; }

T="$(mktemp -d)"
trap 'rm -rf "${T}"' EXIT
chmod 755 "${T}"   # tar corre como ${USUARIO}, que tiene que poder leer el paquete

log "=== release ${SHA:0:7}"

# ── 1. Descarga y comprobación ───────────────────────────────────
for f in release.tgz borrados.txt cambiados.txt; do
  if [[ "${ORIGEN}" == s3://* ]]; then
    "${AWS}" s3 cp "${ORIGEN}/${f}" "${T}/${f}" --only-show-errors
  else
    cp -- "${ORIGEN}/${f}" "${T}/${f}"   # paquete local (auto_desplegar.sh)
  fi
done
chmod 644 "${T}"/*
if ! printf '%s  %s\n%s  %s\n%s  %s\n' \
      "${H_REL}" "${T}/release.tgz" "${H_BOR}" "${T}/borrados.txt" "${H_CAM}" "${T}/cambiados.txt" \
    | sha256sum -c --quiet - ; then
  log "ERROR: los hashes no coinciden con los del workflow — no se toca nada"
  exit 1
fi

# Solo rutas relativas y sin '..': un paquete manipulado no puede escribir fuera de la app.
if grep -qE '(^/|(^|/)\.\.(/|$))' "${T}/cambiados.txt" "${T}/borrados.txt"; then
  log "ERROR: el paquete contiene rutas fuera de la app — no se toca nada"
  exit 1
fi
# Y el .tgz tiene que contener exactamente lo que dice cambiados.txt.
if [[ -s "${T}/cambiados.txt" ]]; then
  if ! diff -q <(tar --quoting-style=literal -tzf "${T}/release.tgz" | sort) <(sort "${T}/cambiados.txt") >/dev/null; then
    log "ERROR: el contenido del .tgz no coincide con cambiados.txt — no se toca nada"
    exit 1
  fi
fi
log "paquete verificado: $(wc -l < "${T}/cambiados.txt") archivos a copiar, $(wc -l < "${T}/borrados.txt") a borrar"

# ── 2. Punto de retorno ──────────────────────────────────────────
# Sin .venv (se regenera), ni uploads/ ni logs/ (el despliegue no los toca).
F="$(date -u +%Y%m%d-%H%M%S)"
RETORNO="${BASE}/app-rollback-${F}.tar.gz"
PIP_RETORNO="${BASE}/pip-rollback-${F}.txt"
tar czf "${RETORNO}" --exclude='CRM_PYTHON/.venv' --exclude='app/uploads' --exclude='app/logs' --exclude='app/datos_privados' \
  -C "${BASE}" "$(basename "${APP}")"
"${APP}/CRM_PYTHON/.venv/bin/pip" freeze > "${PIP_RETORNO}" 2>/dev/null || true
log "punto de retorno: $(basename "${RETORNO}")"

# Archivos que la release crea (no existían): al revertir hay que quitarlos.
: > "${T}/nuevos.txt"
while IFS= read -r f; do
  if [[ -n "${f}" && ! -e "${APP}/${f}" ]]; then echo "${f}" >> "${T}/nuevos.txt"; fi
done < "${T}/cambiados.txt"

PIP_CAMBIO=0
if grep -qx 'CRM_PYTHON/requirements.txt' "${T}/cambiados.txt"; then PIP_CAMBIO=1; fi

sano() {   # $1 servicio, $2 URL (por defecto los del modo clásico)
  local i svc="${1:-${SERVICIO}}" url="${2:-${URL_LOCAL}}"
  for i in $(seq 1 40); do
    sleep 1
    systemctl is-active --quiet "${svc}" || continue
    [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${url}/login.html")" == 200 ]] || continue
    curl -s --max-time 3 "${url}/api/auth/verify-server" | grep -q '"authenticated"' || continue
    return 0
  done
  return 1
}

# nginx pasa a mandar el tráfico al puerto $1. reload es suave: las peticiones en curso
# terminan en el proceso viejo y las nuevas van al nuevo.
apuntar_nginx() {
  local antes; antes="$(cat "${UPSTREAM}")"
  echo "upstream crm_backend { server 127.0.0.1:$1; }" > "${UPSTREAM}"
  if nginx -t -q && systemctl reload nginx; then return 0; fi
  echo "${antes}" > "${UPSTREAM}"; nginx -t -q && systemctl reload nginx || true
  return 1
}

# set -e no actúa dentro de una función llamada desde un `if`: cada paso crítico
# lleva su propio `|| return 1`.
aplicar() {
  if [[ -s "${T}/cambiados.txt" ]]; then
    como_usuario tar -xzf "${T}/release.tgz" -C "${APP}" || return 1
  fi
  while IFS= read -r f; do
    [[ -n "${f}" ]] || continue
    rm -f -- "${APP}/${f}" || return 1
  done < "${T}/borrados.txt"
  if [[ ${PIP_CAMBIO} -eq 1 ]]; then
    log "requirements.txt cambió: pip install"
    como_usuario "${APP}/CRM_PYTHON/.venv/bin/pip" install -q \
      -r "${APP}/CRM_PYTHON/requirements.txt" || return 1
  fi
  if [[ ${SIN_CORTES} -eq 0 ]]; then
    log "reiniciando ${SERVICIO}"
    systemctl restart "${SERVICIO}" || return 1
    sano || { log "el servicio no responde tras el reinicio"; return 1; }
    return 0
  fi
  log "sin cortes: arrancando la versión nueva en el ${NUEVO} (sigue atendiendo el ${ACTIVO})"
  systemctl stop "crm-backend@${NUEVO}" 2>/dev/null || true   # restos de un intento anterior
  systemctl start "crm-backend@${NUEVO}" || return 1
  sano "crm-backend@${NUEVO}" "http://127.0.0.1:${NUEVO}" || { log "la versión nueva no responde"; return 1; }
  apuntar_nginx "${NUEVO}" || { log "nginx no aceptó el cambio de puerto"; return 1; }
  CAMBIADO=1
  log "nginx ya envía al ${NUEVO}; apagando el ${ACTIVO}"
  systemctl enable -q "crm-backend@${NUEVO}" || true
  systemctl disable -q "crm-backend@${ACTIVO}" || true
  sleep 2   # que terminen las peticiones que ya iban al viejo
  systemctl stop "crm-backend@${ACTIVO}" || true
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 --resolve connecting.lat:443:127.0.0.1 \
        https://connecting.lat/login.html)" == 200 ]] || { log "nginx no responde tras el cambio"; return 1; }
}

revertir() {
  log "REVIRTIENDO a $(basename "${RETORNO}")"
  tar -xzf "${RETORNO}" -C "${BASE}"
  while IFS= read -r f; do
    if [[ -n "${f}" ]]; then rm -f -- "${APP}/${f}"; fi
  done < "${T}/nuevos.txt"
  if [[ ${PIP_CAMBIO} -eq 1 && -s "${PIP_RETORNO}" ]]; then
    como_usuario "${APP}/CRM_PYTHON/.venv/bin/pip" install -q -r "${PIP_RETORNO}" || true
  fi
  if [[ ${SIN_CORTES} -eq 0 ]]; then
    systemctl restart "${SERVICIO}" || true
    if sano; then log "revertido: el servicio vuelve a responder con la versión anterior"
    else log "ATENCIÓN: revertido, pero el servicio sigue sin responder — revisar a mano"; fi
    return
  fi
  if [[ ${CAMBIADO} -eq 0 ]]; then
    # El viejo nunca dejó de atender: solo sobra el nuevo.
    systemctl stop "crm-backend@${NUEVO}" || true
    log "revertido: el ${ACTIVO} siguió atendiendo todo el tiempo (sin corte)"
    return
  fi
  # Ya se había cambiado nginx: el viejo vuelve a arrancar con los archivos restaurados.
  systemctl start "crm-backend@${ACTIVO}" || true
  if sano "crm-backend@${ACTIVO}" "http://127.0.0.1:${ACTIVO}" && apuntar_nginx "${ACTIVO}"; then
    systemctl enable -q "crm-backend@${ACTIVO}" || true
    systemctl disable -q --now "crm-backend@${NUEVO}" || true
    log "revertido: vuelve a atender el ${ACTIVO} con la versión anterior"
  else
    log "ATENCIÓN: revertido, pero el ${ACTIVO} no responde — revisar a mano"
  fi
}

# ── 3. Aplicar ───────────────────────────────────────────────────
if aplicar; then
  echo "${SHA}" > "${BASE}/app-desplegado.txt"
  log "OK — ${SHA:0:7} desplegado y verificado"
else
  revertir
  exit 1
fi

# ── 4. Rotación de puntos de retorno ─────────────────────────────
# El despliegue ya está hecho: un fallo aquí no debe dejar el workflow en rojo.
for patron in 'app-rollback-*.tar.gz' 'pip-rollback-*.txt'; do
  { ls -1t "${BASE}"/${patron} 2>/dev/null || true; } | tail -n +$((MANTENER + 1)) | while IFS= read -r viejo; do
    if rm -f -- "${viejo}"; then log "rotado: $(basename "${viejo}")"; fi
  done || true
done
