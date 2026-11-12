"""Quién puede abrir la Auditoría de llamadas (residencial/auditoria.html).

La sección es del área de Monitoreo: el team CONTROL DE CALIDAD. Además, EXTRA_IDS para
quien mantiene el auditor. Se usa en dos sitios:
  - routers/auth.py (verify-server → user.auditor): el menú muestra o no la opción.
  - main.py (serve_page): la página no se sirve a nadie más, aunque escriba la dirección.
El auditor en sí sigue siendo una app aparte (Reintento/auditor) con su propio login.
"""
import unicodedata

TEAMS = {"control de calidad"}
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
    return _norm(user.get("team")) in TEAMS
