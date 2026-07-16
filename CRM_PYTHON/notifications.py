"""Notificaciones persistentes de cambio de status.

Cuando un usuario autorizado cambia el status de un cliente (residencial o
líneas), se guarda un registro en `status_notifications` con el agente dueño
y su supervisor como destinatarios. El frontend las pide al entrar al CRM
(GET /api/notificaciones/status en routers/misc.py) y las muestra como
notificación emergente, aunque el destinatario no estuviera conectado cuando
ocurrió el cambio.

El registro es best-effort: nunca debe romper la operación principal, por eso
todo falla en silencio y se invoca con asyncio.create_task().
"""
import datetime as _dt
import random

from sqlalchemy import text
from database_mysql import AsyncSessionLocal


def _utcnow() -> _dt.datetime:
    return _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)


def _same_user(a: str, b: str) -> bool:
    """'lucia.ferman' ≈ 'Lucia Ferman' — normaliza puntos/guiones bajos y mayúsculas."""
    def _n(x: str) -> str:
        return str(x or "").replace(".", " ").replace("_", " ").strip().lower()
    return bool(_n(a)) and _n(a) == _n(b)


async def record_status_changes(items: list[dict]) -> None:
    """Inserta notificaciones de cambio de status (una por cliente).

    Cada item: {seccion, cliente, old_status, new_status, actor,
                target_agente, target_supervisor}
    Se omiten cambios sin efecto (old == new) y no se notifica al propio actor
    como agente (sí queda el supervisor como destinatario si existe).

    Además, TODO cambio con efecto se registra en status_change_log (auditoría
    de productividad Back Office), aunque no haya destinatarios de notificación.
    """
    rows, log_rows = [], []
    for it in items:
        old = str(it.get("old_status") or "").strip()
        new = str(it.get("new_status") or "").strip()
        if not new or old.lower() == new.lower():
            continue
        actor = str(it.get("actor") or "")
        base = {
            "sec":  str(it.get("seccion") or "residencial")[:20],
            "cli":  str(it.get("cliente") or "")[:200],
            "old":  old[:50],
            "new":  new[:50],
            "act":  actor[:150],
            "ts":   _utcnow(),
        }
        if actor.strip():
            log_rows.append(base)
        agente = str(it.get("target_agente") or "").strip()
        if _same_user(actor, agente):
            agente = ""  # el actor no se auto-notifica
        sup = str(it.get("target_supervisor") or "").strip()
        if not agente and not sup:
            continue
        rows.append(dict(base, ag=agente[:150] or None, sup=sup[:150] or None))
    if not rows and not log_rows:
        return
    try:
        async with AsyncSessionLocal() as s:
            for r in rows:
                await s.execute(text("""
                    INSERT INTO status_notifications
                        (seccion, cliente, old_status, new_status, actor,
                         target_agente, target_supervisor, created_at)
                    VALUES (:sec, :cli, :old, :new, :act, :ag, :sup, :ts)
                """), r)
            for r in log_rows:
                await s.execute(text("""
                    INSERT INTO status_change_log
                        (seccion, cliente, old_status, new_status, actor, created_at)
                    VALUES (:sec, :cli, :old, :new, :act, :ts)
                """), r)
            # Purga ocasional (~5% de las escrituras): las mayores de 14 días ya no se muestran
            if random.random() < 0.05:
                await s.execute(text(
                    "DELETE FROM status_notifications WHERE created_at < :lim"
                ), {"lim": _utcnow() - _dt.timedelta(days=14)})
            await s.commit()
    except Exception:
        pass  # best-effort: nunca romper el cambio de status


async def record_status_change(**item) -> None:
    """Conveniencia para un solo cliente. Mismos campos que record_status_changes."""
    await record_status_changes([item])
