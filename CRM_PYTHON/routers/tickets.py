"""Tickets: cualquier persona del CRM reporta un problema o pide algo a administración.

- Se crean desde la tuerquita (js/componentes/tickets.js) con título, descripción, tipo,
  prioridad, capturas y la pantalla desde la que se abrió.
- Quien tiene «tickets.gestionar» (Administrador por defecto) ve la bandeja completa,
  cambia el estado y responde. El resto solo ve los suyos y puede responder en ellos.
- Las capturas van a <repo>/datos_privados/tickets (fuera de /uploads) con nombre uuid y
  solo las entrega GET /api/tickets/adjuntos/{id} a quien puede ver ese ticket.
- Avisos en vivo: a administración al crearse un ticket o al responder el autor; al
  autor cuando administración responde o cambia el estado.
"""
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

import rbac
import realtime
from database_mysql import AsyncSessionLocal
from deps import current_user

router = APIRouter(prefix="/api/tickets", tags=["Tickets"])

DIR = Path(os.environ.get("TICKETS_DIR")
           or Path(__file__).resolve().parent.parent.parent / "datos_privados" / "tickets")
MAX_IMG = 8 * 1024 * 1024
MAX_ADJUNTOS = 5

TIPOS = {"error": "Error", "mejora": "Mejora", "acceso": "Acceso o permisos", "consulta": "Consulta", "otro": "Otro"}
PRIORIDADES = {"baja": "Baja", "normal": "Normal", "alta": "Alta", "urgente": "Urgente"}
ESTADOS = {"nuevo": "Nuevo", "en_progreso": "En progreso", "esperando": "Esperando respuesta",
           "resuelto": "Resuelto", "cerrado": "Cerrado"}

# Firmas de imagen (se mira el contenido, no la extensión que manda el navegador).
_FIRMAS = ((b"\x89PNG\r\n\x1a\n", ".png", "image/png"), (b"\xff\xd8\xff", ".jpg", "image/jpeg"),
           (b"GIF8", ".gif", "image/gif"), (b"RIFF", ".webp", "image/webp"))


def _gestiona(user: dict) -> bool:
    return rbac.tiene(user, "tickets.gestionar")


def _uid(user: dict) -> int:
    try:
        return int(user.get("id") or 0)
    except (TypeError, ValueError):
        return 0


async def _ticket_visible(s, tid: int, user: dict) -> dict:
    row = (await s.execute(text("SELECT * FROM tickets WHERE id = :id"), {"id": tid})).mappings().first()
    if not row or (not _gestiona(user) and row["creado_por_id"] != _uid(user)):
        raise HTTPException(404, "Ticket no encontrado")
    return dict(row)


async def _guardar_imagenes(s, tid: int, msg_id, archivos: list[UploadFile], user: dict) -> int:
    archivos = [a for a in (archivos or []) if a and a.filename]
    if len(archivos) > MAX_ADJUNTOS:
        raise HTTPException(400, f"Máximo {MAX_ADJUNTOS} capturas por mensaje")
    DIR.mkdir(parents=True, exist_ok=True)
    n = 0
    for a in archivos:
        datos = await a.read(MAX_IMG + 1)
        if len(datos) > MAX_IMG:
            raise HTTPException(413, f"{a.filename} pasa de 8 MB")
        firma = next(((ext, mime) for f, ext, mime in _FIRMAS if datos.startswith(f)), None)
        if not firma or (firma[0] == ".webp" and datos[8:12] != b"WEBP"):
            raise HTTPException(415, f"{a.filename} no es una imagen (PNG, JPG, GIF o WEBP)")
        nombre_disco = uuid.uuid4().hex + firma[0]
        (DIR / nombre_disco).write_bytes(datos)
        await s.execute(text("""
            INSERT INTO ticket_adjuntos (ticket_id, mensaje_id, nombre, archivo, mime, tamano, subido_por)
            VALUES (:t, :m, :n, :a, :mi, :ta, :u)
        """), {"t": tid, "m": msg_id, "n": os.path.basename(a.filename)[:150], "a": nombre_disco,
               "mi": firma[1], "ta": len(datos), "u": str(user.get("username") or "")[:150]})
        n += 1
    return n


def _fila(r: dict) -> dict:
    d = dict(r)
    for k in ("created_at", "updated_at", "resuelto_at"):
        if d.get(k):
            d[k] = d[k].isoformat()
    d["tipo_txt"] = TIPOS.get(d.get("tipo"), d.get("tipo"))
    d["prioridad_txt"] = PRIORIDADES.get(d.get("prioridad"), d.get("prioridad"))
    d["estado_txt"] = ESTADOS.get(d.get("estado"), d.get("estado"))
    return d


@router.get("/opciones")
async def opciones(user: dict = Depends(current_user)):
    return {"success": True, "tipos": TIPOS, "prioridades": PRIORIDADES, "estados": ESTADOS,
            "gestiona": _gestiona(user), "puede_crear": rbac.tiene(user, "tickets.crear")}


@router.post("")
async def crear(
    titulo: str = Form(..., min_length=3, max_length=150),
    descripcion: str = Form(..., min_length=3, max_length=5000),
    tipo: str = Form("error"),
    prioridad: str = Form("normal"),
    pagina: str = Form("", max_length=200),
    capturas: list[UploadFile] = File(default=[]),
    user: dict = Depends(rbac.requiere("tickets.crear", "No tienes permiso para crear tickets")),
):
    if tipo not in TIPOS or prioridad not in PRIORIDADES:
        raise HTTPException(400, "Tipo o prioridad no válidos")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            INSERT INTO tickets (creado_por_id, creado_por, team, rol, titulo, descripcion, tipo, prioridad, pagina, estado)
            VALUES (:uid, :u, :team, :rol, :t, :d, :tipo, :p, :pag, 'nuevo')
        """), {"uid": _uid(user), "u": str(user.get("username") or "")[:150], "team": str(user.get("team") or "")[:150],
               "rol": str(user.get("role") or "")[:60], "t": titulo.strip(), "d": descripcion.strip(),
               "tipo": tipo, "p": prioridad, "pag": pagina.split("?")[0][:200]})
        tid = r.lastrowid
        await _guardar_imagenes(s, tid, None, capturas, user)
        await s.commit()
    await realtime.publish(realtime.CANAL_ADMIN, {"type": "ticket", "accion": "nuevo", "id": tid,
                                                  "titulo": titulo.strip()[:80], "prioridad": prioridad,
                                                  "de": user.get("username")})
    return {"success": True, "id": tid}


@router.get("")
async def listar(estado: str = "", todos: int = 0, user: dict = Depends(current_user)):
    """Los míos; con todos=1 y permiso de gestión, la bandeja completa."""
    where, p = [], {}
    if not (todos and _gestiona(user)):
        where.append("t.creado_por_id = :uid"); p["uid"] = _uid(user)
    if estado == "abiertos":
        where.append("t.estado IN ('nuevo','en_progreso','esperando')")
    elif estado in ESTADOS:
        where.append("t.estado = :e"); p["e"] = estado
    sql = f"""
        SELECT t.*, (SELECT COUNT(*) FROM ticket_mensajes m WHERE m.ticket_id = t.id) AS mensajes,
               (SELECT COUNT(*) FROM ticket_adjuntos a WHERE a.ticket_id = t.id) AS adjuntos
        FROM tickets t {'WHERE ' + ' AND '.join(where) if where else ''}
        ORDER BY FIELD(t.estado,'nuevo','en_progreso','esperando','resuelto','cerrado'),
                 FIELD(t.prioridad,'urgente','alta','normal','baja'), t.id DESC
        LIMIT 500"""
    async with AsyncSessionLocal() as s:
        filas = [_fila(x) for x in (await s.execute(text(sql), p)).mappings().all()]
        cont = {}
        if todos and _gestiona(user):
            for e, n in (await s.execute(text("SELECT estado, COUNT(*) FROM tickets GROUP BY estado"))).all():
                cont[e] = int(n)
    return {"success": True, "items": filas, "conteo": cont, "gestiona": _gestiona(user)}


@router.get("/{tid}")
async def ver(tid: int, user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        t = await _ticket_visible(s, tid, user)
        msgs = [dict(x) for x in (await s.execute(text(
            "SELECT id, autor, es_admin, sistema, texto, created_at FROM ticket_mensajes WHERE ticket_id = :t ORDER BY id"),
            {"t": tid})).mappings().all()]
        adj = [dict(x) for x in (await s.execute(text(
            "SELECT id, mensaje_id, nombre, tamano FROM ticket_adjuntos WHERE ticket_id = :t ORDER BY id"),
            {"t": tid})).mappings().all()]
    for m in msgs:
        m["created_at"] = m["created_at"].isoformat() if m["created_at"] else None
    return {"success": True, "ticket": _fila(t), "mensajes": msgs, "adjuntos": adj, "gestiona": _gestiona(user)}


@router.post("/{tid}/mensajes")
async def responder(tid: int, texto: str = Form(..., min_length=1, max_length=5000),
                    capturas: list[UploadFile] = File(default=[]), user: dict = Depends(current_user)):
    gestiona = _gestiona(user)
    async with AsyncSessionLocal() as s:
        t = await _ticket_visible(s, tid, user)
        if t["estado"] == "cerrado" and not gestiona:
            raise HTTPException(400, "El ticket está cerrado. Crea uno nuevo si sigue pasando.")
        r = await s.execute(text("""INSERT INTO ticket_mensajes (ticket_id, autor, autor_id, es_admin, texto)
                                    VALUES (:t, :a, :aid, :adm, :x)"""),
                            {"t": tid, "a": str(user.get("username") or "")[:150], "aid": _uid(user),
                             "adm": 1 if gestiona else 0, "x": texto.strip()})
        await _guardar_imagenes(s, tid, r.lastrowid, capturas, user)
        # Si administración responde a un ticket nuevo, pasa a «en progreso»; si responde el
        # autor a uno que esperaba su respuesta, vuelve a «en progreso».
        nuevo_estado = None
        if gestiona and t["estado"] == "nuevo":
            nuevo_estado = "en_progreso"
        elif not gestiona and t["estado"] in ("esperando", "resuelto"):
            nuevo_estado = "en_progreso"
        await s.execute(text("UPDATE tickets SET updated_at = NOW()" + (", estado = :e" if nuevo_estado else "") +
                             " WHERE id = :t"), {"t": tid, **({"e": nuevo_estado} if nuevo_estado else {})})
        await s.commit()
    if gestiona and t["creado_por_id"] != _uid(user):
        await realtime.publish(realtime.canal_usuario(t["creado_por_id"]),
                               {"type": "ticket", "accion": "respuesta", "id": tid, "titulo": t["titulo"][:80]})
    else:
        await realtime.publish(realtime.CANAL_ADMIN, {"type": "ticket", "accion": "mensaje", "id": tid,
                                                      "titulo": t["titulo"][:80], "de": user.get("username")})
    return {"success": True}


class Cambio(BaseModel):
    estado: str | None = None
    prioridad: str | None = None
    asignado_a: str | None = Field(None, max_length=150)


@router.put("/{tid}")
async def cambiar(tid: int, body: Cambio, user: dict = Depends(rbac.requiere("tickets.gestionar"))):
    sets, p = [], {"t": tid}
    if body.estado is not None:
        if body.estado not in ESTADOS:
            raise HTTPException(400, "Estado no válido")
        sets.append("estado = :e"); p["e"] = body.estado
        sets.append("resuelto_at = " + ("NOW()" if body.estado in ("resuelto", "cerrado") else "NULL"))
    if body.prioridad is not None:
        if body.prioridad not in PRIORIDADES:
            raise HTTPException(400, "Prioridad no válida")
        sets.append("prioridad = :p"); p["p"] = body.prioridad
    if body.asignado_a is not None:
        sets.append("asignado_a = :a"); p["a"] = body.asignado_a.strip() or None
    if not sets:
        return {"success": True}
    async with AsyncSessionLocal() as s:
        t = await _ticket_visible(s, tid, user)
        await s.execute(text(f"UPDATE tickets SET {', '.join(sets)}, updated_at = NOW() WHERE id = :t"), p)
        if body.estado and body.estado != t["estado"]:
            await s.execute(text("""INSERT INTO ticket_mensajes (ticket_id, autor, autor_id, es_admin, texto, sistema)
                                    VALUES (:t, :a, :aid, 1, :x, 1)"""),
                            {"t": tid, "a": str(user.get("username") or "")[:150], "aid": _uid(user),
                             "x": f"Cambió el estado a «{ESTADOS[body.estado]}»"})
        await s.commit()
    if body.estado and body.estado != t["estado"]:
        await realtime.publish(realtime.canal_usuario(t["creado_por_id"]),
                               {"type": "ticket", "accion": "estado", "id": tid, "titulo": t["titulo"][:80],
                                "estado": ESTADOS[body.estado]})
    return {"success": True}


@router.get("/adjuntos/{aid}")
async def adjunto(aid: int, user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        a = (await s.execute(text("SELECT ticket_id, archivo, mime, nombre FROM ticket_adjuntos WHERE id = :id"),
                             {"id": aid})).mappings().first()
        if not a:
            raise HTTPException(404, "No encontrado")
        await _ticket_visible(s, a["ticket_id"], user)
    ruta = (DIR / a["archivo"]).resolve()
    if DIR.resolve() not in ruta.parents or not ruta.is_file():
        raise HTTPException(404, "No encontrado")
    return FileResponse(str(ruta), media_type=a["mime"],
                        headers={"Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff"})
