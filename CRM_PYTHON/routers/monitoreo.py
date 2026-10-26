"""Monitoreo (residencial/monitoreo.html).

GET /api/monitoreo/teams → los equipos de venta de Residencial con su supervisor y sus
agentes, tal como están en Permisos (users.team). Solo entran los roles Supervisor y Agente
(vendedor, administrador, etc. no aparecen aunque estén en el team). Cada agente trae sus
faltas de la semana en curso.

Equipo de venta = team con al menos un supervisor (mismo criterio que /api/teams?sales=1),
así quedan fuera Administración, Back Office, Control de calidad, ICON, USA… Residencial
= team_seccion() del team; los de Líneas no entran.

Alcance:
- Admin / Back Office: todos los equipos.
- Supervisor y agente: solo el suyo. El team se lee de la BD y no del token, para que un
  cambio de equipo en Permisos se vea sin volver a iniciar sesión.

Faltas en sus llamadas (tabla monitoreo_faltas, migración 0074): cada fila es una falta de
un agente en un día de la semana en curso (lunes a domingo, hora de El Salvador), con una
nota del porqué. Un mismo día puede tener varias; las 3 del aviso se cuentan en la semana.
- POST /api/monitoreo/faltas: agrega una falta. DELETE /api/monitoreo/faltas/{id}: la quita.
  Admin y Back Office (ahí está Control de calidad) en cualquier agente; el supervisor solo
  en los de su team; el agente no. Días futuros no se marcan. Las notas solo las reciben
  quienes pueden marcar.
- GET /api/monitoreo/mis-faltas: lo pide el aviso del agente (js/componentes/aviso-faltas.js).
  Con AVISO_DESDE faltas o más en la semana y alguna marca sin ver → aviso «Tienes N faltas».
- POST /api/monitoreo/mis-faltas/visto: el agente cerró el aviso. Una falta nueva lo
  vuelve a mostrar.
- GET /api/monitoreo/alertas (solo administración): agentes con AVISO_DESDE faltas o más
  en la semana, para sacarlos de inbound.
- Al agregar, quitar o ver una falta se avisa al instante por el centro de notificaciones
  (realtime: canal del agente y canal de administración); aviso-faltas.js vuelve a pedir
  mis-faltas o alertas. Ver routers/stream.py → /api/stream/notificaciones.
"""
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

import audit
import realtime
from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion, ADMIN_ROLES
from tiempo_sv import ahora_sv

router = APIRouter(prefix="/api/monitoreo", tags=["Monitoreo"])

AVISO_DESDE = 3


def _es_admin_bo(user: dict) -> bool:
    r = str(user.get("role") or "").lower()
    return "admin" in r or "backoffice" in r or "back office" in r


def _es_administrador(user: dict) -> bool:
    return str(user.get("role") or "").strip().lower() in {r.lower() for r in ADMIN_ROLES}


def _es_supervisor(role: str) -> bool:
    return "supervisor" in str(role or "").lower()


def _es_agente(role: str) -> bool:
    return str(role or "").strip().lower() == "agente"


async def _avisar(user_id) -> None:
    """Cambiaron las faltas de un agente: a él (su aviso) y a administración (alertas)."""
    await realtime.publish(realtime.canal_usuario(user_id), {"type": "faltas"})
    await realtime.publish(realtime.CANAL_ADMIN, {"type": "faltas"})


def _semana() -> tuple[date, date, date]:
    """(lunes, domingo, hoy) de la semana en curso, hora de El Salvador."""
    hoy = ahora_sv().date()
    lunes = hoy - timedelta(days=hoy.weekday())
    return lunes, lunes + timedelta(days=6), hoy


@router.get("/teams")
async def teams_residencial(user: dict = Depends(current_user)):
    lunes, domingo, hoy = _semana()
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, username, role, TRIM(team) AS team, avatar_url
            FROM users
            WHERE team IS NOT NULL AND TRIM(team) != ''
              AND COALESCE(acceso_crm, 1) = 1
              AND COALESCE(active, 1) = 1
            ORDER BY username
        """))
        filas = r.mappings().all()

        mi_team = None
        if not _es_admin_bo(user):
            r = await s.execute(text("SELECT TRIM(team) AS team FROM users WHERE id = :id"),
                                {"id": user.get("id")})
            mi_team = (r.scalar() or "").strip().upper()

        r = await s.execute(text("""
            SELECT id, user_id, fecha, nota, marcado_por FROM monitoreo_faltas
            WHERE fecha BETWEEN :d AND :h ORDER BY id
        """), {"d": lunes, "h": domingo})
        faltas: dict[str, list[dict]] = {}
        for f in r.mappings().all():
            faltas.setdefault(str(f["user_id"]), []).append(
                {"id": str(f["id"]), "fecha": f["fecha"].isoformat(),
                 "nota": f["nota"] or "", "por": f["marcado_por"] or ""})

    # Quién puede marcar: admin/BO en todos; el supervisor en su team (mi_team lo filtra abajo).
    puede = _es_admin_bo(user) or _es_supervisor(user.get("role"))

    teams: dict[str, dict] = {}
    for f in filas:
        nombre = f["team"]
        if team_seccion(nombre) != "residencial":
            continue
        if mi_team is not None and nombre.upper() != mi_team:
            continue
        if _es_supervisor(f["role"]):
            grupo = "supervisores"
        elif _es_agente(f["role"]):
            grupo = "agentes"
        else:
            continue
        t = teams.setdefault(nombre.upper(), {"team": nombre, "supervisores": [], "agentes": []})
        persona = {"id": str(f["id"]), "username": f["username"], "role": f["role"],
                   "avatar_url": f["avatar_url"]}
        if grupo == "agentes":
            propias = faltas.get(persona["id"], [])
            # El agente ve los checks de su team, no las notas.
            persona["faltas"] = propias if puede else [{"fecha": x["fecha"]} for x in propias]
        t[grupo].append(persona)

    lista = sorted((t for t in teams.values() if t["supervisores"]), key=lambda t: t["team"])
    for t in lista:
        t["puede_marcar"] = puede
    return {
        "success": True,
        "semana": {"dias": [(lunes + timedelta(days=i)).isoformat() for i in range(7)],
                   "hoy": hoy.isoformat()},
        "teams": lista,
    }


class FaltaIn(BaseModel):
    user_id: int
    fecha: date
    nota: Optional[str] = None


# Tope por agente y día: evita que un doble clic o un script llene la tabla.
_MAX_POR_DIA = 20


async def _agente_marcable(s, user: dict, user_id: int) -> dict:
    """El agente al que `user` puede ponerle o quitarle faltas, o HTTPException."""
    admin_bo = _es_admin_bo(user)
    if not admin_bo and not _es_supervisor(user.get("role")):
        raise HTTPException(403, "Sin permiso")
    r = await s.execute(text("""
        SELECT id, username, role, TRIM(team) AS team FROM users
        WHERE id = :id AND COALESCE(active, 1) = 1
    """), {"id": user_id})
    agente = r.mappings().first()
    if (not agente or not _es_agente(agente["role"])
            or team_seccion(agente["team"] or "") != "residencial"):
        raise HTTPException(404, "Agente no encontrado")
    if not admin_bo:
        r = await s.execute(text("SELECT TRIM(team) FROM users WHERE id = :id"),
                            {"id": user.get("id")})
        if (r.scalar() or "").strip().upper() != (agente["team"] or "").upper():
            raise HTTPException(403, "Solo puedes marcar agentes de tu team")
    return agente


async def _total_semana(s, user_id: int, lunes: date, domingo: date) -> int:
    r = await s.execute(text("""
        SELECT COUNT(*) FROM monitoreo_faltas WHERE user_id = :u AND fecha BETWEEN :d AND :h
    """), {"u": user_id, "d": lunes, "h": domingo})
    return int(r.scalar() or 0)


@router.post("/faltas")
async def agregar_falta(body: FaltaIn, user: dict = Depends(current_user)):
    lunes, domingo, hoy = _semana()
    if not (lunes <= body.fecha <= domingo):
        raise HTTPException(400, "Solo se marcan días de la semana en curso")
    if body.fecha > hoy:
        raise HTTPException(400, "No se puede marcar un día que aún no llega")
    nota = (body.nota or "").strip()[:500] or None
    por = str(user.get("username") or "")[:150]

    async with AsyncSessionLocal() as s:
        agente = await _agente_marcable(s, user, body.user_id)
        r = await s.execute(text("""
            SELECT COUNT(*) FROM monitoreo_faltas WHERE user_id = :u AND fecha = :f
        """), {"u": body.user_id, "f": body.fecha})
        if int(r.scalar() or 0) >= _MAX_POR_DIA:
            raise HTTPException(400, f"Máximo {_MAX_POR_DIA} faltas por día")
        r = await s.execute(text("""
            INSERT INTO monitoreo_faltas (user_id, fecha, nota, marcado_por)
            VALUES (:u, :f, :nota, :por)
        """), {"u": body.user_id, "f": body.fecha, "nota": nota, "por": por})
        nuevo_id = r.lastrowid
        total = await _total_semana(s, body.user_id, lunes, domingo)
        await s.commit()

    await _avisar(body.user_id)
    audit._log("MONITOREO_FALTA_AGREGAR", username=por,
               extra={"agente": agente["username"], "fecha": body.fecha.isoformat(),
                      "semana": total, "nota": nota})
    return {"success": True, "faltas_semana": total,
            "falta": {"id": str(nuevo_id), "fecha": body.fecha.isoformat(), "nota": nota or "", "por": por}}


@router.delete("/faltas/{falta_id}")
async def quitar_falta(falta_id: int, user: dict = Depends(current_user)):
    lunes, domingo, _ = _semana()
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT user_id, fecha, nota FROM monitoreo_faltas WHERE id = :id"),
                            {"id": falta_id})
        falta = r.mappings().first()
        if not falta:
            raise HTTPException(404, "Falta no encontrada")
        if not (lunes <= falta["fecha"] <= domingo):
            raise HTTPException(400, "Solo se quitan faltas de la semana en curso")
        agente = await _agente_marcable(s, user, falta["user_id"])
        await s.execute(text("DELETE FROM monitoreo_faltas WHERE id = :id"), {"id": falta_id})
        total = await _total_semana(s, falta["user_id"], lunes, domingo)
        await s.commit()

    await _avisar(falta["user_id"])
    audit._log("MONITOREO_FALTA_QUITAR", username=str(user.get("username") or ""),
               extra={"agente": agente["username"], "fecha": falta["fecha"].isoformat(),
                      "semana": total, "nota": falta["nota"]})
    return {"success": True, "faltas_semana": total}


@router.get("/mis-faltas")
async def mis_faltas(user: dict = Depends(current_user)):
    lunes, domingo, _ = _semana()
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT COUNT(*) AS n, COALESCE(SUM(aviso_visto = 0), 0) AS sin_ver
            FROM monitoreo_faltas WHERE user_id = :u AND fecha BETWEEN :d AND :h
        """), {"u": user.get("id"), "d": lunes, "h": domingo})
        f = r.mappings().first()
    n, sin_ver = int(f["n"] or 0), int(f["sin_ver"] or 0)
    return {"success": True, "faltas": n, "aviso": n >= AVISO_DESDE and sin_ver > 0}


@router.post("/mis-faltas/visto")
async def mis_faltas_visto(user: dict = Depends(current_user)):
    lunes, domingo, _ = _semana()
    async with AsyncSessionLocal() as s:
        await s.execute(text("""
            UPDATE monitoreo_faltas SET aviso_visto = 1
            WHERE user_id = :u AND fecha BETWEEN :d AND :h AND aviso_visto = 0
        """), {"u": user.get("id"), "d": lunes, "h": domingo})
        await s.commit()
    # Las demás pestañas del agente cierran su ventana.
    await realtime.publish(realtime.canal_usuario(user.get("id")), {"type": "faltas"})
    return {"success": True}


@router.get("/alertas")
async def alertas_admin(user: dict = Depends(current_user)):
    if not _es_administrador(user):
        raise HTTPException(403, "Sin permiso")
    lunes, domingo, _ = _semana()
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT u.id, u.username, TRIM(u.team) AS team, COUNT(*) AS faltas,
                   MAX(f.created_at) AS ultima
            FROM monitoreo_faltas f JOIN users u ON u.id = f.user_id
            WHERE f.fecha BETWEEN :d AND :h AND COALESCE(u.active, 1) = 1
            GROUP BY u.id, u.username, u.team
            HAVING COUNT(*) >= :n
            ORDER BY ultima DESC
        """), {"d": lunes, "h": domingo, "n": AVISO_DESDE})
        filas = r.mappings().all()
    return {
        "success": True,
        "semana": lunes.isoformat(),
        "agentes": [{"id": str(f["id"]), "username": f["username"], "team": f["team"],
                     "faltas": int(f["faltas"])} for f in filas],
    }
