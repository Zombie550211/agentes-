from fastapi import APIRouter, Depends, Query
from database import get_db
from deps import current_user
from typing import Optional
import datetime as _dt, unicodedata, re

router = APIRouter(tags=["Init"])

# ── Status helpers (mirrors statusNormalizer.js) ─────────────────
_COMPLETED  = {"completed","active","completado","activo","activa","vendido","cerrado","cerrada","venta cerrada"}
_PENDING    = {"pending","pendiente","pendientes"}
_CANCELLED  = {"cancelled","canceled","cancelado","cancelada"}
_COMPLETED_LOWER = list(_COMPLETED - {"venta cerrada"})

COMPLETED_MATCH_EXPR = {"$in": [{"$toLower": {"$ifNull": ["$status", ""]}}, _COMPLETED_LOWER]}


def normalize_status(raw: str) -> str:
    s = str(raw or "").strip().lower()
    if not s:            return "pending"
    if s in _COMPLETED:  return "completed"
    if s in _PENDING:    return "pending"
    if s in _CANCELLED:  return "cancelled"
    if "cancel"  in s:   return "cancelled"
    if "pend"    in s:   return "pending"
    if any(x in s for x in ("complet","activ","cerr","vend")): return "completed"
    if "hold"    in s:   return "hold"
    if "reser"   in s:   return "reserva"
    if any(x in s for x in ("resched","reagend","reprogram")):  return "rescheduled"
    if "oficina" in s:   return "oficina"
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
        dv = str(lead.get("dia_venta") or lead.get("diaVenta") or "")[:7]
        di = str(lead.get("dia_instalacion") or lead.get("diaInstalacion") or "")[:7]
        if not dv or not di:
            return False
        cur = f"{ref_date.year}-{str(ref_date.month).zfill(2)}"
        return dv != cur and di == cur
    except Exception:
        return False


def get_time_ago(date) -> str:
    if not isinstance(date, _dt.datetime):
        return "Hace poco"
    diff = _dt.datetime.utcnow() - date
    mins = int(diff.total_seconds() / 60)
    hours = mins // 60
    days  = hours // 24
    if mins < 1:   return "Hace segundos"
    if mins < 60:  return f"Hace {mins} min"
    if hours < 24: return f"Hace {hours} h"
    if days < 7:   return f"Hace {days} días"
    return date.strftime("%d/%m/%Y")


# Supervisor → agents map (mirrors AGENT_TO_SUP in server.js)
_AGENT_TO_SUP: dict[str, str] = {
    "josue renderos": "irania serrano",   "tatiana ayala": "irania serrano",
    "giselle diaz":   "irania serrano",   "miguel nunez":  "irania serrano",
    "roxana martinez":"irania serrano",   "irania serrano":"irania serrano",
    "abigail galdamez":"bryan pleitez",   "alexander rivera":"bryan pleitez",
    "diego mejia":    "bryan pleitez",    "evelin garcia":  "bryan pleitez",
    "fabricio panameno":"bryan pleitez",  "luis chavarria": "bryan pleitez",
    "steven varela":  "bryan pleitez",
    "cindy flores":   "roberto velasquez","daniela bonilla":"roberto velasquez",
    "francisco aguilar":"roberto velasquez","levy ceren":   "roberto velasquez",
    "lisbeth cortez": "roberto velasquez","lucia ferman":   "roberto velasquez",
    "nelson ceren":   "roberto velasquez",
    "anderson guzman":"johana",           "carlos grande":  "johana",
    "guadalupe santana":"johana",         "julio chavez":   "johana",
    "priscila hernandez":"johana",        "riquelmi torres":"johana",
}


def get_supervisor_agents(supervisor_username: str) -> list[str]:
    norm = norm_text(supervisor_username)
    return [agent for agent, sup in _AGENT_TO_SUP.items() if norm_text(sup) == norm]


def _month_range(year: int, month: int):
    import calendar
    _, last = calendar.monthrange(year, month)
    start = _dt.datetime(year, month, 1)
    end   = _dt.datetime(year, month, last, 23, 59, 59)
    return start, end


def _serialize(docs: list) -> list:
    for d in docs:
        if "_id" in d:
            d["_id"] = str(d["_id"])
    return docs


# ── INIT-DASHBOARD ────────────────────────────────────────────────
@router.get("/api/init-dashboard")
async def init_dashboard(user: dict = Depends(current_user)):
    db = get_db()
    now = _dt.datetime.utcnow()
    role = (user.get("role") or "").lower()
    username = user.get("username", "")

    is_admin  = any(r in role for r in ("admin", "administrator", "administrador", "administradora"))
    is_bo     = any(r in role for r in ("backoffice", "bo"))
    is_sup    = "supervisor" in role
    is_agent  = "agente" in role or "agent" in role
    is_adm_or_bo = is_admin or is_bo

    month_start, month_end = _month_range(now.year, now.month)
    month_start_str = f"{now.year}-{str(now.month).zfill(2)}-01"
    next_d = _dt.datetime(now.year, now.month + 1, 1) if now.month < 12 else _dt.datetime(now.year + 1, 1, 1)
    month_end_str   = f"{next_d.year}-{str(next_d.month).zfill(2)}-01"

    date_conditions = [
        {"dia_venta":          {"$gte": month_start, "$lt": month_end}},
        {"dia_venta":          {"$gte": month_start_str, "$lt": month_end_str}},
        {"fecha_contratacion": {"$gte": month_start, "$lt": month_end}},
        {"creadoEn":           {"$gte": month_start, "$lt": month_end}},
        {"createdAt":          {"$gte": month_start, "$lt": month_end}},
    ]

    sup_agents = get_supervisor_agents(username) if is_sup else []
    user_filter = {}
    if is_sup and sup_agents:
        user_filter = {"$or": [
            {"agenteNombre": {"$in": sup_agents}},
            {"agente": {"$in": sup_agents}},
            {"usuario": {"$in": sup_agents}},
        ]}

    base_filter = {"$or": date_conditions}
    filt = {"$and": [base_filter, user_filter]} if user_filter else base_filter

    leads = await db["costumers_unified"].find(filt, {
        "_id": 1, "agenteNombre": 1, "agente": 1, "usuario": 1,
        "servicios": 1, "tipo_servicios": 1, "tipo_servicio": 1, "servicios_texto": 1,
        "puntaje": 1, "status": 1, "dia_venta": 1, "dia_instalacion": 1,
        "creadoEn": 1, "createdAt": 1, "nombre_cliente": 1,
    }).sort("dia_venta", -1).limit(20000).to_list(None)

    ventas_leads  = [l for l in leads if (is_completed(l.get("status","")) or is_pending(l.get("status",""))) and not is_colchon(l, now)]
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
        users_list = await db["users"].find({}, {"username": 1, "team": 1}).to_list(None)
        agent_team_map = {norm_text(u["username"]): u.get("team", "Sin equipo") for u in users_list if u.get("username")}
        team_pts: dict = {}
        for l in leads:  # reutiliza la query ya hecha
            if is_completed(l.get("status", "")) and not is_colchon(l, now):
                a    = l.get("agenteNombre") or l.get("agente") or l.get("usuario") or "-"
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
        services = lead.get("servicios") or lead.get("tipo_servicios") or lead.get("tipo_servicio") or lead.get("servicios_texto") or []
        if isinstance(services, str): services = [services]
        if not isinstance(services, list): services = []
        for s in services:
            if s: product_map[s] = product_map.get(s, 0) + 1

    chart_teams     = sorted([{"nombre": n, "count": c} for n, c in agent_map.items()],   key=lambda x: -x["count"])[:50]
    chart_productos = sorted([{"servicio": s, "count": c} for s, c in product_map.items()], key=lambda x: -x["count"])[:5]

    user_personal_stats = {
        "ventasPersonales": 0, "puntosPersonales": 0,
        "posicionRanking": "-", "nombreUsuario": user.get("name") or username,
    }
    if not is_adm_or_bo:
        user_leads = [
            l for l in leads
            if (is_completed(l.get("status","")) or is_pending(l.get("status","")))
            and not is_colchon(l, now)
            and norm_text(l.get("agenteNombre") or l.get("agente") or l.get("usuario") or "") == norm_text(username)
        ]
        user_personal_stats["ventasPersonales"] = len(user_leads)
        user_personal_stats["puntosPersonales"] = round(sum(float(l.get("puntaje") or 0) for l in user_leads), 2)

    if is_agent and not is_adm_or_bo:
        try:
            ag_stats: dict = {}
            for l in leads:  # reutiliza la query ya hecha
                if is_completed(l.get("status","")) and not is_colchon(l, now):
                    a = l.get("agenteNombre") or l.get("agente") or "-"
                    ag_stats[a] = ag_stats.get(a, 0) + float(l.get("puntaje") or 0)
            ranking = sorted(ag_stats.items(), key=lambda x: -x[1])
            pos = next((i + 1 for i, (n, _) in enumerate(ranking) if norm_text(n) == norm_text(username)), 0)
            user_personal_stats["posicionRanking"] = f"#{pos}/{len(ranking)}" if pos > 0 else "-"
        except Exception:
            pass

    return {
        "success": True, "timestamp": _dt.datetime.utcnow().isoformat(),
        "user": {"username": username, "role": user.get("role"), "team": user.get("team","Sin equipo"), "name": user.get("name") or username},
        "kpis": kpis,
        "userStats": {
            "ventasUsuario": kpis["ventas"] if is_adm_or_bo else user_personal_stats["ventasPersonales"],
            "puntosUsuario": round(kpis["puntos"], 2) if is_adm_or_bo else user_personal_stats["puntosPersonales"],
            "equipoUsuario": user.get("team", "Sin equipo"),
        },
        "userPersonalStats": user_personal_stats,
        "chartTeams": chart_teams, "chartProductos": chart_productos,
        "isAdmin": is_admin, "isBackoffice": is_bo, "isSupervisor": is_sup, "isAgent": is_agent,
        "roleInfo": {"supervisorAgents": sup_agents if is_sup else [], "viewAllUsers": is_adm_or_bo},
        "monthYear": f"{now.month}/{now.year}",
    }


# ── INIT-RANKINGS ─────────────────────────────────────────────────
@router.get("/api/init-rankings")
async def init_rankings(user: dict = Depends(current_user)):
    db  = get_db()
    now = _dt.datetime.utcnow()
    month_start, month_end = _month_range(now.year, now.month)

    current_month_ranking = []
    try:
        pipeline = [
            {"$match": {"$or": [
                {"createdAt": {"$gte": month_start, "$lte": month_end}},
                {"dia_venta": {"$gte": month_start, "$lte": month_end}},
                {"fecha":     {"$gte": month_start, "$lte": month_end}},
            ]}},
            {"$match": {"$expr": COMPLETED_MATCH_EXPR}},
            {"$group": {
                "_id":          {"$toLower": {"$trim": {"input": {"$ifNull": ["$agenteNombre", ""]}}}},
                "agenteNombre": {"$first": "$agenteNombre"},
                "sumPuntaje":   {"$sum": {"$toDouble": {"$ifNull": ["$puntaje", 0]}}},
                "ventas":       {"$sum": 1},
            }},
            {"$sort": {"sumPuntaje": -1, "ventas": -1}},
            {"$limit": 30},
        ]
        rows = await db["costumers_unified"].aggregate(pipeline).to_list(None)
        for i, r in enumerate(rows):
            pts = round(float(r.get("sumPuntaje") or 0), 2)
            current_month_ranking.append({
                "agente": r["_id"], "nombre": r.get("agenteNombre") or r["_id"],
                "puntos": pts, "puntaje": pts, "ventas": r.get("ventas", 0),
                "posicion": i + 1, "position": i + 1,
                "mes": f"{now.year}-{str(now.month).zfill(2)}",
            })
    except Exception:
        pass

    monthly_rankings: dict = {}
    for i in range(6):
        m = now.month - i
        y = now.year
        while m <= 0:
            m += 12; y -= 1
        ms, me = _month_range(y, m)
        key = f"{y}-{str(m).zfill(2)}"
        try:
            pipe2 = [
                {"$match": {"createdAt": {"$gte": ms, "$lte": me}}},
                {"$match": {"$expr": COMPLETED_MATCH_EXPR}},
                {"$group": {
                    "_id":          {"$toLower": {"$trim": {"input": {"$ifNull": ["$agente", ""]}}}},
                    "agenteNombre": {"$first": "$agente"},
                    "sumPuntaje":   {"$sum": {"$toDouble": {"$ifNull": ["$puntaje", 0]}}},
                    "ventas":       {"$sum": 1},
                }},
                {"$sort": {"sumPuntaje": -1, "ventas": -1}},
                {"$limit": 15},
            ]
            rows2 = await db["costumers_unified"].aggregate(pipe2).to_list(None)
            monthly_rankings[key] = [
                {"agente": r["_id"], "nombre": r.get("agenteNombre") or r["_id"],
                 "puntos": round(float(r.get("sumPuntaje") or 0), 2),
                 "ventas": r.get("ventas", 0), "position": j + 1, "mes": key}
                for j, r in enumerate(rows2)
            ]
        except Exception:
            monthly_rankings[key] = []

    top = current_month_ranking
    return {
        "success": True, "timestamp": _dt.datetime.utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role"), "team": user.get("team","Sin equipo")},
        "data": {
            "currentMonthRanking": current_month_ranking,
            "monthlyRankings": monthly_rankings,
            "topThree": {"first": top[0] if len(top) > 0 else None, "second": top[1] if len(top) > 1 else None, "third": top[2] if len(top) > 2 else None},
            "monthYear": f"{now.month}/{now.year}",
        },
        "ttl": 300000,
    }


# ── INIT-ESTADISTICAS ─────────────────────────────────────────────
@router.get("/api/init-estadisticas")
async def init_estadisticas(user: dict = Depends(current_user)):
    db  = get_db()
    now = _dt.datetime.utcnow()
    ms, me = _month_range(now.year, now.month)
    date_conds = [
        {"dia_venta":          {"$gte": ms, "$lte": me}},
        {"fecha_contratacion": {"$gte": ms, "$lte": me}},
        {"creadoEn":           {"$gte": ms, "$lte": me}},
        {"createdAt":          {"$gte": ms, "$lte": me}},
    ]

    teams_data = []
    try:
        pipe = [
            {"$match": {"$or": date_conds}},
            {"$group": {
                "_id":         {"$ifNull": ["$supervisor", "Sin equipo"]},
                "totalLeads":  {"$sum": 1},
                "totalVentas": {"$sum": {"$cond": [{"$expr": COMPLETED_MATCH_EXPR}, 1, 0]}},
                "ACTIVAS":     {"$sum": {"$cond": [{"$expr": COMPLETED_MATCH_EXPR}, 1, 0]}},
                "promedio":    {"$avg": {"$toDouble": {"$ifNull": ["$puntaje", 0]}}},
            }},
            {"$sort": {"totalLeads": -1}}, {"$limit": 20},
        ]
        rows = await db["costumers_unified"].aggregate(pipe).to_list(None)
        teams_data = [
            {"name": r["_id"] or "Sin equipo", "equipo": r["_id"] or "Sin equipo",
             "Total": r.get("totalLeads",0), "totalVentas": r.get("totalVentas",0),
             "Puntaje": round(r.get("promedio") or 0), "ACTIVAS": r.get("ACTIVAS",0), "porcentaje": 0}
            for r in rows
        ]
    except Exception: pass

    agents_data = []
    try:
        pipe2 = [
            {"$match": {"$or": date_conds}},
            {"$group": {
                "_id":           "$agenteNombre",
                "totalClientes": {"$sum": 1},
                "totalVentas":   {"$sum": {"$cond": [{"$expr": COMPLETED_MATCH_EXPR}, 1, 0]}},
                "totalPuntos":   {"$sum": {"$cond": [{"$expr": COMPLETED_MATCH_EXPR}, {"$toDouble": {"$ifNull": ["$puntaje", 0]}}, 0]}},
                "agente":        {"$first": "$agente"},
                "supervisor":    {"$first": "$supervisor"},
            }},
            {"$sort": {"totalPuntos": -1}}, {"$limit": 30},
        ]
        rows2 = await db["costumers_unified"].aggregate(pipe2).to_list(None)
        agents_data = [
            {"nombre": r["_id"] or "Sin asignar", "agente": r.get("agente",""),
             "totalClientes": r.get("totalClientes",0), "totalVentas": r.get("totalVentas",0),
             "totalPuntos": round(float(r.get("totalPuntos") or 0), 2), "supervisor": r.get("supervisor","")}
            for r in rows2
        ]
    except Exception: pass

    leads_chart_data = []
    try:
        date_from = now - _dt.timedelta(days=60)
        pipe3 = [
            {"$match": {"fecha": {"$gte": date_from, "$lte": now}}},
            {"$group": {
                "_id":       {"$dateToString": {"format": "%Y-%m-%d", "date": "$fecha", "timezone": "America/Mexico_City"}},
                "count":     {"$sum": 1},
                "completados": {"$sum": {"$cond": [{"$in": [{"$toLower": {"$ifNull": ["$status",""]}}, _COMPLETED_LOWER]}, 1, 0]}},
            }},
            {"$sort": {"_id": 1}}, {"$limit": 60},
        ]
        rows3 = await db["leads"].aggregate(pipe3).to_list(None)
        leads_chart_data = [{"fecha": r["_id"], "count": r.get("count",0), "completados": r.get("completados",0)} for r in rows3]
    except Exception: pass

    status_summary: dict = {}
    try:
        pipe4 = [
            {"$match": {"$or": date_conds}},
            {"$group": {"_id": {"$toLower": {"$ifNull": ["$status",""]}}, "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
        rows4 = await db["costumers_unified"].aggregate(pipe4).to_list(None)
        for r in rows4:
            k = normalize_status(r["_id"])
            status_summary[k] = status_summary.get(k, 0) + r.get("count", 0)
    except Exception: pass

    return {
        "success": True, "timestamp": _dt.datetime.utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role"), "team": user.get("team","Sin equipo")},
        "data": {"teamsData": teams_data, "agentsData": agents_data, "leadsChartData": leads_chart_data,
                 "statusSummary": status_summary, "monthYear": f"{now.month}/{now.year}"},
        "ttl": 300000,
    }


# ── INIT-ALL-PAGES ────────────────────────────────────────────────
@router.get("/api/init-all-pages")
async def init_all_pages(user: dict = Depends(current_user)):
    db  = get_db()
    now = _dt.datetime.utcnow()
    ms, me = _month_range(now.year, now.month)
    date_conds = [
        {"dia_venta":          {"$gte": ms, "$lte": me}},
        {"fecha_contratacion": {"$gte": ms, "$lte": me}},
        {"creadoEn":           {"$gte": ms, "$lte": me}},
        {"createdAt":          {"$gte": ms, "$lte": me}},
        {"fecha":              {"$gte": ms, "$lte": me}},
    ]

    customers = []
    try:
        docs = await db["costumers_unified"].find(
            {"$or": date_conds},
            {"_id": 1, "nombre_cliente": 1, "status": 1, "telefono_principal": 1, "numero_cuenta": 1,
             "agente": 1, "agenteNombre": 1, "supervisor": 1, "dia_venta": 1, "dia_instalacion": 1,
             "autopago": 1, "pin_seguridad": 1, "direccion": 1, "telefonos": 1, "cantidad_lineas": 1,
             "servicios": 1, "servicios_texto": 1, "producto": 1, "mercado": 1}
        ).limit(200).to_list(None)
        customers = _serialize(docs)
    except Exception: pass

    leads = []
    try:
        docs2 = await db["leads"].find(
            {"$or": date_conds},
            {"_id": 1, "nombre": 1, "status": 1, "fecha": 1, "agente": 1, "agenteNombre": 1, "puntaje": 1, "servicios": 1, "empresa": 1}
        ).limit(100).to_list(None)
        leads = _serialize(docs2)
    except Exception: pass

    rankings = []
    try:
        pipe = [
            {"$match": {"$or": date_conds}},
            {"$match": {"$expr": COMPLETED_MATCH_EXPR}},
            {"$group": {"_id": "$agenteNombre", "sumPuntaje": {"$sum": {"$toDouble": {"$ifNull": ["$puntaje",0]}}}, "ventas": {"$sum": 1}}},
            {"$sort": {"sumPuntaje": -1}}, {"$limit": 30},
        ]
        rows = await db["costumers_unified"].aggregate(pipe).to_list(None)
        rankings = [
            {"agente": r["_id"], "agenteNombre": r["_id"],
             "puntaje": round(float(r.get("sumPuntaje") or 0), 2),
             "ventas": r.get("ventas",0), "posicion": i + 1}
            for i, r in enumerate(rows)
        ]
    except Exception: pass

    stats_agg: dict = {}
    try:
        pipe2 = [
            {"$match": {"$or": date_conds}},
            {"$group": {
                "_id":         {"$ifNull": ["$supervisor","general"]},
                "totalLeads":  {"$sum": 1},
                "totalVentas": {"$sum": {"$cond": [{"$expr": COMPLETED_MATCH_EXPR}, 1, 0]}},
                "promedio":    {"$avg": {"$toDouble": {"$ifNull": ["$puntaje",0]}}},
            }},
            {"$sort": {"totalLeads": -1}}, {"$limit": 15},
        ]
        rows2 = await db["costumers_unified"].aggregate(pipe2).to_list(None)
        for r in rows2:
            stats_agg[r["_id"] or "general"] = {
                "totalLeads": r.get("totalLeads",0),
                "totalVentas": r.get("totalVentas",0),
                "promedio": round(r.get("promedio") or 0),
            }
    except Exception: pass

    return {
        "success": True, "timestamp": _dt.datetime.utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role"), "team": user.get("team","Sin equipo")},
        "data": {"customers": customers, "leads": leads, "rankings": rankings,
                 "stats": stats_agg, "monthYear": f"{now.month}/{now.year}"},
        "ttl": 300000,
    }


# ── INIT-LEAD ─────────────────────────────────────────────────────
@router.get("/api/init-lead")
async def init_lead(user: dict = Depends(current_user)):
    db  = get_db()
    now = _dt.datetime.utcnow()
    ms, me = _month_range(now.year, now.month)
    date_conds = [{"fecha": {"$gte": ms, "$lte": me}}, {"createdAt": {"$gte": ms, "$lte": me}}]

    leads_data = []
    try:
        docs = await db["leads"].find(
            {"$or": date_conds},
            {"_id": 1, "nombre": 1, "status": 1, "fecha": 1, "agente": 1, "agenteNombre": 1, "puntaje": 1, "servicios": 1, "empresa": 1}
        ).limit(200).to_list(None)
        leads_data = _serialize(docs)
    except Exception: pass

    status_summary: dict = {}
    try:
        pipe = [
            {"$match": {"$or": date_conds}},
            {"$group": {"_id": {"$toLower": {"$ifNull": ["$status",""]}}, "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
        rows = await db["leads"].aggregate(pipe).to_list(None)
        for r in rows:
            k = normalize_status(r["_id"])
            status_summary[k] = status_summary.get(k, 0) + r.get("count", 0)
    except Exception: pass

    return {
        "success": True, "timestamp": _dt.datetime.utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role")},
        "data": {"leadsData": leads_data, "statusSummary": status_summary, "monthYear": f"{now.month}/{now.year}"},
        "ttl": 300000,
    }


# ── INIT-FACTURACIÓN ──────────────────────────────────────────────
@router.get("/api/init-facturacion")
async def init_facturacion(user: dict = Depends(current_user)):
    db  = get_db()
    now = _dt.datetime.utcnow()
    ms, me = _month_range(now.year, now.month)
    date_conds = [
        {"dia_venta":          {"$gte": ms, "$lte": me}},
        {"fecha_contratacion": {"$gte": ms, "$lte": me}},
        {"createdAt":          {"$gte": ms, "$lte": me}},
    ]

    facturacion_data = []
    try:
        docs = await db["costumers_unified"].find(
            {"$or": date_conds},
            {"_id": 1, "nombre_cliente": 1, "numero_cuenta": 1, "status": 1, "agente": 1,
             "agenteNombre": 1, "dia_venta": 1, "dia_instalacion": 1, "cantidad_lineas": 1, "autopago": 1}
        ).limit(150).to_list(None)
        facturacion_data = _serialize(docs)
    except Exception: pass

    ingresos_summary = {"total": 0, "completadas": 0}
    try:
        pipe = [
            {"$match": {"$or": date_conds}},
            {"$group": {
                "_id":         None,
                "totalCount":  {"$sum": 1},
                "completadas": {"$sum": {"$cond": [{"$expr": COMPLETED_MATCH_EXPR}, 1, 0]}},
            }},
        ]
        rows = await db["costumers_unified"].aggregate(pipe).to_list(None)
        if rows:
            ingresos_summary["total"]       = rows[0].get("totalCount", 0)
            ingresos_summary["completadas"] = rows[0].get("completadas", 0)
    except Exception: pass

    return {
        "success": True, "timestamp": _dt.datetime.utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role")},
        "data": {"facturacionData": facturacion_data, "ingresosSummary": ingresos_summary, "monthYear": f"{now.month}/{now.year}"},
        "ttl": 300000,
    }


# ── INIT-MULTIMEDIA ───────────────────────────────────────────────
@router.get("/api/init-multimedia")
async def init_multimedia(user: dict = Depends(current_user)):
    db = get_db()
    multimedia_data = []
    try:
        docs = await db["media"].find(
            {}, {"_id": 1, "fileName": 1, "fileType": 1, "uploadedBy": 1, "uploadedAt": 1, "fileSize": 1}
        ).sort("uploadedAt", -1).limit(100).to_list(None)
        multimedia_data = _serialize(docs)
    except Exception: pass

    type_summary: dict = {}
    try:
        pipe = [
            {"$group": {"_id": "$fileType", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
        rows = await db["media"].aggregate(pipe).to_list(None)
        for r in rows:
            type_summary[r["_id"] or "desconocido"] = r.get("count", 0)
    except Exception: pass

    return {
        "success": True, "timestamp": _dt.datetime.utcnow().isoformat(),
        "user": {"username": user.get("username"), "role": user.get("role")},
        "data": {"multimediaData": multimedia_data, "typeSummary": type_summary},
        "ttl": 300000,
    }


# ── RECENT ACTIVITY ───────────────────────────────────────────────
@router.get("/api/recent-activity")
async def recent_activity(user: dict = Depends(current_user)):
    db       = get_db()
    username = user.get("username", "")
    role     = (user.get("role") or "").lower()

    is_admin = any(r in role for r in ("admin", "administrator", "administrador", "administradora"))
    is_bo    = any(r in role for r in ("backoffice", "bo"))
    is_sup   = "supervisor" in role
    is_agent = "agente" in role or "agent" in role

    sup_agents = get_supervisor_agents(username) if is_sup else []
    users_for_data = None
    if is_sup:   users_for_data = sup_agents
    elif is_agent and not is_admin and not is_bo: users_for_data = [username]

    last_days = _dt.datetime.utcnow() - _dt.timedelta(days=30)
    date_filter = {"$or": [
        {"creadoEn":          {"$gte": last_days}},
        {"createdAt":         {"$gte": last_days}},
        {"dia_venta":         {"$gte": last_days}},
        {"fecha_contratacion":{"$gte": last_days}},
        {"fecha":             {"$gte": last_days}},
    ]}
    user_filter = {}
    if users_for_data:
        user_filter = {"$or": [
            {"agenteNombre": {"$in": users_for_data}},
            {"agente":       {"$in": users_for_data}},
            {"usuario":      {"$in": users_for_data}},
        ]}
    filt = {"$and": [date_filter, user_filter]} if user_filter else date_filter

    activities = await db["costumers_unified"].find(
        filt,
        {"_id": 1, "nombre_cliente": 1, "agenteNombre": 1, "agente": 1, "usuario": 1,
         "status": 1, "servicios": 1, "tipo_servicios": 1, "puntaje": 1, "creadoEn": 1, "createdAt": 1, "dia_venta": 1}
    ).sort([("creadoEn", -1), ("createdAt", -1), ("dia_venta", -1)]).limit(50).to_list(None)

    formatted = []
    for lead in activities:
        agent      = lead.get("agenteNombre") or lead.get("agente") or lead.get("usuario") or "—"
        client     = lead.get("nombre_cliente") or "Cliente sin nombre"
        services   = lead.get("servicios") or lead.get("tipo_servicios") or "Servicio general"
        if isinstance(services, list): services = services[0] if services else "Servicio general"
        norm_st    = normalize_status(lead.get("status",""))
        act_type   = {"completed":"Venta cerrada","cancelled":"Cancelación","hold":"En espera","rescheduled":"Reagendado","pending":"Seguimiento"}.get(norm_st,"Nuevo")
        date_c     = lead.get("creadoEn") or lead.get("createdAt") or lead.get("dia_venta") or _dt.datetime.utcnow()
        formatted.append({
            "id": str(lead["_id"]), "nombre_cliente": client, "agente": agent, "servicio": services,
            "tipo_actividad": act_type, "status": norm_st,
            "fecha": date_c, "tiempo_relativo": get_time_ago(date_c if isinstance(date_c, _dt.datetime) else _dt.datetime.utcnow()),
        })

    return {"success": True, "data": formatted}


# ── AGENT HISTORY ─────────────────────────────────────────────────
@router.get("/api/agent-history")
async def agent_history(
    agente:      Optional[str] = Query(None),
    fechaInicio: Optional[str] = Query(None),
    fechaFin:    Optional[str] = Query(None),
    limit:       Optional[int] = Query(None),
    user: dict = Depends(current_user),
):
    db       = get_db()
    username = user.get("username", "")
    role     = (user.get("role") or "").lower()

    is_admin = any(r in role for r in ("admin", "administrator", "administrador", "administradora", "backoffice", "bo"))
    is_sup   = "supervisor" in role
    is_agent = "agente" in role or "agent" in role

    hard_limit = min(int(limit) if limit else 300, 500)
    if is_agent and not is_admin and not is_sup:
        agente = username

    now_sv = _dt.datetime.utcnow() - _dt.timedelta(hours=6)
    default_start = _dt.datetime(now_sv.year, now_sv.month, 1)
    import calendar
    _, last_day = calendar.monthrange(now_sv.year, now_sv.month)
    default_end = _dt.datetime(now_sv.year, now_sv.month, last_day, 23, 59, 59)

    try:
        date_from = _dt.datetime.fromisoformat(fechaInicio + "T00:00:00") - _dt.timedelta(hours=6) if fechaInicio else default_start
    except Exception:
        date_from = default_start
    try:
        date_to = _dt.datetime.fromisoformat(fechaFin + "T23:59:59") - _dt.timedelta(hours=6) if fechaFin else default_end
    except Exception:
        date_to = default_end

    act_filter: dict = {"timestamp": {"$gte": date_from, "$lte": date_to}}
    if agente:
        act_filter["$or"] = [
            {"actor_username": agente},
            {"actor_username": re.compile(rf"^{re.escape(agente)}$", re.IGNORECASE)},
        ]

    raw_acts = await db["activities"].find(act_filter).sort("timestamp", -1).limit(hard_limit).to_list(None)

    lead_date_filter = {"$or": [{"creadoEn": {"$gte": date_from, "$lte": date_to}}, {"createdAt": {"$gte": date_from, "$lte": date_to}}]}
    agent_lead_filter = lead_date_filter
    if agente:
        rx = re.compile(rf"^{re.escape(agente)}$", re.IGNORECASE)
        agent_lead_filter = {"$and": [lead_date_filter, {"$or": [{"agenteNombre": rx}, {"agente": rx}, {"usuario": rx}]}]}

    leads = await db["costumers_unified"].find(
        agent_lead_filter,
        {"_id": 1, "nombre_cliente": 1, "status": 1, "servicios": 1, "tipo_servicios": 1, "puntaje": 1, "agenteNombre": 1, "creadoEn": 1, "createdAt": 1, "dia_venta": 1}
    ).limit(1000).to_list(None)

    ventas_cerradas = sum(1 for l in leads if normalize_status(l.get("status","")) == "completed")
    cancelaciones   = sum(1 for l in leads if normalize_status(l.get("status","")) == "cancelled")
    puntaje_total   = sum(float(l.get("puntaje") or 0) for l in leads)
    leads_creados   = sum(1 for a in raw_acts if a.get("activity_type") in ("Lead creado","Venta ingresada"))

    def _ts(dt) -> str | None:
        if not isinstance(dt, _dt.datetime):
            return None
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    actividades = [
        {
            "id":          str(a["_id"]),
            "tipo":        a.get("activity_type") or "Acción",
            "cliente":     a.get("lead_client_name") or "—",
            "descripcion": a.get("description") or "",
            "agente":      a.get("actor_username") or agente or "—",
            "rol":         a.get("actor_role") or "",
            "fecha":       _ts(a.get("timestamp")),
            "extra":       {"campos": a.get("campos"), "new_status": a.get("new_status"), "old_status": a.get("old_status")},
        }
        for a in raw_acts
    ]

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

    def _fmt_date(d: _dt.datetime) -> str:
        return f"{d.year}-{str(d.month).zfill(2)}-{str(d.day).zfill(2)}"

    return {
        "success": True,
        "agente": agente or None,
        "periodo": {"desde": _fmt_date(date_from), "hasta": _fmt_date(date_to)},
        "resumen": {
            "totalActividades": len(raw_acts), "ventasCerradas": ventas_cerradas,
            "leadsCreados": leads_creados, "cancelaciones": cancelaciones,
            "puntajeTotal": round(puntaje_total, 2),
        },
        "porDia": por_dia,
        "actividades": actividades,
    }
