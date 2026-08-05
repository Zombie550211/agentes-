#!/usr/bin/env bash
# Túnel SSH para que el entorno de desarrollo LOCAL pueda conectarse a la RDS MySQL de
# producción (AWS) — la RDS no es pública (PubliclyAccessible=false, vive en la VPC
# privada), así que solo se puede llegar a través de un host que sí esté en la VPC: el
# EC2 del backend (crm-connecting-backend).
#
# Uso:
#   bash CRM_PYTHON/scripts/dev_db_tunnel.sh
#   (dejalo corriendo en una terminal, o agregale & al final para dejarlo en background)
#
# El .env local ya apunta a 127.0.0.1:3307 (MYSQL_URL) — este script es el que hace que
# ese puerto exista. Si la IP del EC2 cambia (se para/arranca la instancia), actualizar
# EC2_IP acá abajo.

set -euo pipefail

EC2_IP="3.150.243.188"
EC2_USER="ubuntu"
SSH_KEY="$HOME/.ssh/aws-crm/crm-connecting-key.pem"
RDS_ENDPOINT="crm-connecting-db.cjcggw26guwj.us-east-2.rds.amazonaws.com"
# OJO: 3307 está tomado por el contenedor Docker local "crm-pentest-mysql"
# (127.0.0.1:3307->3306/tcp, no relacionado a este proyecto) — no reutilizar ese puerto.
LOCAL_PORT="3308"

echo "Abriendo túnel: localhost:${LOCAL_PORT} -> ${RDS_ENDPOINT}:3306 (vía ${EC2_USER}@${EC2_IP})"
exec ssh -N -o StrictHostKeyChecking=accept-new \
  -i "$SSH_KEY" \
  -L "${LOCAL_PORT}:${RDS_ENDPOINT}:3306" \
  "${EC2_USER}@${EC2_IP}"
