"""
GET /api/dashboard/home — Endpoint consolidado para la página de inicio.
Reemplaza 7 llamadas secuenciales por 1 sola con SQL GROUP BY.
Caché en memoria de 5 minutos.
"""
from fastapi import APIRouter, Depends, HTTPException
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
import datetime as _dt, calendar, time, traceback, json as _json

router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])

# ── Caché ──────────────────────────────────────────────────────────────────
_cache: dict = {}
_TTL = 300  # 5 minutos

def _cache_get(key: str):
    e = _cache.get(key)
    if e and (time.time() - e["ts"]) < _TTL:
        return e["data"]
    return None

def _cache_set(key: str, data: dict):
    _cache[key] = {"data": data, "ts": time.time()}

# ── Helpers ────────────────────────────────────────────────────────────────
_MES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio",
        "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"]

def _month_range(year: int, month: int):
    _, last = calendar.monthrange(year, month)
    return f"{year}-{month:02d}-01", f"{year}-{month:02d}-{last:02d}"

# Statuses excluidos del ranking/semáforo (igual que ranking.py y equipo.py)
_STATUS_EXCLUDE_RE = "cancel|reserva|hold|rescheduled|reagendado"


@router.get("/home")
async def dashboard_home(user: dict = Depends(current_user)):
    now      = _dt.datetime.utcnow()
    role     = (user.get("role") or "").lower()
    username = (user.get("name") or user.get("username") or "").strip().lower()
    is_adm_bo = any(r in role for r in ("admin","administrator","administrador","backoffice","bo","administrativo"))

    start, end = _month_range(now.year, now.month)
    year_start = f"{now.year}-01-01"

    cache_key = f"home_{'adm' if is_adm_bo else username}_{now.year}{now.month:02d}"
    cached = _cache_get(cache_key)
    if cached:
        return cached

    try:
        async with AsyncSessionLocal() as s:

            # ── 1. KPIs + Ranking del mes (una sola query) ──────────────
            r1 = await s.execute(text("""
                SELECT
                    COALESCE(agente_nombre, agente, 'Sin asignar') AS nombre,
                    COUNT(*)                                        AS ventas,
                    COALESCE(SUM(puntaje), 0)                      AS puntos
                FROM leads
                WHERE (dia_venta BETWEEN :s AND :e
                       OR (dia_venta IS NULL AND created_at BETWEEN :s AND :e))
                  AND UPPER(TRIM(COALESCE(status,''))) NOT IN ('CANCELLED','CANCELADO','CANCELADA','CANCEL','HOLD','RESERVA','RESCHEDULED','REAGENDADO')
                GROUP BY agente_nombre, agente
                ORDER BY puntos DESC
                LIMIT 30
            """), {"s": start, "e": end})
            ranking_rows = r1.mappings().all()

            # ── 2. Gráfica mensual — 12 meses con GROUP BY ───────────────
            r2 = await s.execute(text("""
                SELECT
                    MONTH(dia_venta)  AS mes,
                    COUNT(*)          AS ventas
                FROM leads
                WHERE dia_venta IS NOT NULL
                  AND dia_venta >= :ys
                  AND dia_venta <= :e
                  AND UPPER(TRIM(COALESCE(status,''))) NOT IN ('CANCELLED','CANCELADO','CANCELADA','CANCEL','HOLD','RESERVA','RESCHEDULED','REAGENDADO')
                GROUP BY YEAR(dia_venta), MONTH(dia_venta)
                ORDER BY YEAR(dia_venta), MONTH(dia_venta)
            """), {"ys": year_start, "e": end})
            chart_rows = r2.mappings().all()

            # ── 3. Semáforo — ventas por team ────────────────────────────
            r3 = await s.execute(text("""
                SELECT
                    u.team                      AS team,
                    COUNT(l.id)                 AS ventas,
                    COALESCE(SUM(l.puntaje), 0) AS puntos
                FROM leads l
                JOIN users u
                  ON LOWER(TRIM(COALESCE(l.agente_nombre, l.agente, '')))
                   = LOWER(TRIM(u.username))
                WHERE (l.dia_venta BETWEEN :s AND :e
                       OR (l.dia_venta IS NULL AND l.created_at BETWEEN :s AND :e))
                  AND LOWER(TRIM(COALESCE(l.status,''))) NOT REGEXP 'cancel|reserva|hold|rescheduled'
                  AND u.team IS NOT NULL
                  AND TRIM(u.team) != ''
                GROUP BY u.team
                ORDER BY puntos DESC
            """), {"s": start, "e": end})
            # Nota: ranking usa agente_nombre+agente en GROUP BY para compatibilidad con ONLY_FULL_GROUP_BY
            semaforo_rows = r3.mappings().all()

            # ── 4. Top productos (servicios) del mes ─────────────────────────
            r4 = await s.execute(text("""
                SELECT tipo_servicio
                FROM leads
                WHERE (dia_venta BETWEEN :s AND :e
                       OR (dia_venta IS NULL AND created_at BETWEEN :s AND :e))
                  AND UPPER(TRIM(COALESCE(status,''))) NOT IN ('CANCELLED','CANCELADO','CANCELADA','CANCEL','HOLD','RESERVA','RESCHEDULED','REAGENDADO')
                  AND tipo_servicio IS NOT NULL
                  AND TRIM(tipo_servicio) != ''
            """), {"s": start, "e": end})
            servs_rows = r4.mappings().all()

            # ── 5. Actividades recientes — ordenadas por última modificación ─
            r5 = await s.execute(text("""
                SELECT nombre_cliente, agente_nombre, servicios, created_at,
                       GREATEST(COALESCE(updated_at, created_at), created_at) AS actividad_at
                FROM leads
                WHERE UPPER(TRIM(COALESCE(status,''))) NOT IN (
                    'CANCELLED','CANCELADO','CANCELADA','CANCEL','HOLD','RESERVA'
                  )
                  AND GREATEST(COALESCE(updated_at, created_at), created_at) >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                ORDER BY actividad_at DESC
                LIMIT 20
            """))
            act_rows = r5.mappings().all()

            # ── 6. Mapa de clientes — leads con coordenadas geocodificadas ──
            r6 = await s.execute(text("""
                SELECT
                    nombre_cliente,
                    direccion,
                    servicios,
                    lat, lng,
                    agente_nombre,
                    dia_venta
                FROM leads
                WHERE lat IS NOT NULL AND lng IS NOT NULL
                  AND LOWER(TRIM(COALESCE(status,''))) IN (
                    'completed','active','activo','completado',
                    'vendido','cerrado','cerrada','venta cerrada'
                  )
                ORDER BY created_at DESC
                LIMIT 60
            """))
            map_rows = r6.mappings().all()

    except Exception as e:
        print(f"[dashboard/home] ERROR: {e}\n{traceback.format_exc()}")
        raise HTTPException(500, f"Error interno: {str(e)}")

    # ── Deduplicar ranking (mismo agente con variantes de nombre) ─────────
    _seen: dict = {}
    for r in ranking_rows:
        key = (r["nombre"] or "").strip().lower()
        if key not in _seen:
            _seen[key] = {"nombre": r["nombre"], "ventas": int(r["ventas"] or 0), "puntos": float(r["puntos"] or 0)}
        else:
            _seen[key]["ventas"] += int(r["ventas"] or 0)
            _seen[key]["puntos"] += float(r["puntos"] or 0)
    deduped = sorted(_seen.values(), key=lambda x: -x["puntos"])

    # ── Procesar KPIs ──────────────────────────────────────────────────────
    total_ventas = sum(d["ventas"] for d in deduped)
    total_puntos = sum(d["puntos"] for d in deduped)
    mejor_vendedor = deduped[0]["nombre"] if deduped else "—"
    mejor_team     = semaforo_rows[0]["team"] if semaforo_rows else "—"

    # Stats personales
    user_ventas, user_puntos, user_pos = (total_ventas, round(total_puntos,2), "—") if is_adm_bo else (0, 0.0, "—")
    if not is_adm_bo:
        for i, d in enumerate(deduped):
            r = d
            if (r["nombre"] or "").strip().lower() == username:
                user_ventas = int(r["ventas"] or 0)
                user_puntos = round(float(r["puntos"] or 0), 2)
                user_pos    = f"#{i+1}/{len(ranking_rows)}"
                break

    # ── Gráfica mensual ────────────────────────────────────────────────────
    chart_map = {int(r["mes"]): int(r["ventas"] or 0) for r in chart_rows if r["mes"] is not None}
    chart = [{"mes": _MES[m-1], "ventas": chart_map.get(m, 0)} for m in range(1, 13)]

    # ── Ranking ────────────────────────────────────────────────────────────
    ranking = [
        {
            "posicion": i + 1,
            "nombre":   d["nombre"] or "—",
            "ventas":   d["ventas"],
            "puntos":   round(d["puntos"], 2),
        }
        for i, d in enumerate(deduped[:30])
    ]

    # ── Semáforo ───────────────────────────────────────────────────────────
    semaforo = [
        {
            "team":   r["team"],
            "ventas": int(r["ventas"] or 0),
            "puntos": round(float(r["puntos"] or 0), 2),
        }
        for r in semaforo_rows
    ]

    # ── Mapa de clientes ──────────────────────────────────────────────────────
    def _build_map_pins(rows):
        pins = []
        for row in rows:
            if row["lat"] is None or row["lng"] is None:
                continue
            sv_raw = row["servicios"]
            try:
                items = _json.loads(sv_raw) if isinstance(sv_raw, str) else sv_raw
                servicio = items[0] if isinstance(items, list) and items else str(sv_raw or "Servicio general")
            except Exception:
                servicio = str(sv_raw) if sv_raw else "Servicio general"
            pins.append({
                "empresa":     row["nombre_cliente"] or "—",
                "direccion":   row["direccion"]      or "",
                "servicio":    servicio,
                "agente":      row["agente_nombre"]  or "—",
                "coordenadas": {"lat": float(row["lat"]), "lng": float(row["lng"])},
            })
        return pins

    # ── Top productos (tipo_servicio — campo directo) ─────────────────────────
    prod_map: dict = {}
    for row in servs_rows:
        key = str(row["tipo_servicio"] or "").strip().upper()
        if key and key not in ('', 'NULL'):
            prod_map[key] = prod_map.get(key, 0) + 1
    top_productos = sorted(
        [{"servicio": k, "count": v} for k, v in prod_map.items()],
        key=lambda x: -x["count"]
    )[:5]

    # ── Actividades recientes ──────────────────────────────────────────────────
    def _tiempo_relativo(created_at):
        if not created_at:
            return "Reciente"
        try:
            delta = _dt.datetime.utcnow() - created_at.replace(tzinfo=None)
            mins = int(delta.total_seconds() // 60)
            if mins < 1:   return "Ahora"
            if mins < 60:  return f"Hace {mins} min"
            hrs = mins // 60
            if hrs < 24:   return f"Hace {hrs}h"
            return f"Hace {hrs // 24}d"
        except Exception:
            return "Reciente"

    actividades = []
    for row in act_rows:
        sv_raw = row["servicios"]
        try:
            items = _json.loads(sv_raw) if isinstance(sv_raw, str) else sv_raw
            sv_str = ", ".join(str(i) for i in items) if isinstance(items, list) else str(sv_raw)
        except Exception:
            sv_str = str(sv_raw) if sv_raw else "Servicio general"
        ts = row["actividad_at"] or row["created_at"]
        actividades.append({
            "nombre_cliente":  row["nombre_cliente"] or "—",
            "agente_nombre":   row["agente_nombre"]  or "—",
            "servicios_str":   sv_str or "Servicio general",
            "tiempo_relativo": _tiempo_relativo(ts),
            "created_at":      ts.isoformat() if ts else None,
        })

    result = {
        "success":       True,
        "authenticated": True,
        "user": {
            "username": user.get("username", ""),
            "name":     user.get("name") or user.get("username", ""),
            "role":     user.get("role", ""),
            "team":     user.get("team", ""),
        },
        "kpis": {
            "ventas_totales":  total_ventas,
            "puntos_totales":  round(total_puntos, 2),
            "mejor_vendedor":  mejor_vendedor,
            "mejor_team":      mejor_team,
        },
        "user_stats": {
            "ventas":   user_ventas,
            "puntos":   user_puntos,
            "posicion": user_pos,
            "team":     user.get("team") or "—",
        },
        "chart_ventas_mensuales": chart,
        "ranking_mes":            ranking,
        "semaforo":               semaforo,
        "top_productos":          top_productos,
        "actividades_recientes":  actividades,
        "mapa_clientes": _build_map_pins(map_rows),
        "meta": {
            "mes":       now.month,
            "anio":      now.year,
            "timestamp": now.isoformat(),
        },
    }

    _cache_set(cache_key, result)
    return result


@router.get("/actividades")
async def get_actividades(user: dict = Depends(current_user)):
    """Endpoint liviano para auto-refresh de actividades recientes (sin caché)."""
    def _tiempo_relativo(ts):
        if not ts: return "Reciente"
        try:
            delta = _dt.datetime.utcnow() - ts.replace(tzinfo=None)
            mins  = int(delta.total_seconds() // 60)
            if mins < 1:   return "Ahora"
            if mins < 60:  return f"Hace {mins} min"
            hrs = mins // 60
            if hrs < 24:   return f"Hace {hrs}h"
            return f"Hace {hrs // 24}d"
        except Exception:
            return "Reciente"

    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT nombre_cliente, agente_nombre, servicios, created_at,
                   GREATEST(COALESCE(updated_at, created_at), created_at) AS actividad_at
            FROM leads
            WHERE UPPER(TRIM(COALESCE(status,''))) NOT IN (
                'CANCELLED','CANCELADO','CANCELADA','CANCEL','HOLD','RESERVA'
              )
              AND GREATEST(COALESCE(updated_at, created_at), created_at) >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            ORDER BY actividad_at DESC
            LIMIT 20
        """))
        rows = r.mappings().all()

    actividades = []
    for row in rows:
        sv_raw = row["servicios"]
        try:
            items  = _json.loads(sv_raw) if isinstance(sv_raw, str) else sv_raw
            sv_str = ", ".join(str(i) for i in items) if isinstance(items, list) else str(sv_raw)
        except Exception:
            sv_str = str(sv_raw) if sv_raw else "Servicio general"
        ts = row["actividad_at"] or row["created_at"]
        actividades.append({
            "nombre_cliente":  row["nombre_cliente"] or "—",
            "agente_nombre":   row["agente_nombre"]  or "—",
            "servicios_str":   sv_str or "Servicio general",
            "tiempo_relativo": _tiempo_relativo(ts),
            "created_at":      ts.isoformat() if ts else None,
        })
    return {"ok": True, "actividades_recientes": actividades}
