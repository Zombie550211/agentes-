"""Quién puede abrir la Auditoría de llamadas (residencial/auditoria.html).

La sección es de Monitoreo (el team CONTROL DE CALIDAD), administración (los mismos roles que
ADMIN_ROLES de deps.py) y Back Office. El resto (agentes, supervisores, Líneas, roles de mercado)
no la ve: para ellos habrá otra interfaz. Además, EXTRA_IDS para quien mantiene el auditor. Se usa en tres sitios:
  - routers/auth.py (verify-server → user.auditor): el menú muestra o no la opción.
  - main.py (serve_page): la página no se sirve a nadie más, aunque escriba la dirección.
  - routers/auth.py (/api/auth/auditoria): el panel /auditor/ usa la sesión del CRM.
El panel del auditor corre aparte (Reintento/auditor/panel), pero sin login propio: usa esta regla.
"""
import unicodedata

TEAMS = {"control de calidad"}
ROLES = {"admin", "administrador", "administrativo", "administrator", "administrador general"}
EXTRA_IDS = {2}   # Daniel Martinez


def _norm(s) -> str:
    s = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
    return " ".join(s.lower().split())


def puede_ver(user: dict | None) -> bool:
    if not user:
        return False
    try:
        if int(user.get("id") or 0) in EXTRA_IDS:
            return True
    except (TypeError, ValueError):
        pass
    rol = _norm(user.get("role"))
    es_bo = "backoffice" in rol or "back office" in rol or "back_office" in rol or rol == "bo"
    return _norm(user.get("team")) in TEAMS or rol in ROLES or es_bo
