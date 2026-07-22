"""
GET /api/dashboard/home — Endpoint consolidado para la página de inicio.
Reemplaza 7 llamadas secuenciales por 1 sola con SQL GROUP BY.
Caché en memoria de 5 minutos.
"""
from fastapi import APIRouter, Depends, HTTPException
from database_mysql import AsyncSessionLocal
from sqlalchemy import text
from deps import current_user
import datetime as _dt, calendar, traceback, json as _json


def _utcnow() -> _dt.datetime:
    """UTC naive (reemplazo de datetime.utcnow() deprecado en Python 3.12+)."""
    return _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)
router = APIRouter(prefix="/api/dashboard", tags=["Dashboard"])


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
    now      = _utcnow()
    role     = (user.get("role") or "").lower()
    username = (user.get("name") or user.get("username") or "").strip().lower()
    is_adm_bo = any(r in role for r in ("admin","administrator","administrador","backoffice","bo","administrativo"))

    start, _end = _month_range(now.year, now.month)
    # Usar el primer día del mes siguiente para capturar todas las horas del último día
    import calendar as _cal
    _nm = now.month + 1 if now.month < 12 else 1
    _ny = now.year if now.month < 12 else now.year + 1
    end = start  # alias para queries que usan :e como fecha fin
    end   = _end  # fin del mes completo (YYYY-MM-DD)
    end_excl = f"{_ny}-{_nm:02d}-01"  # fecha exclusiva para BETWEEN con datetime
    year_start = f"{now.year}-01-01"

    try:
        async with AsyncSessionLocal() as s:

            # Solo ventas válidas (excluye CANCELLED/HOLD/REPRO), igual que /api/ranking,
            # para que "mejor vendedor" y los totales coincidan con Ranking y Promociones.
            _status_validos = """UPPER(TRIM(COALESCE(status,''))) IN (
                'PENDING','PENDIENTE','PENDIENTES',
                'COMPLETED','ACTIVE','COMPLETADO','ACTIVO','ACTIVA','VENDIDO','CERRADO','CERRADA','VENTA CERRADA',
                'RESERVA'
            )"""

            # ── 1a. Total real del mes (sin LIMIT) ──────────────────────
            r0 = await s.execute(text(f"""
                SELECT COUNT(*) AS total, COALESCE(SUM(puntaje), 0) AS puntos
                FROM leads
                WHERE dia_venta >= :s AND dia_venta < :ex AND {_status_validos}
            """), {"s": start, "ex": end_excl})
            totals_row = r0.mappings().first()

            # ── 1b. Ranking por agente (top 100 para mejores vendedor/team) ──
            r1 = await s.execute(text(f"""
                SELECT
                    COALESCE(agente_nombre, agente, 'Sin asignar') AS nombre,
                    COUNT(*)                                        AS ventas,
                    COALESCE(SUM(puntaje), 0)                      AS puntos
                FROM leads
                WHERE dia_venta >= :s AND dia_venta < :ex AND {_status_validos}
                GROUP BY agente_nombre, agente
                ORDER BY puntos DESC
                LIMIT 100
            """), {"s": start, "ex": end_excl})
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
                SELECT servicios
                FROM leads
                WHERE (dia_venta BETWEEN :s AND :e
                       OR (dia_venta IS NULL AND created_at BETWEEN :s AND :e))
                  AND UPPER(TRIM(COALESCE(status,''))) NOT IN ('CANCELLED','CANCELADO','CANCELADA','CANCEL','HOLD','RESERVA','RESCHEDULED','REAGENDADO')
                  AND servicios IS NOT NULL
                  AND TRIM(servicios) NOT IN ('', '[]', 'null')
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

            # ── 7. Llamadas pendientes — verificación/seguimiento (vista global) ──
            # Mismos criterios que routers/leads.py (_LLAMADAS_DUE_SQL) pero sin
            # filtrar por agente: aquí es una visualización general del dashboard.
            r7 = await s.execute(text("""
                SELECT id, nombre_cliente, telefono_principal, telefono, status,
                       agente_nombre,
                       COALESCE(llamadas_realizadas,0) AS llamadas_realizadas,
                       fecha_completed, fecha_ultima_llamada, llamada_cliente
                FROM leads
                WHERE
                    (LOWER(COALESCE(status,'')) LIKE '%cancel%'
                     AND COALESCE(llamada_cliente,'') = 'Pendiente'
                     AND COALESCE(llamadas_realizadas,0) = 0)
                    OR
                    (LOWER(COALESCE(status,'')) LIKE '%complet%'
                     AND fecha_completed IS NOT NULL
                     AND COALESCE(llamadas_realizadas,0) < 2)
                ORDER BY COALESCE(fecha_ultima_llamada, fecha_completed, created_at) ASC
                LIMIT 200
            """))
            llamadas_rows = r7.mappings().all()

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
    total_ventas = int(totals_row["total"] or 0) if totals_row else sum(d["ventas"] for d in deduped)
    total_puntos = float(totals_row["puntos"] or 0) if totals_row else sum(d["puntos"] for d in deduped)
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

    # ── Top productos (servicios — JSON array) ────────────────────────────────
    prod_map: dict = {}
    for row in servs_rows:
        raw = row["servicios"]
        items: list = []
        if isinstance(raw, list):
            items = raw
        elif isinstance(raw, str):
            try:
                parsed = _json.loads(raw)
                items = parsed if isinstance(parsed, list) else [parsed]
            except Exception:
                if raw.strip():
                    items = [raw.strip()]
        for svc in items:
            key = str(svc or "").strip().upper()
            if key and key not in ('', 'NULL', 'NONE'):
                prod_map[key] = prod_map.get(key, 0) + 1
    top_productos = sorted(
        [{"servicio": k, "count": v} for k, v in prod_map.items()],
        key=lambda x: -x["count"]
    )

    # ── Actividades recientes ──────────────────────────────────────────────────
    def _tiempo_relativo(created_at):
        if not created_at:
            return "Reciente"
        try:
            delta = _utcnow() - created_at.replace(tzinfo=None)
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

    # ── Llamadas pendientes — vencidas + próximas + en espera ───────────────────
    # vencida  : la llamada ya venció (hay que llamar)
    # proxima  : vence dentro de los próximos _PROXIMA_DIAS días
    # espera   : completado, aún contando los 15 días para la llamada
    _PROXIMA_DIAS = 3   # días "hacia adelante" que cuentan como "próxima"
    _CICLO_DIAS   = 15  # cada llamada se programa 15 días después de la anterior
    llamadas_pendientes = []
    for row in llamadas_rows:
        d  = dict(row)
        st = str(d.get("status") or "").lower()
        n  = int(d.get("llamadas_realizadas") or 0)
        if "cancel" in st:
            # Cancelada sin llamar → vencida desde el momento en que se canceló
            due  = d.get("fecha_completed") or now
            tipo = "verificacion"
        else:
            base = d.get("fecha_ultima_llamada") or d.get("fecha_completed")
            if not base:
                continue
            due  = base + _dt.timedelta(days=_CICLO_DIAS)
            tipo = "verificacion" if n == 0 else "seguimiento"
        try:
            dias = (due.replace(tzinfo=None) - now).days
        except Exception:
            dias = 0
        if dias <= 0:
            estado = "vencida"
        elif dias <= _PROXIMA_DIAS:
            estado = "proxima"
        else:
            estado = "espera"   # completado, aún dentro de la ventana de 15 días
        llamadas_pendientes.append({
            "id":                  str(d.get("id", "")),
            "nombre_cliente":      d.get("nombre_cliente") or "—",
            "telefono":            d.get("telefono_principal") or d.get("telefono") or "",
            "agente_nombre":       d.get("agente_nombre") or "—",
            "status":              d.get("status") or "",
            "llamadas_realizadas": n,
            "numero_llamada":      n + 1,
            "tipo_llamada":        tipo,           # verificacion | seguimiento
            "estado":              estado,         # vencida | proxima
            "dias":                dias,           # <=0 vencida (atraso = -dias), >0 faltan
        })
    # Vencidas primero (más atrasadas), luego próximas y en espera (más cercanas)
    llamadas_pendientes.sort(key=lambda x: x["dias"])
    llamadas_pendientes = llamadas_pendientes[:25]

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
        "llamadas_pendientes":    llamadas_pendientes,
        "mapa_clientes": _build_map_pins(map_rows),
        "meta": {
            "mes":       now.month,
            "anio":      now.year,
            "timestamp": now.isoformat(),
        },
    }

    return result


@router.get("/actividades")
async def get_actividades(user: dict = Depends(current_user)):
    """Endpoint liviano para auto-refresh de actividades recientes (sin caché)."""
    def _tiempo_relativo(ts):
        if not ts: return "Reciente"
        try:
            delta = _utcnow() - ts.replace(tzinfo=None)
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
