"""Productividad B.O — cambios de status por usuario en un día.

Para la fecha (día local UTC-6) cuenta, POR CLIENTE, solo su ÚLTIMO cambio de
status del día: si un cliente fue movido dos veces, cuenta únicamente el status
final y se atribuye al usuario que hizo ese último cambio. Fuente: tabla
activities (description 'Estado → X') con dos tracks independientes:
  - 'Cambio de estado'          → status normal (Icon, admins…)
  - 'Cambio de estado comisión' → status de comisión (lo que trabaja Back Office)
El dedupe es por (track, cliente): el último cambio normal Y el último cambio
de comisión de un mismo cliente cuentan cada uno por separado.

La tabla muestra un roster FIJO separado POR TEAM: los usuarios activos con rol
backoffice o rol_icon aparecen siempre (aunque tengan 0) agrupados por su team;
otros actores con actividad ese día se agregan bajo su propio team al final.
"""
from fastapi import APIRouter, Depends, Query
from typing import Optional
from datetime import datetime, timezone, timedelta
from sqlalchemy import text
from database_mysql import AsyncSessionLocal
from deps import current_user
import re

router = APIRouter(prefix="/api/productividad-bo", tags=["Productividad BO"])

# Offset del huso local respecto a UTC (El Salvador = UTC-6, sin horario de verano)
_LOCAL_OFFSET_HOURS = 6

# Teams fijos de la tabla: sus usuarios activos aparecen siempre (aunque con 0)
# y las secciones salen en este orden; otros teams con actividad van después.
_FIXED_TEAMS = ["TEAM BACKOFFICE", "TEAM ICON", "TEAM USA"]

# Columnas fijas; cualquier otro status presente ese día se agrega alfabético después
_STATUS_ORDER = ["COMPLETED", "CANCELLED", "HOLD", "PENDING"]
_STATUS_LABEL = {
    "COMPLETED": "Completed",
    "CANCELLED": "Cancelled",
    "HOLD":      "Hold",
    "PENDING":   "Pending",
}


def _local_today() -> str:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return (now - timedelta(hours=_LOCAL_OFFSET_HOURS)).strftime("%Y-%m-%d")


def _norm_status(desc: str) -> Optional[str]:
    if not desc or "→" not in desc:
        return None
    st = desc.split("→", 1)[1].strip().upper()
    st = re.sub(r"[^A-ZÁÉÍÓÚÑ ]", "", st).strip()
    return st or None


def _is_bo_role(role: str) -> bool:
    r = str(role or "").lower()
    return "backoffice" in r or "back office" in r or "b.o" in r


def _is_icon_role(role: str) -> bool:
    return "icon" in str(role or "").lower()


def _team_of(user_row: dict) -> str:
    """Team del usuario; si está vacío se infiere del rol."""
    t = str(user_row.get("team") or "").strip().upper()
    if t:
        return t
    role = user_row.get("role") or ""
    if _is_bo_role(role):
        return "TEAM BACKOFFICE"
    if _is_icon_role(role):
        return "TEAM ICON"
    return "OTROS"


@router.get("")
async def productividad_bo(
    fecha: Optional[str] = Query(None),
    user: dict = Depends(current_user),
):
    f = fecha if (fecha and re.match(r"^\d{4}-\d{2}-\d{2}$", fecha)) else _local_today()

    try:
        async with AsyncSessionLocal() as s:
            # Orden cronológico: al recorrer, el último cambio de cada cliente
            # sobrescribe los anteriores → queda solo el status final del día.
            r = await s.execute(text("""
                SELECT a.id, a.activity_type AS tipo, a.lead_client_name AS cliente,
                       a.actor_username AS actor, a.actor_role AS rol,
                       a.description AS descr
                FROM activities a
                WHERE a.activity_type IN ('Cambio de estado', 'Cambio de estado comisión')
                  AND DATE(a.timestamp - INTERVAL :off HOUR) = :f
                ORDER BY a.timestamp, a.id
            """), {"off": _LOCAL_OFFSET_HOURS, "f": f})
            rows = r.mappings().all()

            # Roster fijo (BO + Icon) + nombres reales para enriquecer
            ur = await s.execute(text("SELECT username, name, role, team, active FROM users"))
            users_all = ur.mappings().all()
    except Exception as exc:
        import logging
        logging.getLogger("productividad_bo").error("query error: %s", exc)
        rows, users_all = [], []

    user_by_key = {}
    for u in users_all:
        if u["username"]:
            user_by_key[u["username"].strip().lower()] = u

    # ── Dedupe por (track, cliente): solo el último cambio del día ────
    last_by_client: dict = {}
    for row in rows:
        cli = str(row["cliente"] or "").strip().lower()
        st = _norm_status(row["descr"])
        if not cli or not st:
            continue
        last_by_client[(row["tipo"], cli)] = {
            "actor": (row["actor"] or "Sistema").strip(),
            "rol":   row["rol"] or "",
            "status": st,
        }

    # ── Roster fijo: usuarios activos de los teams fijos (BO/Icon/USA) ──
    def _mk_row(agente: str, nombre: str, rol: str, team: str) -> dict:
        return {"agente": agente, "nombre": nombre, "rol": rol, "team": team,
                "counts": {}, "total": 0}

    agg: dict = {}
    order: list = []          # usernames en orden de presentación (roster primero)
    for u in users_all:
        uname = str(u["username"] or "").strip()
        if not uname or not int(u.get("active") or 0):
            continue
        team = _team_of(u)
        if (_is_bo_role(u.get("role")) or _is_icon_role(u.get("role"))
                or team in _FIXED_TEAMS):
            key = uname.lower()
            if key not in agg:
                agg[key] = _mk_row(uname, u.get("name") or "", u.get("role") or "", team)
                order.append(key)

    # ── Agregar el status FINAL de cada cliente al usuario que lo hizo ──
    statuses_present: set = set(_STATUS_ORDER)
    for item in last_by_client.values():
        st = item["status"]
        statuses_present.add(st)
        key = item["actor"].lower()
        if key not in agg:
            u = user_by_key.get(key)
            if u is not None:
                agg[key] = _mk_row(item["actor"], u.get("name") or "",
                                   item["rol"] or u.get("role") or "", _team_of(u))
            else:
                agg[key] = _mk_row(item["actor"], "", item["rol"] or "", "OTROS")
            order.append(key)
        agg[key]["counts"][st] = agg[key]["counts"].get(st, 0) + 1
        agg[key]["total"] += 1

    # Columnas: las fijas + extras presentes ese día (alfabético)
    extras = sorted(st for st in statuses_present if st not in _STATUS_ORDER)
    ordered = _STATUS_ORDER + extras
    columns = [{"key": st, "label": _STATUS_LABEL.get(st, st.title())} for st in ordered]

    filas = [agg[k] for k in order]

    # ── Agrupar por team (teams fijos en su orden, luego los demás) ──
    rows_by_team: dict = {}
    for fr in filas:
        t = fr["team"] or "OTROS"
        rows_by_team.setdefault(t, []).append(fr)
    team_order = [t for t in _FIXED_TEAMS if t in rows_by_team] + \
                 sorted(t for t in rows_by_team if t not in _FIXED_TEAMS)

    teams = []
    for t in team_order:
        t_rows = sorted(rows_by_team[t], key=lambda x: (-x["total"], x["agente"].lower()))
        t_tot = {st: 0 for st in ordered}
        for fr in t_rows:
            for st in ordered:
                t_tot[st] += fr["counts"].get(st, 0)
        teams.append({
            "team": t,
            "rows": t_rows,
            "totales": t_tot,
            "total": sum(t_tot.values()),
        })

    totales = {st: 0 for st in ordered}
    for fr in filas:
        for st in ordered:
            totales[st] += fr["counts"].get(st, 0)
    total_general = sum(totales.values())

    # ── Instalaciones del día ──────────────────────────────────────
    # instalan_hoy   = ventas cuya fecha de instalación (programada) es 'f'
    # instaladas_hoy = clientes cuyo ÚLTIMO status NORMAL del día quedó en
    #                  COMPLETED (el track de comisión no cuenta aquí)
    instalan_hoy = 0
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT COUNT(*) FROM leads
                WHERE LEFT(dia_instalacion, 10) = :f
                  AND (excluir_de_reporte = FALSE OR excluir_de_reporte IS NULL)
            """), {"f": f})
            instalan_hoy = int((r.first() or [0])[0] or 0)
    except Exception:
        pass
    instaladas_hoy = sum(
        1 for (tipo, _cli), item in last_by_client.items()
        if tipo == "Cambio de estado" and item["status"] == "COMPLETED"
    )
    # Clientes únicos cuyo status de COMISIÓN cambió ese día (trabajo de B.O.)
    # y cuántos de ellos quedaron en COMPLETED
    comisiones_hoy = sum(
        1 for (tipo, _cli) in last_by_client
        if tipo == "Cambio de estado comisión"
    )
    comisiones_completadas = sum(
        1 for (tipo, _cli), item in last_by_client.items()
        if tipo == "Cambio de estado comisión" and item["status"] == "COMPLETED"
    )

    return {
        "success": True,
        "fecha": f,
        "columns": columns,
        "rows": filas,
        "teams": teams,
        "totales": totales,
        "total_general": total_general,
        "agentes": len(filas),
        "instalan_hoy": instalan_hoy,
        "instaladas_hoy": instaladas_hoy,
        "comisiones_hoy": comisiones_hoy,
        "comisiones_completadas": comisiones_completadas,
    }
