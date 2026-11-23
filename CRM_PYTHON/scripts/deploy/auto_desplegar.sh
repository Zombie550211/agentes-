#!/usr/bin/env bash
# Despliegue automático del CRM: el EC2 se actualiza solo desde la rama main.
#
# Lo lanza cada minuto crm-auto-desplegar.timer (systemd), como root. Si en GitHub
# hay un commit nuevo en main: lo descarga, comprueba que el Python compila,
# empaqueta lo que cambió desde lo desplegado y lo aplica con aplicar_release.sh
# (punto de retorno, reinicio, verificación y vuelta atrás automática). Avisa por
# correo (SNS) de cada despliegue, bueno o fallido.
#
# Un commit que falla se anota y no se reintenta cada minuto (evita reinicios en
# bucle y un correo por minuto): se espera al siguiente commit.
#
# Se instala en /opt/crm, de root y no escribible por el usuario de la app: si el
# backend quedara comprometido, no podría modificar lo que corre como root.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Zombie550211/agentes-.git}"
RAMA="${RAMA:-main}"
ESPEJO="${ESPEJO:-/opt/crm/repo.git}"
APP="${APP_DIR:-/home/ubuntu/app}"
ESTADO="$(dirname "${APP}")/app-desplegado.txt"   # lo escribe aplicar_release.sh al terminar bien
FALLIDO="${FALLIDO:-/var/lib/crm-deploy/fallido}"
TEMA_SNS="${TEMA_SNS:-arn:aws:sns:us-east-2:964060772387:crm-backup-alertas}"
REGION="${AWS_REGION:-us-east-2}"
AWS="${AWS_BIN:-$(command -v aws || echo /snap/bin/aws)}"
PY="${PYTHON_BIN:-/usr/bin/python3}"
REGISTRO="${REGISTRO:-/var/log/crm-deploy.log}"
CANDADO="${CANDADO:-/run/crm-auto-desplegar.lock}"

exec 9>"${CANDADO}"
flock -n 9 || exit 0   # ya hay un despliegue en curso

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${REGISTRO}"; }
avisar() {  # $1 asunto (ASCII, <100), $2 cuerpo
  "${AWS}" sns publish --region "${REGION}" --topic-arn "${TEMA_SNS}" \
      --subject "$1" --message "$2" >/dev/null 2>&1 \
    || log "aviso: no se pudo enviar el correo ($1)"
}

# ── ¿Hay algo nuevo? (lo barato primero: una consulta, sin descargar nada) ──
REMOTO="$(timeout 30 git ls-remote "${REPO_URL}" "refs/heads/${RAMA}" 2>/dev/null | cut -f1 || true)"
[[ "${REMOTO}" =~ ^[0-9a-f]{40}$ ]] || exit 0            # GitHub no responde: se reintenta en un minuto
ACTUAL="$(tr -d '[:space:]' < "${ESTADO}" 2>/dev/null || true)"
[[ "${REMOTO}" == "${ACTUAL}" ]] && exit 0
if [[ -f "${FALLIDO}" && "$(cat "${FALLIDO}")" == "${REMOTO}" ]]; then exit 0; fi

T="$(mktemp -d)"
trap 'rm -rf "${T}"' EXIT
chmod 755 "${T}"   # aplicar_release.sh extrae el paquete como el usuario de la app
RESUMEN="${REMOTO:0:7}"

# ── ¿Pasó el CI de GitHub (pruebas automáticas)? ─────────────────
# Solo se despliega un commit cuyo workflow "Comprobar el código" terminó en verde.
# Mientras corre (o si la API de GitHub no responde) se sale sin hacer nada y se
# vuelve a mirar en un minuto.
# DESACTIVADO por defecto (EXIGIR_CI=0): en nov-2026 GitHub no ejecuta el CI porque la
# cuenta está bloqueada por facturación, y exigirlo frenaría todos los despliegues.
# Cuando el CI vuelva a correr, activarlo con Environment=EXIGIR_CI=1 en
# crm-auto-desplegar.service. Las pruebas igual se corren aquí abajo, en el propio EC2.
estado_ci() {  # imprime: ok | pendiente | fallo:<nombre del paso>
  local api="https://api.github.com/repos/${REPO_URL#https://github.com/}"
  api="${api%.git}/commits/${REMOTO}/check-runs"
  timeout 30 curl -fsS -H "Accept: application/vnd.github+json" "${api}" 2>/dev/null | "${PY}" -c '
import json, sys
runs = json.load(sys.stdin).get("check_runs", [])
if not runs:
    print("pendiente"); sys.exit()
for r in runs:
    if r.get("status") != "completed":
        print("pendiente"); sys.exit()
malos = [r["name"] for r in runs if r.get("conclusion") not in ("success", "skipped", "neutral")]
print("fallo:" + ", ".join(malos) if malos else "ok")' || echo "pendiente"
}
if [[ "${EXIGIR_CI:-0}" == "1" ]]; then
  CI="$(estado_ci)"
  case "${CI}" in
    ok) ;;
    pendiente) exit 0 ;;
    fallo:*) fallar "el CI de GitHub falló (${CI#fallo:}): las pruebas no pasan. Ver la pestaña Actions del repositorio." ;;
  esac
fi

fallar() {
  log "FALLO ${REMOTO:0:7}: $1"
  mkdir -p "$(dirname "${FALLIDO}")"
  echo "${REMOTO}" > "${FALLIDO}"
  avisar "CRM: despliegue FALLIDO ${REMOTO:0:7}" "$(printf '%s\n\nMotivo:\n%s\n\nProduccion sigue con la version anterior (%s). Se volvera a intentar con el siguiente commit en main.\nRegistro en el EC2: sudo tail -50 %s' \
    "${RESUMEN}" "$1" "${ACTUAL:0:7}" "${REGISTRO}")"
  exit 1
}

[[ "${ACTUAL}" =~ ^[0-9a-f]{40}$ ]] || fallar "no se sabe qué commit hay en producción: falta ${ESTADO}"

# ── Traer el commit ──────────────────────────────────────────────
if [[ ! -d "${ESPEJO}" ]]; then
  git clone -q --bare --single-branch --branch "${RAMA}" "${REPO_URL}" "${ESPEJO}" \
    || fallar "no se pudo clonar ${REPO_URL}"
fi
git --git-dir="${ESPEJO}" fetch -q origin "+refs/heads/${RAMA}:refs/heads/${RAMA}" || fallar "git fetch falló"
git --git-dir="${ESPEJO}" cat-file -e "${REMOTO}^{commit}" 2>/dev/null || fallar "el commit ${REMOTO} no llegó con el fetch"
RESUMEN="$(git --git-dir="${ESPEJO}" log -1 --format='%h %s (%an)' "${REMOTO}")"

git --git-dir="${ESPEJO}" cat-file -e "${ACTUAL}^{commit}" 2>/dev/null \
  || fallar "el commit desplegado (${ACTUAL:0:7}) no está en el repositorio"
git --git-dir="${ESPEJO}" merge-base --is-ancestor "${ACTUAL}" "${REMOTO}" \
  || fallar "producción (${ACTUAL:0:7}) tiene cambios que no están en main: no se despliega para no pisarlos"

mkdir -p "${T}/arbol" "${T}/rel"
git --git-dir="${ESPEJO}" archive "${REMOTO}" | tar -x -C "${T}/arbol"

# --no-renames: un renombrado es borrado + alta, así el nombre viejo también
# desaparece del servidor. .github/ no se despliega.
git --git-dir="${ESPEJO}" -c core.quotePath=false diff --name-only --no-renames --diff-filter=d \
  "${ACTUAL}" "${REMOTO}" -- . ':(exclude).github/**' > "${T}/rel/cambiados.txt"
git --git-dir="${ESPEJO}" -c core.quotePath=false diff --name-only --no-renames --diff-filter=D \
  "${ACTUAL}" "${REMOTO}" -- . ':(exclude).github/**' > "${T}/rel/borrados.txt"

# Sin cambios netos (solo .github/, o un commit que deshace otro): producción ya
# está como main; se anota y se limpia la marca de un fallo anterior.
if [[ ! -s "${T}/rel/cambiados.txt" && ! -s "${T}/rel/borrados.txt" ]]; then
  echo "${REMOTO}" > "${ESTADO}"
  rm -f "${FALLIDO}"
  log "${REMOTO:0:7}: sin cambios que desplegar"
  exit 0
fi

# ── Comprobaciones antes de tocar nada ───────────────────────────
mapfile -t PYS < <(grep '\.py$' "${T}/rel/cambiados.txt" || true)
if (( ${#PYS[@]} > 0 )); then
  if ! ( cd "${T}/arbol" && "${PY}" -m py_compile "${PYS[@]}" ) 2> "${T}/py.err"; then
    fallar "el Python no compila:
$(head -15 "${T}/py.err")"
  fi
fi
# Pruebas automáticas (CRM_PYTHON/tests) con el Python de la app. Corren como el
# usuario de la app, NUNCA como root: ejecutan código del commit nuevo. Si el venv
# aún no tiene pytest (pip install -r requirements-dev.txt), se avisa en el registro
# y se sigue, para no frenar los despliegues por eso.
VENV_PY="${APP}/CRM_PYTHON/.venv/bin/python"
if [[ -d "${T}/arbol/CRM_PYTHON/tests" ]]; then
  if "${VENV_PY}" -c "import pytest" 2>/dev/null; then
    if ! ( cd "${T}/arbol/CRM_PYTHON" && runuser -u "${APP_USER:-ubuntu}" -- \
             env -i PATH=/usr/bin:/bin HOME=/tmp "${VENV_PY}" -m pytest tests -q -p no:cacheprovider ) \
           > "${T}/pytest.out" 2>&1; then
      fallar "las pruebas automáticas fallan:
$(tail -25 "${T}/pytest.out")"
    fi
    log "pruebas OK: $(tail -1 "${T}/pytest.out")"
  else
    log "aviso: pytest no está instalado en ${VENV_PY%/bin/python}; pruebas omitidas"
  fi
fi

APLICAR="${T}/arbol/CRM_PYTHON/scripts/deploy/aplicar_release.sh"
bash -n "${APLICAR}" || fallar "aplicar_release.sh tiene errores de sintaxis"

# ── Paquete y despliegue ─────────────────────────────────────────
if [[ -s "${T}/rel/cambiados.txt" ]]; then
  tar czf "${T}/rel/release.tgz" -C "${T}/arbol" --verbatim-files-from -T "${T}/rel/cambiados.txt"
else
  tar czf "${T}/rel/release.tgz" -T /dev/null
fi
chmod 644 "${T}/rel"/*
h() { sha256sum "$1" | cut -d' ' -f1; }

log "desplegando ${ACTUAL:0:7} -> ${RESUMEN}"
if bash "${APLICAR}" "${T}/rel" "${REMOTO}" \
     "$(h "${T}/rel/release.tgz")" "$(h "${T}/rel/borrados.txt")" "$(h "${T}/rel/cambiados.txt")" \
     > "${T}/salida.txt" 2>&1; then
  rm -f "${FALLIDO}"
  avisar "CRM: desplegado ${REMOTO:0:7}" "$(printf '%s\n\nArchivos copiados: %s\nArchivos borrados: %s\nVersion anterior: %s\n\n%s' \
    "${RESUMEN}" "$(wc -l < "${T}/rel/cambiados.txt")" "$(wc -l < "${T}/rel/borrados.txt")" "${ACTUAL:0:7}" \
    "$(tail -4 "${T}/salida.txt")")"
else
  fallar "$(tail -15 "${T}/salida.txt")"
fi
