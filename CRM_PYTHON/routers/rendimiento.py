"""Rendimiento de usuarios: cuánto tarda cada pantalla en cargar en la PC de cada persona.

El navegador mide su propia carga (js/core/rendimiento.js, lo inyecta el menú) y la
envía aquí con sendBeacon. Permisos → «Rendimiento de usuarios» la resume (acción
«sistema.rendimiento»). Las mediciones se borran solas a los 30 días.
"""
import json
import random
import re
import statistics
from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from sqlalchemy import text

import rbac
from database_mysql import AsyncSessionLocal
from deps import current_user
from datetime import datetime
from tiempo_sv import TZ_SV

router = APIRouter(prefix="/api/rendimiento", tags=["Rendimiento"])

_DIAS_GUARDADO = 30
_MS_MAX = 600_000          # 10 min: más que eso es una pestaña dormida, no una carga


def _ms(v) -> int | None:
    try:
        n = int(round(float(v)))
    except (TypeError, ValueError):
        return None
    return n if 0 <= n <= _MS_MAX else None


def _pagina(p) -> str:
    p = re.sub(r"[?#].*$", "", str(p or ""))[:150]
    return p if p.startswith("/") else "/" + p


@router.post("", status_code=204)
async def registrar(request: Request, user: dict = Depends(current_user)):
    """Una medición por carga de página. Nunca falla hacia el navegador (204 siempre)."""
    try:
        raw = await request.body()
        if len(raw) > 8000:
            return Response(status_code=204)
        d = json.loads(raw or b"{}")
        total = _ms(d.get("total_ms"))
        if total is None:
            return Response(status_code=204)
        lentas = []
        for x in (d.get("lentas") or [])[:3]:
            ms = _ms(x.get("ms")) if isinstance(x, dict) else None
            if ms is not None:
                lentas.append({"url": _pagina(x.get("url"))[:120], "ms": ms})
        cores = d.get("cores")
        mem = d.get("memoria_gb")
        async with AsyncSessionLocal() as s:
            await s.execute(text("""
                INSERT INTO rendimiento_cargas
                  (user_id, username, team, rol, pagina, total_ms, servidor_ms, descarga_ms,
                   dom_ms, congelado_ms, n_congelados, cores, memoria_gb, conexion, lentas)
                VALUES (:uid, :u, :team, :rol, :pag, :total, :srv, :desc, :dom, :cong, :ncong,
                        :cores, :mem, :con, :lentas)
            """), {
                "uid": int(user.get("id") or 0) or None,
                "u": str(user.get("username") or "")[:150],
                "team": str(user.get("team") or "")[:150],
                "rol": str(user.get("role") or "")[:60],
                "pag": _pagina(d.get("pagina")),
                "total": total,
                "srv": _ms(d.get("servidor_ms")),
                "desc": _ms(d.get("descarga_ms")),
                "dom": _ms(d.get("dom_ms")),
                "cong": _ms(d.get("congelado_ms")),
                "ncong": max(0, min(int(d.get("n_congelados") or 0), 10000)),
                "cores": int(cores) if isinstance(cores, (int, float)) and 0 < cores < 256 else None,
                "mem": float(mem) if isinstance(mem, (int, float)) and 0 < mem < 1024 else None,
                "con": str(d.get("conexion") or "")[:20] or None,
                "lentas": json.dumps(lentas) if lentas else None,
            })
            # Limpieza ocasional de lo que pasó de 30 días.
            if random.random() < 0.02:
                await s.execute(text("DELETE FROM rendimiento_cargas WHERE created_at < NOW() - INTERVAL :d DAY"),
                                {"d": _DIAS_GUARDADO})
            await s.commit()
    except Exception as e:
        print(f"[rendimiento] no se pudo guardar una medición: {e}")
    return Response(status_code=204)


def _p(vals, q):
    if not vals:
        return None
    vals = sorted(vals)
    i = min(len(vals) - 1, int(round(q * (len(vals) - 1))))
    return vals[i]


def _resumen(filas) -> dict:
    t = [f["total_ms"] for f in filas]
    srv = [f["servidor_ms"] for f in filas if f["servidor_ms"] is not None]
    cong = [f["congelado_ms"] or 0 for f in filas]
    return {
        "cargas": len(filas),
        "promedio_ms": round(statistics.mean(t)) if t else None,
        "mediana_ms": _p(t, .5),
        "p90_ms": _p(t, .9),
        "servidor_ms": round(statistics.mean(srv)) if srv else None,
        "congelado_ms": round(statistics.mean(cong)) if cong else None,
        "lentas_pct": round(100 * sum(1 for x in t if x > 5000) / len(t)) if t else 0,
    }


@router.get("/resumen")
async def resumen(dias: int = 7, user: dict = Depends(rbac.requiere("sistema.rendimiento"))):
    dias = max(1, min(int(dias or 7), _DIAS_GUARDADO))
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT created_at, username, team, pagina, total_ms, servidor_ms, descarga_ms, dom_ms,
                   congelado_ms, n_congelados, cores, memoria_gb, conexion, lentas
            FROM rendimiento_cargas WHERE created_at >= NOW() - INTERVAL :d DAY
            ORDER BY created_at DESC LIMIT 50000
        """), {"d": dias})
        filas = [dict(x) for x in r.mappings().all()]

    def agrupar(clave):
        g: dict = {}
        for f in filas:
            g.setdefault(clave(f), []).append(f)
        return g

    por_pagina = [{"pagina": k, **_resumen(v)} for k, v in agrupar(lambda f: f["pagina"]).items()]
    por_pagina.sort(key=lambda x: -(x["p90_ms"] or 0))

    por_persona = []
    for k, v in agrupar(lambda f: f["username"]).items():
        ult = v[0]
        por_persona.append({"username": k, "team": ult["team"], "cores": ult["cores"],
                            "memoria_gb": ult["memoria_gb"], "conexion": ult["conexion"], **_resumen(v)})
    por_persona.sort(key=lambda x: -(x["p90_ms"] or 0))

    por_team = [{"team": k or "Sin equipo", **_resumen(v)} for k, v in agrupar(lambda f: f["team"] or "").items()]

    # Hora de El Salvador (created_at está en UTC: CURRENT_TIMESTAMP de la RDS).
    horas = round(datetime.now(TZ_SV).utcoffset().total_seconds() / 3600)   # El Salvador: -6
    por_hora = []
    for h, v in sorted(agrupar(lambda f: (f["created_at"] + timedelta(hours=horas)).hour).items()):
        por_hora.append({"hora": h, **_resumen(v)})

    peores = sorted(filas, key=lambda f: -f["total_ms"])[:15]
    for f in peores:
        f["created_at"] = (f["created_at"] + timedelta(hours=horas)).strftime("%d/%m %H:%M")
        try:
            f["lentas"] = json.loads(f["lentas"]) if f["lentas"] else []
        except ValueError:
            f["lentas"] = []

    return {"success": True, "dias": dias, "general": _resumen(filas),
            "por_pagina": por_pagina, "por_persona": por_persona, "por_team": por_team, "por_hora": por_hora, "peores": peores}
