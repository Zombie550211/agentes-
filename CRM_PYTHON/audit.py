"""
Audit log — registra acciones críticas en logs/audit.log con rotación diaria.
Formato: JSON por línea para facilitar búsquedas con grep o herramientas de log.
"""
import logging, json, os
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path
from datetime import datetime

_LOG_DIR = Path(__file__).parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)

_handler = TimedRotatingFileHandler(
    filename=str(_LOG_DIR / "audit.log"),
    when="midnight",
    backupCount=30,
    encoding="utf-8",
)
_handler.setFormatter(logging.Formatter("%(message)s"))

_logger = logging.getLogger("crm.audit")
_logger.setLevel(logging.INFO)
_logger.addHandler(_handler)
_logger.propagate = False


def _log(action: str, username: str = "", ip: str = "", extra: dict | None = None):
    entry = {
        "ts":       datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "action":   action,
        "username": username,
        "ip":       ip,
    }
    if extra:
        entry.update(extra)
    _logger.info(json.dumps(entry, ensure_ascii=False))


def log_login_ok(username: str, ip: str):
    _log("LOGIN_OK", username, ip)

def log_login_fail(username: str, ip: str):
    _log("LOGIN_FAIL", username, ip)

def log_logout(username: str, ip: str):
    _log("LOGOUT", username, ip)

def log_password_reset_request(username: str, ip: str):
    _log("PASSWORD_RESET_REQUEST", username, ip)

def log_password_reset_ok(username: str, ip: str):
    _log("PASSWORD_RESET_OK", username, ip)

def log_user_created(new_username: str, role: str, by: str, ip: str):
    _log("USER_CREATED", new_username, ip, {"role": role, "created_by": by})

def log_user_suspended(target: str, by: str, ip: str):
    _log("USER_SUSPENDED", target, ip, {"by": by})
