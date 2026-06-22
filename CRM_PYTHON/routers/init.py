from fastapi import APIRouter, Depends, Query
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
from typing import Optional
import datetime as _dt, unicodedata, re, json, calendar

def _utcnow() -> _dt.datetime:
    """UTC naive (reemplazo de datetime.utcnow() deprecado en Python 3.12+)."""
    return _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)

router = APIRouter(tags=["Init"])

_COMPLETED = {"completed","active","completado","activo","activa","vendido","cerrado","cerrada","venta cerrada"}
_PENDING   = {"pending","pendiente","pendientes"}
_CANCELLED = {"cancelled","canceled","cancelado","cancelada"}


def normalize_status(raw: str) -> str:
    s = str(raw or "").strip().lower()
    if not s:             return "pending"
    if s in _COMPLETED:   return "completed"
    if s in _PENDING:     return "pending"
    if s in _CANCELLED:   return "cancelled"
    if "cancel"  in s:    return "cancelled"
    if "pend"    in s:    return "pending"
    if any(x in s for x in ("complet","activ","cerr","vend")): return "completed"
    if "hold"    in s:    return "hold"
    if "reser"   in s:    return "reserva"
    if any(x in s for x in ("resched","reagend","reprogram")):  return "rescheduled"
    if "oficina" in s:    return "oficina"
    return "pending"


def is_completed(status: str) -> bool:
    return normalize_status(status) == "completed"


def is_pending(status: str) -> bool:
    return normalize_status(status) == "pending"


def is_cancelled(status: str) -> bool:
    return normalize_status(status) == "cancelled"


def norm_text(s: str) -> str:
    try:
        t = unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode()
        return re.sub(r"\s+", " ", t).strip().lower()
    except Exception:
        return str(s or "").strip().lower()


def is_colchon(lead: dict, ref_date: _dt.datetime) -> bool:
    try:
        dv = str(lead.get("dia_venta") or "")[:7]
        di = str(lead.get("dia_instalacion") or "")[:7]
        if not dv or not di or dv == di:
            return False
        cur = f"{ref_date.year}-{str(ref_date.month).zfill(2)}"
        # Instalado en ref_mes, vendido en mes anterior
        return di == cur and dv < cur
    except Exception:
        return False


def get_time_ago(date) -> str:
    if not isinstance(date, _dt.datetime):
        return "Hace poco"
    diff = _utcnow() - date
    mins  = int(diff.total_seconds() / 60)
    hours = mins // 60
    days  = hours // 24
    if mins < 1:   return "Hace segundos"
    if mins < 60:  return f"Hace {mins} min"
    if hours < 24: return f"Hace {hours} h"
    if days < 7:   return f"Hace {days} días"
    return date.strftime("%d/%m/%Y")


_AGENT_TO_SUP: dict = {
    "josue renderos":    "irania serrano",   "tatiana ayala":    "irania serrano",
    "giselle diaz":      "irania serrano",   "miguel nunez":     "irania serrano",
    "roxana martinez":   "irania serrano",   "irania serrano":   "irania serrano",
    "abigail galdamez":  "bryan pleitez",    "alexander rivera": "bryan pleitez",
    "diego mejia":       "bryan pleitez",    "evelin garcia":    "bryan pleitez",
    "fabricio panameno": "bryan pleitez",    "luis chavarria":   "bryan pleitez",
    "steven varela":     "bryan pleitez",
    "cindy flores":      "roberto velasquez","daniela bonilla":  "roberto velasquez",
    "francisco aguilar": "roberto velasquez","levy ceren":        "roberto velasquez",
    "lisbeth cortez":    "roberto velasquez","lucia ferman":      "roberto velasquez",
    "nelson ceren":      "roberto velasquez",
    "anderson guzman":   "johana",           "carlos grande":    "johana",
    "guadalupe santana": "johana",           "julio chavez":     "johana",
    "priscila hernandez":"johana",           "riquelmi torres":  "johana",
}


def get_supervisor_agents(supervisor_username: str) -> list:
    norm = norm_text(supervisor_username)
    return [agent for agent, sup in _AGENT_TO_SUP.items() if norm_text(sup) == norm]


def _month_range(year: int, month: int):
    _, last = calendar.monthrange(year, month)
    return f"{year}-{month:02d}-01", f"{year}-{month:02d}-{last:02d}"


def _row_to_lead(row) -> dict:
    d = dict(row)
    d["_id"] = str(d.get("id", ""))
    for col in ("servicios", "telefonos"):
        v = d.get(col)
        if isinstance(v, str):
            try: d[col] = json.loads(v)
            except (ValueError, TypeError): d[col] = []
    for col in ("dia_venta", "dia_instalacion", "created_at", "updated_at"):
        if d.get(col) is not None:
            d[col] = str(d[col])
    d["agenteNombre"] = d.get("agente_nombre") or d.get("agente")
    d["creadoEn"]     = d.get("created_at")
    return d


# ── INIT-DASHBOARD ────────────────────────────────────────────────────

@router.get("/api/init-dashboard")
async def init_dashboard(user: dict = Depends(current_user)):
    now      = _utcnow()
    role     = (user.get("role") or "").lower()
    username = user.get("username", "")

    is_admin     = any(r in role for r in ("admin","administrator","administrador","administradora"))
    is_bo        = any(r in role for r in ("backoffice","bo"))
    is_sup       = "supervisor" in role
    is_agent     = "agente" in role or "agent" in role
    is_adm_or_bo = is_admin or is_bo

    start_date, end_date = _month_range(now.year, now.month)
    sup_agents = get_supervisor_agents(username) if is_sup else []

    where  = ["""(
        (dia_venta BETWEEN :s AND :e AND (dia_instalacion IS NULL OR LEFT(dia_instalacion,7)=LEFT(dia_venta,7)))
        OR (dia_instalacion IS NOT NULL AND LEFT(dia_instalacion,7)=LEFT(:s,7) AND (dia_venta IS NULL OR LEFT(dia_venta,7)<LEFT(:s,7)))
        OR (dia_venta IS NULL AND dia_instalacion IS NULL AND created_at BETWEEN :s AND :e)
    )"""]
    params: dict = {"s": start_date, "e": end_date}

    # Supervisores ven datos globales igual que admin (sin filtrar por su equipo)
    where_sql = " AND ".join(f"({w})" for w in where)

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT id, agente_nombre, agente, puntaje, status,
                   dia_venta, dia_instalacion, created_at, nombre_cliente
            FROM leads
            WHERE {where_sql}
            ORDER BY dia_venta DESC
            LIMIT 20000
        """), params)
        leads = [_row_to_lead(row) for row in r.mappings().all()]

    ventas_leads  = [l for l in leads
                     if (is_completed(l.get("status","")) or is_pending(l.get("status","")))
                     and not is_colchon(l, now)]
    colchon_leads = [l for l in leads if is_colchon(l, now) and is_completed(l.get("status",""))]
    total_puntos  = sum(float(l.get("puntaje") or 0) for l in ventas_leads)

    kpis = {
        "ventas":         len(ventas_leads),
        "puntos":         round(total_puntos, 2),
        "mayor_vendedor": "-",
        "mejor_team":     "-",
        "canceladas":     sum(1 for l in leads if is_cancelled(l.get("status","")) and not is_colchon(l, now)),
        "pendientes":     sum(1 for l in leads if is_pending(l.get("status",""))   and not is_colchon(l, now)),
        "colchon":        len(colchon_leads),
        "colchon_puntos": round(sum(float(l.get("puntaje") or 0) for l in colchon_leads), 2),
    }

    if ventas_leads:
        agent_pts: dict = {}
        for l in ventas_leads:
            a = l.get("agenteNombre") or l.get("agente") or "-"
            agent_pts[a] = agent_pts.get(a, 0) + float(l.get("puntaje") or 0)
        top = max(agent_pts.items(), key=lambda x: x[1], default=(None, 0))
        if top[0]:
            kpis["mayor_vendedor"] = top[0]

    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("SELECT username, team FROM users"))
            users_list = r.mappings().all()
        agent_team_map = {norm_text(u["username"]): u.get("team", "Sin equipo")
                          for u in users_list if u.get("username")}
        team_pts: dict = {}
        for l in leads:
            if is_completed(l.get("status","")) and not is_colchon(l, now):
                a    = l.get("agenteNombre") or l.get("agente") or "-"
                team = agent_team_map.get(norm_text(a), "Sin equipo")
                team_pts[team] = team_pts.get(team, 0) + float(l.get("puntaje") or 0)
        top_team = max(team_pts.items(), key=lambda x: x[1], default=(None, 0))
        if top_team[0]:
            kpis["mejor_team"] = top_team[0]
    except Exception:
        pass

    agent_map:   dict = {}
    product_map: dict = {}
    for lead in ventas_leads:
        a = lead.get("agenteNombre") or lead.get("agente") or "Sin asignar"
        agent_map[a] = agent_map.get(a, 0) + 1
        services = lead.get("servicios") or []
        if isinstance(services, str): services = [services]
        if not isinstance(services, list): services = []
        for sv in services:
            if sv: product_map[sv] = product_map.get(sv, 0) + 1

    chart_teams     = sorted([{"nombre": n, "count": c} for n, c in agent_map.items()],    key=lambda x: -x["count"])[:50]
    chart_productos = sorted([{"servicio": sv, "count": c} for sv, c in product_map.items()], key=lambda x: -x["count"])[:5]

    user_personal_stats = {
        "ventasPersonales": 0, "puntosPersonales": 0,
        "posicionRanking": "-", "nombreUsuario": user.get("name") or username,
    }
    if not is_adm_or_bo:
        user_leads = [
            l for l in leads
            if (is_completed(l.get("status","")) or is_pending(l.get("status","")))
            and not is_colchon(l, now)
            and norm_text(l.get("agenteNombre") or l.get("agente") or "") == norm_text(username)
        ]
        user_personal_stats["ventasPersonales"] = len(user_leads)
        user_personal_stats["puntosPersonales"] = round(sum(float(l.get("puntaje") or 0) for l in user_leads), 2)

    if is_agent and not is_adm_or_bo:
        try:
            ag_stats: dict = {}
            for l in leads:
                if is_completed(l.get("status","")) and not is_colchon(l, now):
                    a = l.get("agenteNombre") or l.get("agente") or "-"
                    ag_stats[a] = ag_stats.get(a, 0) + float(l.get("puntaje") or 0)
            ranking = sorted(ag_stats.items(), key=lambda x: -x[1])
            pos = next((i + 1 for i, (n, _) in enumerate(ranking) if norm_text(n) == norm_text(username)), 0)
            user_personal_stats["posicionRanking"] = f"#{pos}/{len(ranking)}" if pos > 0 else "-"
        except Exception:
            pass

    return {
        "success": True, "timestamp": _utcnow().isoformat(),
        "user": {"username": username, "role": user.get("role"), "team": user.get("team","Sin equipo"), "name": user.get("name") or username},
        "kpis": kpis,
        "userStats": {
            "ventasUsuario": kpis["ventas"] if is_adm_or_bo else user_personal_stats["ventasPersonales"],
            "puntosUsuario": round(kpis["puntos"], 2) if is_adm_or_bo else user_personal_stats["puntosPersonales"],
            "equipoUsuario": user.get("team","Sin equipo"),
        },
        "userPersonalStats": user_personal_stats,
        "chartTeams": chart_teams, "chartProductos": chart_productos,
        "isAdmin": is_admin, "isBackoffice": is_bo, "isSupervisor": is_sup, "isAgent": is_agent,
        "roleInfo": {"supervisorAgents": sup_agents if is_sup else [], "viewAllUsers": is_adm_or_bo},
        "monthYear": f"{now.month}/{now.year}",
    }


# ── INIT-RANKINGS ──────────────────────────────────────────────────────

@router.get("/api/init-rankings")
async def init_rankings(user: dict = Depends(current_user)):
    now = _utcnow()
    start_date, end_date = _month_range(now.year, now.month)

    current_month_ranking = []
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT LOWER(TRIM(COALESCE(agente_nombre, agente, ''))) AS agente_key,
                       COALESCE(agente_nombre, agente) AS agente_nombre_val,
                       COALESCE(puntaje, 0) AS puntaje,
                       status
                FROM leads
                WHERE (
                    (dia_venta BETWEEN :s AND :e AND (dia_instalacion IS NULL OR LEFT(dia_instalacion,7)=LEFT(dia_venta,7)))
                    OR (dia_instalacion IS NOT NULL AND LEFT(dia_instalacion,7)=LEFT(:s,7) AND (dia_venta IS NULL OR LEFT(dia_venta,7)<LEFT(:s,7)))
                    OR (dia_venta IS NULL AND dia_instalacion IS NULL AND created_at BETWEEN :s AND :e)
                )
                AND COALESCE(agente_nombre, agente, '') != ''
            """), {"s": start_date, "e": end_date})
            rows = r.mappings().all()

        agg: dict = {}
        for row in rows:
            if not is_completed(row["status"]):
                continue
            key = row["agente_key"] or ""
            if not key:
                continue
            if key not in agg:
                agg[key] = {"nombre": row["agente_nombre_val"] or key, "sum_puntaje": 0.0, "ventas": 0}
            agg[key]["sum_puntaje"] += float(row["puntaje"] or 0)
            agg[key]["ventas"]      += 1

        sorted_agg = sorted(agg.items(), key=lambda x: (-x[1]["sum_puntaje"], -x[1]["ventas"]))[:30]
        mes_key    = f"{now.year}-{str(now.month).zfill(2)}"
        for i, (key, data) in enumerate(sorted_agg):
            pts = round(data["sum_puntaje"], 2)
            current_month_ranking.append({
                "agente": key, "nombre": data["nombre"],
                "puntos": pts, "puntaje": pts, "ventas": data["ventas"],
                "posicion": i + 1, "position": i + 1, "mes": mes_key,
            })
    except Exception:
        pass

    monthly_rankings: dict = {}
    for i in range(6):
        m = now.month - i
        y = now.year
        while m <= 0:
            m += 12; y -= 1
        ms, me  = _month_range(y, m)
        key_str = f"{y}-{str(m).zfill(2)}"
        try:
            async with AsyncSessionLocal() as s:
                r = await s.execute(text("""
                    SELECT LOWER(TRIM(COALESCE(agente, agente_nombre, ''))) AS agente_key,
                           COALESCE(agente, agente_nombre) AS agente_nombre_val,
                           COALESCE(puntaje, 0) AS puntaje,
                           status
                    FROM leads
                    WHERE (
                        (dia_venta BETWEEN :s AND :e AND (dia_instalacion IS NULL OR LEFT(dia_instalacion,7)=LEFT(dia_venta,7)))
                        OR (dia_instalacion IS NOT NULL AND LEFT(dia_instalacion,7)=LEFT(:s,7) AND (dia_venta IS NULL OR LEFT(dia_venta,7)<LEFT(:s,7)))
                        OR (dia_venta IS NULL AND dia_instalacion IS NULL AND created_at BETWEEN :s AND :e)
                    )
                    AND COALESCE(agente, agente_nombre, '') != ''
                """), {"s": ms, "e": me})
                rows2 = r.mappings().all()

            agg2: dict = {}
            for row in rows2:
                if not is_completed(row["status"]):
                    continue
                k = row["agente_key"] or ""
                if not k:
                    continue
                if k not in agg2:
                    agg2[k] = {"nombre": row["agente_nombre_val"] or k, "sum": 0.0, "ventas": 0}
                agg2[k]["sum"]    += float(row["puntaje"] or 0)
                agg2[k]["ventas"] += 1

            sorted_agg2 = sorted(agg2.items(), key=lambda x: (-x[1]["sum"], -x[1]["ventas"]))[:15]
            monthly_rankings[key_str] = [
                {"agente": k, "nombre": d["nombre"],
                 "puntos": round(d["sum"], 2), "ventas": d["ventas"],
                 "position": j + 1, "mes": key_str}
                for j, (k, d) in enumerate(sorted_agg2)
            ]
        except Exception:
            monthly_rankings[key_str] = []

    top = current_month_ranking
    return {
        "success": True, "timestamp": _utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role"), "team": user.get("team","Sin equipo")},
        "data": {
            "currentMonthRanking": current_month_ranking,
            "monthlyRankings":     monthly_rankings,
            "topThree": {
                "first":  top[0] if len(top) > 0 else None,
                "second": top[1] if len(top) > 1 else None,
                "third":  top[2] if len(top) > 2 else None,
            },
            "monthYear": f"{now.month}/{now.year}",
        },
        "ttl": 300000,
    }


# ── INIT-ESTADISTICAS ──────────────────────────────────────────────────

@router.get("/api/init-estadisticas")
async def init_estadisticas(user: dict = Depends(current_user)):
    now = _utcnow()
    ms, me = _month_range(now.year, now.month)

    date_cond = """(
        (dia_venta BETWEEN :s AND :e AND (dia_instalacion IS NULL OR LEFT(dia_instalacion,7)=LEFT(dia_venta,7)))
        OR (dia_instalacion IS NOT NULL AND LEFT(dia_instalacion,7)=LEFT(:s,7) AND (dia_venta IS NULL OR LEFT(dia_venta,7)<LEFT(:s,7)))
        OR (dia_venta IS NULL AND dia_instalacion IS NULL AND created_at BETWEEN :s AND :e)
    )"""
    params    = {"s": ms, "e": me}

    teams_data = []
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT COALESCE(supervisor, 'Sin equipo') AS supervisor,
                       status, COALESCE(puntaje, 0) AS puntaje
                FROM leads WHERE {date_cond}
            """), params)
            rows = r.mappings().all()

        agg: dict = {}
        for row in rows:
            sup = str(row["supervisor"] or "Sin equipo")
            if sup not in agg:
                agg[sup] = {"name": sup, "equipo": sup, "Total": 0, "totalVentas": 0, "ACTIVAS": 0, "Puntaje": 0.0, "porcentaje": 0}
            agg[sup]["Total"] += 1
            if is_completed(row["status"]):
                agg[sup]["totalVentas"] += 1
                agg[sup]["ACTIVAS"]     += 1
                agg[sup]["Puntaje"]     += float(row["puntaje"] or 0)
        teams_data = sorted(agg.values(), key=lambda x: -x["Total"])[:20]
        for t in teams_data:
            t["Puntaje"] = round(t["Puntaje"], 2)
    except Exception:
        pass

    agents_data = []
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT COALESCE(agente_nombre, agente) AS agente_nombre_val,
                       agente, supervisor,
                       status, COALESCE(puntaje, 0) AS puntaje
                FROM leads WHERE {date_cond}
            """), params)
            rows2 = r.mappings().all()

        agg2: dict = {}
        for row in rows2:
            key = str(row["agente_nombre_val"] or row.get("agente") or "Sin asignar")
            if key not in agg2:
                agg2[key] = {"nombre": key, "agente": row.get("agente",""), "supervisor": row.get("supervisor",""),
                             "totalClientes": 0, "totalVentas": 0, "totalPuntos": 0.0}
            agg2[key]["totalClientes"] += 1
            if is_completed(row["status"]):
                agg2[key]["totalVentas"] += 1
                agg2[key]["totalPuntos"] += float(row["puntaje"] or 0)
        agents_data = sorted(agg2.values(), key=lambda x: -x["totalPuntos"])[:30]
        for a in agents_data:
            a["totalPuntos"] = round(a["totalPuntos"], 2)
    except Exception:
        pass

    leads_chart_data = []
    try:
        date_from = (now - _dt.timedelta(days=60)).strftime("%Y-%m-%d")
        date_to   = now.strftime("%Y-%m-%d")
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT DATE_FORMAT(COALESCE(dia_venta, created_at), '%Y-%m-%d') AS fecha_key,
                       COUNT(*) AS cnt,
                       SUM(CASE WHEN LOWER(TRIM(COALESCE(status,''))) IN
                           ('completed','active','completado','activo','activa','vendido','cerrado','cerrada')
                           THEN 1 ELSE 0 END) AS completados
                FROM leads
                WHERE COALESCE(dia_venta, created_at) BETWEEN :df AND :dt
                GROUP BY fecha_key
                ORDER BY fecha_key ASC
                LIMIT 60
            """), {"df": date_from, "dt": date_to})
            leads_chart_data = [
                {"fecha": str(row["fecha_key"]), "count": int(row["cnt"]), "completados": int(row["completados"])}
                for row in r.mappings().all()
            ]
    except Exception:
        pass

    status_summary: dict = {}
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT LOWER(TRIM(COALESCE(status,''))) AS status_raw, COUNT(*) AS cnt
                FROM leads WHERE {date_cond}
                GROUP BY status_raw
                ORDER BY cnt DESC
            """), params)
            for row in r.mappings().all():
                k = normalize_status(row["status_raw"])
                status_summary[k] = status_summary.get(k, 0) + int(row["cnt"])
    except Exception:
        pass

    return {
        "success": True, "timestamp": _utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role"), "team": user.get("team","Sin equipo")},
        "data": {
            "teamsData": teams_data, "agentsData": agents_data,
            "leadsChartData": leads_chart_data, "statusSummary": status_summary,
            "monthYear": f"{now.month}/{now.year}",
        },
        "ttl": 300000,
    }


# ── INIT-ALL-PAGES ─────────────────────────────────────────────────────

@router.get("/api/init-all-pages")
async def init_all_pages(user: dict = Depends(current_user)):
    now = _utcnow()
    ms, me = _month_range(now.year, now.month)
    date_cond = """(
        (dia_venta BETWEEN :s AND :e AND (dia_instalacion IS NULL OR LEFT(dia_instalacion,7)=LEFT(dia_venta,7)))
        OR (dia_instalacion IS NOT NULL AND LEFT(dia_instalacion,7)=LEFT(:s,7) AND (dia_venta IS NULL OR LEFT(dia_venta,7)<LEFT(:s,7)))
        OR (dia_venta IS NULL AND dia_instalacion IS NULL AND created_at BETWEEN :s AND :e)
    )"""
    params    = {"s": ms, "e": me}

    customers = []
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT id, nombre_cliente, status, telefono_principal, numero_cuenta,
                       agente, agente_nombre, supervisor, dia_venta, dia_instalacion,
                       autopago, pin_seguridad, direccion, telefonos, cantidad_lineas,
                       servicios, mercado, puntaje
                FROM leads WHERE {date_cond}
                LIMIT 200
            """), params)
            customers = [_row_to_lead(row) for row in r.mappings().all()]
    except Exception:
        pass

    rankings = []
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT COALESCE(agente_nombre, agente) AS nombre_val,
                       COALESCE(puntaje, 0) AS puntaje, status
                FROM leads WHERE {date_cond}
            """), params)
            rows = r.mappings().all()

        agg: dict = {}
        for row in rows:
            if not is_completed(row["status"]):
                continue
            k = str(row["nombre_val"] or "Sin asignar")
            if k not in agg:
                agg[k] = {"sum": 0.0, "ventas": 0}
            agg[k]["sum"]    += float(row["puntaje"] or 0)
            agg[k]["ventas"] += 1
        sorted_agg = sorted(agg.items(), key=lambda x: (-x[1]["sum"], -x[1]["ventas"]))[:30]
        rankings = [
            {"agente": k, "agenteNombre": k,
             "puntaje": round(d["sum"], 2), "ventas": d["ventas"], "posicion": i + 1}
            for i, (k, d) in enumerate(sorted_agg)
        ]
    except Exception:
        pass

    stats_agg: dict = {}
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT COALESCE(supervisor, 'general') AS sup,
                       COUNT(*) AS total_leads,
                       SUM(CASE WHEN LOWER(TRIM(COALESCE(status,''))) IN
                           ('completed','active','completado','activo','activa','vendido','cerrado','cerrada')
                           THEN 1 ELSE 0 END) AS total_ventas,
                       AVG(COALESCE(puntaje, 0)) AS promedio
                FROM leads WHERE {date_cond}
                GROUP BY sup
                ORDER BY total_leads DESC
                LIMIT 15
            """), params)
            for row in r.mappings().all():
                stats_agg[str(row["sup"] or "general")] = {
                    "totalLeads": int(row["total_leads"]),
                    "totalVentas": int(row["total_ventas"]),
                    "promedio": round(float(row["promedio"] or 0)),
                }
    except Exception:
        pass

    return {
        "success": True, "timestamp": _utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role"), "team": user.get("team","Sin equipo")},
        "data": {
            "customers": customers, "leads": [], "rankings": rankings,
            "stats": stats_agg, "monthYear": f"{now.month}/{now.year}",
        },
        "ttl": 300000,
    }


# ── INIT-LEAD ──────────────────────────────────────────────────────────

@router.get("/api/init-lead")
async def init_lead(user: dict = Depends(current_user)):
    now = _utcnow()
    ms, me = _month_range(now.year, now.month)
    date_cond = "(dia_venta BETWEEN :s AND :e OR (created_at BETWEEN :s AND :e AND dia_venta IS NULL))"
    params    = {"s": ms, "e": me}

    leads_data = []
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT id, nombre_cliente, status, agente, agente_nombre, puntaje, servicios, dia_venta
                FROM leads WHERE {date_cond}
                LIMIT 200
            """), params)
            leads_data = [_row_to_lead(row) for row in r.mappings().all()]
    except Exception:
        pass

    status_summary: dict = {}
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT LOWER(TRIM(COALESCE(status,''))) AS status_raw, COUNT(*) AS cnt
                FROM leads WHERE {date_cond}
                GROUP BY status_raw
            """), params)
            for row in r.mappings().all():
                k = normalize_status(row["status_raw"])
                status_summary[k] = status_summary.get(k, 0) + int(row["cnt"])
    except Exception:
        pass

    return {
        "success": True, "timestamp": _utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role")},
        "data": {
            "leadsData": leads_data, "statusSummary": status_summary,
            "monthYear": f"{now.month}/{now.year}",
        },
        "ttl": 300000,
    }


# ── INIT-FACTURACIÓN ────────────────────────────────────────────────────

@router.get("/api/init-facturacion")
async def init_facturacion(user: dict = Depends(current_user)):
    now = _utcnow()
    ms, me = _month_range(now.year, now.month)
    date_cond = "(dia_venta BETWEEN :s AND :e OR (created_at BETWEEN :s AND :e AND dia_venta IS NULL))"
    params    = {"s": ms, "e": me}

    facturacion_data = []
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT id, nombre_cliente, numero_cuenta, status,
                       agente, agente_nombre, dia_venta, dia_instalacion,
                       cantidad_lineas, autopago
                FROM leads WHERE {date_cond}
                LIMIT 150
            """), params)
            facturacion_data = [_row_to_lead(row) for row in r.mappings().all()]
    except Exception:
        pass

    ingresos_summary = {"total": 0, "completadas": 0}
    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text(f"""
                SELECT COUNT(*) AS total_count,
                       SUM(CASE WHEN LOWER(TRIM(COALESCE(status,''))) IN
                           ('completed','active','completado','activo','activa','vendido','cerrado','cerrada')
                           THEN 1 ELSE 0 END) AS completadas
                FROM leads WHERE {date_cond}
            """), params)
            row = r.mappings().first()
            if row:
                ingresos_summary["total"]       = int(row["total_count"] or 0)
                ingresos_summary["completadas"] = int(row["completadas"] or 0)
    except Exception:
        pass

    return {
        "success": True, "timestamp": _utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role")},
        "data": {
            "facturacionData": facturacion_data,
            "ingresosSummary": ingresos_summary,
            "monthYear": f"{now.month}/{now.year}",
        },
        "ttl": 300000,
    }


# ── INIT-MULTIMEDIA ─────────────────────────────────────────────────────

@router.get("/api/init-multimedia")
async def init_multimedia(user: dict = Depends(current_user)):
    multimedia_data = []
    type_summary:   dict = {}

    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT id, file_name, file_type, uploaded_by, upload_date, file_size
                FROM media_files
                ORDER BY upload_date DESC
                LIMIT 100
            """))
            for row in r.mappings().all():
                d = dict(row)
                d["_id"]        = str(d.get("id", ""))
                d["fileName"]   = d.get("file_name")
                d["fileType"]   = d.get("file_type")
                d["uploadedBy"] = d.get("uploaded_by")
                d["uploadedAt"] = str(d["upload_date"]) if d.get("upload_date") else None
                d["fileSize"]   = d.get("file_size")
                multimedia_data.append(d)
    except Exception:
        pass

    try:
        async with AsyncSessionLocal() as s:
            r = await s.execute(text("""
                SELECT COALESCE(file_type, 'desconocido') AS ft, COUNT(*) AS cnt
                FROM media_files
                GROUP BY ft
                ORDER BY cnt DESC
            """))
            for row in r.mappings().all():
                type_summary[str(row["ft"])] = int(row["cnt"])
    except Exception:
        pass

    return {
        "success": True, "timestamp": _utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role")},
        "data": {"multimediaData": multimedia_data, "typeSummary": type_summary},
        "ttl": 300000,
    }


# ── RECENT ACTIVITY ────────────────────────────────────────────────────

@router.get("/api/recent-activity")
async def recent_activity(user: dict = Depends(current_user)):
    username = user.get("username", "")
    role     = (user.get("role") or "").lower()

    is_admin  = any(r in role for r in ("admin","administrator","administrador","administradora"))
    is_bo     = any(r in role for r in ("backoffice","bo"))
    is_sup    = "supervisor" in role
    is_agent  = "agente" in role or "agent" in role

    sup_agents     = get_supervisor_agents(username) if is_sup else []
    users_for_data = None
    if is_sup:                                    users_for_data = sup_agents
    elif is_agent and not is_admin and not is_bo: users_for_data = [username]

    last_date = (_utcnow() - _dt.timedelta(days=30)).strftime("%Y-%m-%d")
    date_cond = "(dia_venta >= :ld OR created_at >= :ld)"
    params: dict = {"ld": last_date}

    where = [date_cond]
    if users_for_data:
        ph = ", ".join([f":u{i}" for i in range(len(users_for_data))])
        where.append(f"(LOWER(COALESCE(agente_nombre,'')) IN ({ph}) OR LOWER(COALESCE(agente,'')) IN ({ph}))")
        for i, u in enumerate(users_for_data):
            params[f"u{i}"] = u.lower()

    where_sql = " AND ".join(f"({w})" for w in where)

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT id, nombre_cliente, agente_nombre, agente, status, servicios,
                   puntaje, created_at, dia_venta
            FROM leads
            WHERE {where_sql}
            ORDER BY COALESCE(dia_venta, created_at) DESC
            LIMIT 50
        """), params)
        activities = r.mappings().all()

    formatted = []
    for lead in activities:
        agent    = lead.get("agente_nombre") or lead.get("agente") or "—"
        client   = lead.get("nombre_cliente") or "Cliente sin nombre"
        services = lead.get("servicios") or "Servicio general"
        if isinstance(services, str):
            try: services = json.loads(services)
            except (ValueError, TypeError): pass
        if isinstance(services, list):
            services = services[0] if services else "Servicio general"
        norm_st  = normalize_status(lead.get("status",""))
        act_type = {
            "completed": "Venta cerrada", "cancelled": "Cancelación",
            "hold": "En espera", "rescheduled": "Reagendado", "pending": "Seguimiento",
        }.get(norm_st, "Nuevo")
        date_c   = lead.get("dia_venta") or lead.get("created_at") or _utcnow()
        if not isinstance(date_c, _dt.datetime):
            try: date_c = _dt.datetime.strptime(str(date_c)[:10], "%Y-%m-%d")
            except (ValueError, TypeError): date_c = _utcnow()
        formatted.append({
            "id": str(lead["id"]), "nombre_cliente": client, "agente": agent,
            "servicio": services, "tipo_actividad": act_type, "status": norm_st,
            "fecha": str(date_c), "tiempo_relativo": get_time_ago(date_c),
        })

    return {"success": True, "data": formatted}


# ── AGENT HISTORY ──────────────────────────────────────────────────────

@router.get("/api/agent-history")
async def agent_history(
    agente:      Optional[str] = Query(None),
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    limit:       Optional[int] = Query(None),
    user: dict = Depends(current_user),
):
    username = user.get("username", "")
    role     = (user.get("role") or "").lower()

    is_admin = any(r in role for r in ("admin","administrator","administrador","administradora","backoffice","bo"))
    is_sup   = "supervisor" in role
    is_agent = "agente" in role or "agent" in role

    hard_limit = min(int(limit) if limit else 300, 500)
    if is_agent and not is_admin and not is_sup:
        agente = username

    now_sv       = _utcnow() - _dt.timedelta(hours=6)
    _, last_day  = calendar.monthrange(now_sv.year, now_sv.month)
    default_start = f"{now_sv.year}-{now_sv.month:02d}-01"
    default_end   = f"{now_sv.year}-{now_sv.month:02d}-{last_day:02d}"

    try:
        date_from = (fechaInicio or default_start)
    except Exception:
        date_from = default_start
    try:
        date_to = (fechaFin or default_end)
    except Exception:
        date_to = default_end

    act_where  = ["timestamp BETWEEN :df AND :dt"]
    act_params: dict = {"df": date_from + " 00:00:00", "dt": date_to + " 23:59:59", "lim": hard_limit}
    if agente:
        act_where.append("LOWER(actor_username) = :ag")
        act_params["ag"] = agente.lower()

    act_where_sql = " AND ".join(f"({w})" for w in act_where)

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT id, activity_type, lead_client_name, description,
                   actor_username, actor_role, timestamp, campos, new_status, old_status
            FROM activities
            WHERE {act_where_sql}
            ORDER BY timestamp DESC
            LIMIT :lim
        """), act_params)
        raw_acts = r.mappings().all()

    lead_where  = ["(dia_venta BETWEEN :df2 AND :dt2 OR (created_at BETWEEN :df2 AND :dt2 AND dia_venta IS NULL))"]
    lead_params: dict = {"df2": date_from, "dt2": date_to}
    if agente:
        lead_where.append("LOWER(COALESCE(agente_nombre, agente, '')) = :lag")
        lead_params["lag"] = agente.lower()

    lead_where_sql = " AND ".join(f"({w})" for w in lead_where)

    async with AsyncSessionLocal() as s:
        r2 = await s.execute(text(f"""
            SELECT id, nombre_cliente, status, servicios, puntaje, agente_nombre, created_at, dia_venta
            FROM leads
            WHERE {lead_where_sql}
            LIMIT 1000
        """), lead_params)
        leads = r2.mappings().all()

    ventas_cerradas = sum(1 for l in leads if normalize_status(l.get("status","")) == "completed")
    cancelaciones   = sum(1 for l in leads if normalize_status(l.get("status","")) == "cancelled")
    puntaje_total   = sum(float(l.get("puntaje") or 0) for l in leads)
    leads_creados   = sum(1 for a in raw_acts if a.get("activity_type") in ("Lead creado","Venta ingresada"))

    def _ts(dt) -> Optional[str]:
        if not isinstance(dt, _dt.datetime):
            if dt:
                try: dt = _dt.datetime.strptime(str(dt)[:19], "%Y-%m-%d %H:%M:%S")
                except (ValueError, TypeError): return None
            else:
                return None
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    actividades = []
    for a in raw_acts:
        campos_raw = a.get("campos")
        if isinstance(campos_raw, str):
            try: campos_raw = json.loads(campos_raw)
            except (ValueError, TypeError): pass
        actividades.append({
            "id":          str(a["id"]),
            "tipo":        a.get("activity_type") or "Acción",
            "cliente":     a.get("lead_client_name") or "—",
            "descripcion": a.get("description") or "",
            "agente":      a.get("actor_username") or agente or "—",
            "rol":         a.get("actor_role") or "",
            "fecha":       _ts(a.get("timestamp")),
            "extra":       {"campos": campos_raw, "new_status": a.get("new_status"), "old_status": a.get("old_status")},
        })

    by_day: dict = {}
    for act in actividades:
        if act["fecha"]:
            try:
                utc_dt = _dt.datetime.strptime(act["fecha"], "%Y-%m-%dT%H:%M:%SZ")
                sv_dt  = utc_dt - _dt.timedelta(hours=6)
                key    = sv_dt.strftime("%Y-%m-%d")
            except ValueError:
                key = "sin-fecha"
        else:
            key = "sin-fecha"
        by_day.setdefault(key, []).append(act)

    por_dia = [
        {"fecha": k, "total": len(items), "items": items}
        for k, items in sorted(by_day.items(), reverse=True)
    ]

    return {
        "success": True,
        "agente":  agente or None,
        "periodo": {"desde": date_from, "hasta": date_to},
        "resumen": {
            "totalActividades": len(raw_acts),
            "ventasCerradas":   ventas_cerradas,
            "leadsCreados":     leads_creados,
            "cancelaciones":    cancelaciones,
            "puntajeTotal":     round(puntaje_total, 2),
        },
        "porDia":      por_dia,
        "actividades": actividades,
    }
