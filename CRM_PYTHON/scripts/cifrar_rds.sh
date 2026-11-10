#!/usr/bin/env bash
# Cifrado del disco de la base de producción (RDS crm-connecting-db). Se corre desde la PC.
#
# AWS no cifra una base que ya existe: se hace una foto con el CRM parado, una copia
# cifrada de esa foto y una base nueva desde la copia. Al final se INTERCAMBIAN LOS
# NOMBRES (la vieja pasa a crm-connecting-db-viejo y la nueva toma crm-connecting-db),
# así la dirección de la base no cambia y no hay que tocar el .env del CRM, el backup
# del EC2 ni nada más.
#
# Pasos (cada uno se lanza a mano y se comprueba antes de seguir):
#   bash cifrar_rds.sh comprobar     # antes de empezar: todo en orden, sin tocar nada
#   bash cifrar_rds.sh parar         # CORTE: para el CRM y el auto-despliegue, cuenta filas
#   bash cifrar_rds.sh foto          # foto manual de la base parada
#   bash cifrar_rds.sh copiar        # copia cifrada de la foto
#   bash cifrar_rds.sh restaurar     # base nueva cifrada (crm-connecting-db-cifrada)
#   bash cifrar_rds.sh actualizar    # sube la base NUEVA de MySQL 8.0 a 8.4 (~15-25 min)
#   bash cifrar_rds.sh intercambiar  # vieja → -viejo, nueva → crm-connecting-db
#   bash cifrar_rds.sh arrancar      # arranca el CRM, cuenta filas y compara
#   bash cifrar_rds.sh probar-backup # corre el backup real del EC2 contra la base 8.4
#   bash cifrar_rds.sh revertir      # si algo sale mal: vuelve a la base vieja
#
# La base vieja NO se borra: queda como crm-connecting-db-viejo, intacta, hasta decidirlo.
#
# MySQL 8.4: la 8.0 ya no tiene soporte estándar y AWS cobra «Extended Support»
# (~149 USD/mes en esta base). Se aprovecha el mismo corte: la base nueva se sube a 8.4
# ANTES del intercambio, así la vieja queda intacta en 8.0 como plan de vuelta atrás.
# Si «actualizar» falla, la nueva sigue en 8.0 y se puede seguir con el cifrado solo.
# OJO: mientras exista crm-connecting-db-viejo (8.0) se sigue pagando Extended Support
# por ella. Tras 2-3 días sin problemas: foto final y borrarla.
set -euo pipefail

REGION="us-east-2"
VIEJA="crm-connecting-db"
RENOMBRADA="crm-connecting-db-viejo"
NUEVA="crm-connecting-db-cifrada"
DIA="$(date +%Y%m%d)"
FOTO="cifrado-${DIA}-sin-cifrar"
COPIA="cifrado-${DIA}-cifrada"
VERSION_84="8.4.13"          # destino válido desde 8.0.46 (describe-db-engine-versions, 10-nov)
PARAMS_84="default.mysql8.4"
OPCIONES_84="default:mysql-8-4"
EC2="ubuntu@3.150.243.188"
KEY="$HOME/.ssh/aws-crm/crm-connecting-key.pem"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/logs/cifrado-rds"
mkdir -p "$DIR"
AWSR=(aws --region "$REGION")
SSH=(ssh -i "$KEY" -o ConnectTimeout=15 "$EC2")

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$DIR/registro.log"; }
estado() { "${AWSR[@]}" rds describe-db-instances --db-instance-identifier "$1" \
             --query 'DBInstances[0].[DBInstanceStatus,StorageEncrypted]' --output text 2>/dev/null || echo "no-existe"; }
version() { "${AWSR[@]}" rds describe-db-instances --db-instance-identifier "$1" \
             --query 'DBInstances[0].EngineVersion' --output text 2>/dev/null || echo "no-existe"; }

# Filas por tabla (COUNT exacto) con las credenciales del EC2; no salen del servidor.
# Espera a que la base con ese nombre exista y esté disponible. «aws rds wait» no sirve
# tras renombrar: falla si el nombre nuevo aún no existe (ensayo del 10-nov: tarda ~1¼ min).
esperar() {
  for _ in $(seq 1 120); do
    [[ "$(estado "$1")" == available* ]] && return 0
    sleep 10
  done
  log "ERROR: $1 no quedó disponible en 20 min"; return 1
}

contar() {
  "${SSH[@]}" 'cd ~ && ~/app/CRM_PYTHON/.venv/bin/python -c "
import prod_export_cambios as p
cn,b=p.conectar(); c=cn.cursor()
c.execute(\"SELECT table_name t FROM information_schema.tables WHERE table_schema=%s AND table_type=\x27BASE TABLE\x27 ORDER BY 1\",(b,))
for r in c.fetchall():
    c.execute(\"SELECT COUNT(*) n FROM \`%s\`\" % r[\"t\"]); print(r[\"t\"], c.fetchone()[\"n\"])
"'
}

case "${1:-}" in
comprobar)
  log "== comprobación previa (no toca nada)"
  log "base actual: $(estado "$VIEJA")"
  log "nombre -viejo libre: $(estado "$RENOMBRADA")"
  log "nombre -cifrada libre: $(estado "$NUEVA")"
  "${SSH[@]}" 'systemctl is-active crm-backend nginx crm-auto-desplegar.timer; sudo -n true && echo "sudo OK"'
  "${SSH[@]}" 'sudo -n tail -2 /var/log/crm-backup.log'
  # ── Para el paso a 8.4 ──
  log "versión actual: $(version "$VIEJA") → destino ${VERSION_84}"
  "${AWSR[@]}" rds describe-db-engine-versions --engine mysql --engine-version "$(version "$VIEJA")" \
    --query 'DBEngineVersions[0].ValidUpgradeTarget[].EngineVersion' --output text | tr '\t' '\n' \
    | grep -qx "$VERSION_84" && log "destino ${VERSION_84} válido" || log "AVISO: ${VERSION_84} no es destino válido"
  "${SSH[@]}" 'mysqldump --version'
  # Método de login del usuario del CRM. En 8.4 «mysql_native_password» viene desactivado;
  # PyMySQL+cryptography soporta también caching_sha2_password, así que no bloquea.
  "${SSH[@]}" 'cd ~ && ~/app/CRM_PYTHON/.venv/bin/python -c "
import prod_export_cambios as p
cn,b=p.conectar(); c=cn.cursor()
c.execute(\"SELECT CURRENT_USER() u, VERSION() v\"); print(c.fetchone())
try:
    c.execute(\"SELECT user, plugin FROM mysql.user WHERE CONCAT(user,\x27@\x27,host)=CURRENT_USER()\"); print(c.fetchone())
except Exception as e: print(\"sin permiso para ver el plugin:\", e)
"'
  ;;

parar)
  log "== CORTE: parando el CRM"
  "${SSH[@]}" 'sudo -n systemctl stop crm-auto-desplegar.timer crm-backend && systemctl is-active crm-backend || true'
  contar > "$DIR/filas-antes.txt"
  log "filas contadas: $(wc -l < "$DIR/filas-antes.txt") tablas (logs/cifrado-rds/filas-antes.txt)"
  ;;

foto)
  log "== foto manual ${FOTO}"
  "${AWSR[@]}" rds create-db-snapshot --db-instance-identifier "$VIEJA" --db-snapshot-identifier "$FOTO" >/dev/null
  "${AWSR[@]}" rds wait db-snapshot-available --db-snapshot-identifier "$FOTO"
  log "foto lista"
  ;;

copiar)
  log "== copia cifrada ${COPIA}"
  "${AWSR[@]}" rds copy-db-snapshot --source-db-snapshot-identifier "$FOTO" \
    --target-db-snapshot-identifier "$COPIA" --kms-key-id alias/aws/rds --copy-tags >/dev/null
  "${AWSR[@]}" rds wait db-snapshot-available --db-snapshot-identifier "$COPIA"
  log "copia lista, cifrada: $("${AWSR[@]}" rds describe-db-snapshots --db-snapshot-identifier "$COPIA" --query 'DBSnapshots[0].Encrypted' --output text)"
  ;;

restaurar)
  log "== base nueva ${NUEVA} (mismos ajustes que la actual)"
  "${AWSR[@]}" rds restore-db-instance-from-db-snapshot \
    --db-instance-identifier "$NUEVA" --db-snapshot-identifier "$COPIA" \
    --db-instance-class db.t3.small --storage-type gp3 \
    --db-subnet-group-name crm-db-subnet-group --vpc-security-group-ids sg-09014319db12970ba \
    --db-parameter-group-name default.mysql8.0 --availability-zone us-east-2c \
    --no-publicly-accessible --no-multi-az --deletion-protection --copy-tags-to-snapshot \
    --ca-certificate-identifier rds-ca-rsa2048-g1 --auto-minor-version-upgrade >/dev/null
  "${AWSR[@]}" rds wait db-instance-available --db-instance-identifier "$NUEVA"
  # La restauración no copia la retención de backups ni las ventanas: se ponen como la vieja.
  "${AWSR[@]}" rds modify-db-instance --db-instance-identifier "$NUEVA" --apply-immediately \
    --backup-retention-period 7 --preferred-backup-window 05:05-05:35 \
    --preferred-maintenance-window sun:05:35-sun:06:05 >/dev/null
  sleep 20; esperar "$NUEVA"
  log "base nueva lista: $(estado "$NUEVA")"
  ;;

actualizar)
  [[ "$(estado "$NUEVA")" == "available"*"True" ]] || { log "ERROR: la nueva no está lista y cifrada"; exit 1; }
  log "== $NUEVA: MySQL $(version "$NUEVA") → ${VERSION_84}"
  # RDS hace sus propias comprobaciones de compatibilidad antes de subir; si fallan,
  # cancela, deja la base en 8.0 y lo explica en un evento y en el log PrePatchCompatibility.
  "${AWSR[@]}" rds modify-db-instance --db-instance-identifier "$NUEVA" \
    --engine-version "$VERSION_84" --allow-major-version-upgrade \
    --db-parameter-group-name "$PARAMS_84" --option-group-name "$OPCIONES_84" \
    --apply-immediately >/dev/null
  sleep 60; esperar "$NUEVA"
  V="$(version "$NUEVA")"
  if [[ "$V" == "$VERSION_84" ]]; then
    log "base nueva en MySQL $V: $(estado "$NUEVA")"
  else
    log "ERROR: la subida no se aplicó (sigue en $V). Eventos recientes:"
    "${AWSR[@]}" rds describe-events --source-type db-instance --source-identifier "$NUEVA" \
      --duration 60 --query 'Events[].[Date,Message]' --output text | tail -8 | tee -a "$DIR/registro.log"
    log "Se puede seguir SOLO con el cifrado (intercambiar) y dejar 8.4 para otro día."
    exit 1
  fi
  ;;

intercambiar)
  [[ "$(estado "$NUEVA")" == "available"*"True" ]] || { log "ERROR: la nueva no está lista y cifrada"; exit 1; }
  log "== $VIEJA → $RENOMBRADA"
  "${AWSR[@]}" rds modify-db-instance --db-instance-identifier "$VIEJA" \
    --new-db-instance-identifier "$RENOMBRADA" --apply-immediately >/dev/null
  sleep 20; esperar "$RENOMBRADA"
  log "== $NUEVA → $VIEJA"
  "${AWSR[@]}" rds modify-db-instance --db-instance-identifier "$NUEVA" \
    --new-db-instance-identifier "$VIEJA" --apply-immediately >/dev/null
  sleep 20; esperar "$VIEJA"
  log "intercambio hecho: $VIEJA = $(estado "$VIEJA"), MySQL $(version "$VIEJA")"
  ;;

arrancar)
  contar > "$DIR/filas-despues.txt"
  if diff -q "$DIR/filas-antes.txt" "$DIR/filas-despues.txt" >/dev/null; then
    log "filas IDÉNTICAS en $(wc -l < "$DIR/filas-despues.txt") tablas"
  else
    log "ERROR: las filas no coinciden — NO se arranca. Ver: diff logs/cifrado-rds/filas-*.txt"
    diff "$DIR/filas-antes.txt" "$DIR/filas-despues.txt" | head -20
    exit 1
  fi
  "${SSH[@]}" 'sudo -n systemctl start crm-backend crm-auto-desplegar.timer; sleep 5; systemctl is-active crm-backend; curl -s -o /dev/null -w "login: HTTP %{http_code}\n" https://connecting.lat/login.html'
  log "CRM arrancado sobre la base cifrada (MySQL $(version "$VIEJA"))"
  ;;

probar-backup)
  # El backup diario usa el mysqldump del EC2: se corre ya, a mano, para no enterarse
  # a las 03:00 de que no funciona contra 8.4. Lee la ruta del script del propio cron.
  log "== backup de prueba contra MySQL $(version "$VIEJA")"
  "${SSH[@]}" 'S=$(grep -o "/[^ ]*backup[^ ]*\.sh" /etc/cron.d/crm-backup | head -1); echo "script: $S"; sudo -n "$S" 2>&1 | tail -5; sudo -n tail -3 /var/log/crm-backup.log 2>/dev/null' | tee -a "$DIR/registro.log"
  ;;

revertir)
  log "== REVERTIR: volver a la base sin cifrar"
  "${SSH[@]}" 'sudo -n systemctl stop crm-backend' || true
  if [[ "$(estado "$RENOMBRADA")" != "no-existe" ]]; then
    if [[ "$(estado "$VIEJA")" != "no-existe" ]]; then
      "${AWSR[@]}" rds modify-db-instance --db-instance-identifier "$VIEJA" \
        --new-db-instance-identifier "${NUEVA}-descartada" --apply-immediately >/dev/null
      sleep 20; esperar "${NUEVA}-descartada"
    fi
    "${AWSR[@]}" rds modify-db-instance --db-instance-identifier "$RENOMBRADA" \
      --new-db-instance-identifier "$VIEJA" --apply-immediately >/dev/null
    sleep 20; esperar "$VIEJA"
  fi
  "${SSH[@]}" 'sudo -n systemctl start crm-backend crm-auto-desplegar.timer; sleep 5; systemctl is-active crm-backend'
  log "revertido: el CRM usa otra vez la base original ($(estado "$VIEJA"))"
  ;;

*) sed -n '2,/^set -euo/p' "$0" | sed '$d'; exit 1 ;;
esac
