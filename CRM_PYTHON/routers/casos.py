"""
Semáforo de clientes — endpoints de los "casos a solventar".
Reglas y colores: CRM_PYTHON/casos.py.

  GET    /api/casos/semaforo                 clientes del semáforo (según rol)
  GET    /api/casos/pendientes               casos sin solventar del agente (aviso en pantalla)
  GET    /api/leads/{id}/caso                caso + comprobantes de un cliente
  PUT    /api/leads/{id}/caso                escribir / corregir el caso
  POST   /api/leads/{id}/caso/comprobante    subir comprobante → caso solventado
  DELETE /api/leads/{id}/caso/comprobante/{cid}   (admin / backoffice)
"""
import asyncio
import re
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text

import casos
import realtime
from database_mysql import AsyncSessionLocal
from deps import current_user
from routers.leads import (
    _find_id, _is_admin_or_bo, _is_agent, _is_supervisor, _mercado_restrict,
    _log_activity, _utcnow,
)

router = APIRouter(tags=["Semáforo de clientes"])

_CASO_MAX = 2000
_NOTA_MAX = 1000

# Solo archivos subidos al propio CRM (/api/files/upload): imágenes en BD o
# audio/documentos en /uploads/files. Nada de URLs externas ni javascript:.
_URL_COMPROBANTE = re.compile(r"^(/api/files/\d+(/image)?|/uploads/files/[A-Za-z0-9._\- ]+)$")
_EXT_AUDIO = (".mp3", ".wav", ".ogg", ".m4a", ".aac", ".opus", ".webm")


def _tipo_comprobante(url: str, tipo: str) -> str:
    t = str(tipo or "").lower()
    if t in ("imagen", "audio", "documento"):
        return t
    u = url.lower()
    if u.startswith("/api/files/"):
        return "imagen"
    if u.endswith(_EXT_AUDIO):
        return "audio"
    return "documento"


def _es_dueno(row: dict, user: dict) -> bool:
    propios = {str(row.get(k) or "").strip().lower() for k in ("agente_nombre", "agente", "created_by")}
    yo = {str(user.get("username") or "").strip().lower(), str(user.get("name") or "").strip().lower()}
    propios.discard("")
    yo.discard("")
    return bool(propios & yo)


async def _lead_visible(s, lead_id: str, user: dict) -> dict:
    """El lead si el usuario puede verlo (misma frontera que GET /api/leads/{id});
    si no, 404 para no confirmar que el id existe."""
    mysql_id, mongo_id = _find_id(lead_id)
    r = await s.execute(text("SELECT * FROM leads WHERE id = :id OR mongo_id = :mid LIMIT 1"),
                        {"id": mysql_id or 0, "mid": mongo_id or ""})
    row = r.mappings().first()
    if not row:
        raise HTTPException(404, "Lead no encontrado")
    row = dict(row)
    restr = await _mercado_restrict(user)
    if restr and str(row.get("mercado") or "").strip().upper() != restr:
        raise HTTPException(404, "Lead no encontrado")
    amb = casos.ambito(user)
    if amb == "agente" and not _es_dueno(row, user):
        raise HTTPException(404, "Lead no encontrado")
    if amb == "supervisor":
        sql, p = await casos.filtro_ambito(s, user)
        ok = await s.execute(text(
            f"SELECT 1 FROM (SELECT supervisor, {casos.SQL_EQUIPO} AS equipo FROM leads WHERE id = :id) t WHERE {sql}"),
            {"id": row["id"], **p})
        if ok.first() is None:
            raise HTTPException(404, "Lead no encontrado")
    return row


def _servicio(row: dict) -> str:
    import json
    v = row.get("servicios")
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except (ValueError, TypeError):
            pass
    if isinstance(v, list):
        return ", ".join(str(x) for x in v if x)
    return str(v or row.get("tipo_servicio") or "")


def _item(row: dict, ahora, n_comp: int = 0) -> dict:
    c = casos.clasificar(row.get("caso_estado"), row.get("fecha_completed"), row.get("caso_creado_at"), ahora)
    ini = casos.inicio_reloj(row.get("fecha_completed"), row.get("caso_creado_at"))
    return {
        "id": str(row.get("id")),
        "nombre_cliente": row.get("nombre_cliente") or "",
        "telefono": row.get("telefono_principal") or row.get("telefono") or "",
        "agente": row.get("agente_nombre") or row.get("agente") or row.get("created_by") or "",
        "supervisor": row.get("supervisor") or "",
        "servicio": _servicio(row),
        "status": row.get("status") or "",
        "dia_venta": str(row["dia_venta"]) if row.get("dia_venta") else "",
        "dia_instalacion": str(row["dia_instalacion"]) if row.get("dia_instalacion") else "",
        "inicio_reloj": ini.isoformat() if ini else None,
        "caso_solventar": row.get("caso_solventar") or "",
        "caso_estado": row.get("caso_estado") or "",
        "caso_solventado_at": str(row["caso_solventado_at"]) if row.get("caso_solventado_at") else None,
        "caso_vencido_at": str(row["caso_vencido_at"]) if row.get("caso_vencido_at") else None,
        "comprobantes": n_comp,
        **c,
    }


# Revisión perezosa de vencimientos al consultar (además del bucle de main.py),
# como mucho una vez por minuto: así la vista es correcta aunque el bucle no
# corra en esta instancia.
_ultimo_vencimiento = {"ts": 0.0}


async def _vencer_si_toca():
    if time.time() - _ultimo_vencimiento["ts"] < 60:
        return
    _ultimo_vencimiento["ts"] = time.time()
    try:
        await casos.vencer_casos()
    except Exception as e:
        print(f"[semaforo] vencimiento perezoso: {e}")


# ── Listado del semáforo ────────────────────────────────────────────
@router.get("/api/casos/semaforo")
async def semaforo_listado(
    mes: Optional[str] = Query(None, description="AAAA-MM del inicio del reloj; vacío = todos"),
    team: Optional[str] = Query(None, description="solo este team (administración y backoffice)"),
    user: dict = Depends(current_user),
):
    """Clientes del semáforo según el rol: el agente ve los suyos, el supervisor
    los de su team y el resto de roles todos, cada uno con su `equipo`."""
    await _vencer_si_toca()
    where = [casos.SQL_EN_SEMAFORO]
    params: dict = {}
    restr = await _mercado_restrict(user)
    if restr:
        where.append("UPPER(TRIM(COALESCE(mercado,''))) = :mer")
        params["mer"] = restr
    if mes and re.match(r"^\d{4}-\d{2}$", mes):
        where.append(f"DATE_FORMAT({casos.SQL_INICIO_RELOJ}, '%Y-%m') = :mes")
        params["mes"] = mes
    amb = casos.ambito(user)

    async with AsyncSessionLocal() as s:
        inicio = await casos.get_inicio(s)
        params["inicio"] = inicio
        filtro, fparams = await casos.filtro_ambito(s, user)
        params.update(fparams)
        externo = [filtro]
        if team and amb == "todos":
            externo.append("equipo = :team_sel")
            params["team_sel"] = team.strip()
        # Subconsulta: `equipo` es una columna calculada y se filtra fuera.
        r = await s.execute(text(f"""
            SELECT * FROM (
                SELECT id, nombre_cliente, telefono_principal, telefono, agente, agente_nombre, created_by,
                       supervisor, servicios, tipo_servicio, status, dia_venta, dia_instalacion,
                       fecha_completed, caso_solventar, caso_estado, caso_creado_at,
                       caso_solventado_at, caso_vencido_at,
                       {casos.SQL_EQUIPO} AS equipo, {casos.SQL_INICIO_RELOJ} AS _ini
                FROM leads WHERE {' AND '.join(where)}
            ) t
            WHERE {' AND '.join(externo)}
            ORDER BY _ini DESC
            LIMIT 5000
        """), params)
        filas = [dict(x) for x in r.mappings().all()]
        conteo = {}
        if filas:
            from sqlalchemy import bindparam
            rc = await s.execute(text(
                "SELECT lead_id, COUNT(*) n FROM lead_caso_comprobantes WHERE lead_id IN :ids GROUP BY lead_id"
            ).bindparams(bindparam("ids", expanding=True)), {"ids": [str(f["id"]) for f in filas]})
            conteo = {str(x[0]): int(x[1]) for x in rc.fetchall()}

    ahora = _utcnow()
    items = [_item(f, ahora, conteo.get(str(f["id"]), 0)) for f in filas]
    for it, f in zip(items, filas):
        it["equipo"] = f.get("equipo") or "Sin team"
    # Meses con casos, para el selector (del más reciente al más antiguo).
    meses = sorted({(i["inicio_reloj"] or "")[:7] for i in items if i["inicio_reloj"]}, reverse=True)
    return {
        "success": True,
        "inicio": inicio.isoformat(),
        "reglas": {"verde": casos.HORAS_VERDE, "amarillo": casos.HORAS_AMARILLO, "rojo": casos.HORAS_ROJO},
        "meses": meses,
        "ambito": amb,
        "equipos": sorted({i["equipo"] for i in items}),
        "total": len(items),
        "data": items,
    }


# ── Llamadas pendientes del agente (aviso y bloqueo de pantalla) ────
@router.get("/api/casos/pendientes")
async def casos_pendientes(full: Optional[str] = Query(None), user: dict = Depends(current_user)):
    """Llamadas que debe el agente: la del CASO (bloquea desde que el cliente pasa
    a completed) y las de SEGUIMIENTO vencidas (bloquean 3 días después de vencer).
    `bloqueado` = hay alguna que bloquea. Solo agentes: admin, backoffice y
    supervisores no reciben aviso ni bloqueo. Con full=1 devuelve además los
    leads completos (`leads`) para costumer.html?casos=1."""
    if not casos.es_agente(user):
        return {"success": True, "bloqueado": False, "total": 0, "data": [], "leads": []}
    await _vencer_si_toca()
    ahora = _utcnow()
    async with AsyncSessionLocal() as s:
        pend = await casos.llamadas_pendientes(s, user, ahora)
        activo = await casos.bloqueo_activo(s)
    items = []
    for row, info in pend:
        it = _item(row, ahora)
        it.update(info)
        items.append(it)
    # Con el bloqueo apagado la pantalla no se bloquea: solo aviso.
    out = {"success": True, "bloqueo_activo": activo,
           "bloqueado": activo and any(i["bloquea"] for i in items),
           "total": len(items), "data": items}
    if str(full or "").lower() in ("1", "true"):
        from routers.leads import _serialize_lead
        vistos, leads = set(), []
        for row, _ in pend:
            if str(row["id"]) not in vistos:
                vistos.add(str(row["id"]))
                leads.append(_serialize_lead(row))
        out["leads"] = leads
    return out


# ── Caso de un cliente ─────────────────────────────────────────────
async def _comprobantes(s, lead_id) -> list:
    r = await s.execute(text("""
        SELECT id, tipo, url, nombre, nota, created_by, created_at, llamada, numero
        FROM lead_caso_comprobantes WHERE lead_id = :lid ORDER BY created_at ASC, id ASC
    """), {"lid": str(lead_id)})
    out = []
    for x in r.mappings().all():
        d = dict(x)
        d["created_at"] = str(d["created_at"]) if d.get("created_at") else None
        out.append(d)
    return out


@router.get("/api/leads/{lead_id}/caso")
async def caso_de_lead(lead_id: str, user: dict = Depends(current_user)):
    async with AsyncSessionLocal() as s:
        row = await _lead_visible(s, lead_id, user)
        comps = await _comprobantes(s, row["id"])
        inicio = await casos.get_inicio(s)
    item = _item(row, _utcnow(), len(comps))
    ini = casos.inicio_reloj(row.get("fecha_completed"), row.get("caso_creado_at"))
    completado = bool(re.match(r"^(complet|activ)", str(row.get("status") or "").lower()))
    # ¿Corre el reloj? Solo si el caso está pendiente, el lead completado y el
    # reloj arrancó después de activar el semáforo.
    item["en_semaforo"] = (row.get("caso_estado") == "vencido") or bool(
        row.get("caso_estado") in ("pendiente", "solventado") and completado and ini and ini >= inicio)
    item["puede_editar"] = _is_admin_or_bo(user) or _is_supervisor(user) or (
        _es_dueno(row, user) and row.get("caso_estado") in (None, "", "pendiente"))
    item["puede_subir"] = (_is_admin_or_bo(user) or _is_supervisor(user) or _es_dueno(row, user)) and \
        row.get("caso_estado") in ("pendiente", "solventado", "vencido")
    item["puede_borrar"] = _is_admin_or_bo(user)
    prox = casos.proximo_seguimiento(row.get("seg_ultima_llamada_at"), row.get("seg_llamadas"))
    ahora = _utcnow()
    item["seg_llamadas"] = int(row.get("seg_llamadas") or 0)
    item["proximo_seguimiento"] = prox.isoformat() if prox and completado and row.get("caso_estado") == "solventado" else None
    item["seguimiento_vencido"] = bool(item["proximo_seguimiento"] and prox <= ahora)
    item["puede_subir_seguimiento"] = item["seguimiento_vencido"] and (
        _is_admin_or_bo(user) or _is_supervisor(user) or _es_dueno(row, user))
    item["puede_sin_caso"] = _is_admin_or_bo(user)
    return {"success": True, "data": item, "comprobantes_lista": comps}


class CasoBody(BaseModel):
    caso_solventar: Optional[str] = None
    sin_caso: Optional[bool] = None


@router.put("/api/leads/{lead_id}/caso")
async def guardar_caso(lead_id: str, body: CasoBody, user: dict = Depends(current_user)):
    ahora = _utcnow()
    async with AsyncSessionLocal() as s:
        row = await _lead_visible(s, lead_id, user)
        estado = row.get("caso_estado") or None
        es_gestor = _is_admin_or_bo(user) or _is_supervisor(user)
        if not es_gestor and not (_es_dueno(row, user) and estado in (None, "pendiente")):
            raise HTTPException(403, "No puedes modificar el caso de este cliente")

        if body.sin_caso:
            # Quitar un caso pendiente saca al cliente del semáforo: solo gestión.
            if not _is_admin_or_bo(user):
                raise HTTPException(403, "Solo administración o backoffice pueden marcar 'sin caso'")
            if estado in ("solventado", "vencido"):
                raise HTTPException(400, "El caso ya está cerrado; no se puede marcar como 'sin caso'")
            await s.execute(text(
                "UPDATE leads SET caso_estado = 'sin_caso', caso_solventar = NULL, caso_creado_at = NULL, "
                "updated_at = :now, updated_by = :by WHERE id = :id"),
                {"now": ahora, "by": user.get("username", ""), "id": row["id"]})
        else:
            caso = (body.caso_solventar or "").strip()
            if not caso:
                raise HTTPException(400, "Escribe el caso a solventar")
            if len(caso) > _CASO_MAX:
                raise HTTPException(400, f"El caso no puede superar {_CASO_MAX} caracteres")
            if estado in (None, "sin_caso"):
                # Caso nuevo: el reloj arranca ahora (o al completar, lo que sea después).
                await s.execute(text(
                    "UPDATE leads SET caso_solventar = :c, caso_estado = 'pendiente', caso_creado_at = :now, "
                    "updated_at = :now, updated_by = :by WHERE id = :id"),
                    {"c": caso, "now": ahora, "by": user.get("username", ""), "id": row["id"]})
            else:
                # Corregir el texto no reinicia el reloj.
                await s.execute(text(
                    "UPDATE leads SET caso_solventar = :c, updated_at = :now, updated_by = :by WHERE id = :id"),
                    {"c": caso, "now": ahora, "by": user.get("username", ""), "id": row["id"]})
        await s.commit()

    asyncio.create_task(_log_activity(
        "Caso a solventar", row.get("nombre_cliente") or "",
        "Marcado sin caso pendiente" if body.sin_caso else "Caso a solventar actualizado", user))
    await realtime.publish("residencial", {"type": "residencial", "action": "caso"})
    return await caso_de_lead(lead_id, user)


class ComprobanteBody(BaseModel):
    url: str
    tipo: Optional[str] = None
    nombre: Optional[str] = None
    nota: Optional[str] = None


@router.post("/api/leads/{lead_id}/caso/comprobante")
async def subir_comprobante(lead_id: str, body: ComprobanteBody, user: dict = Depends(current_user)):
    url = (body.url or "").strip()
    if not _URL_COMPROBANTE.match(url) or ".." in url:
        raise HTTPException(400, "El comprobante debe subirse al CRM (captura, audio o documento)")
    nota = (body.nota or "").strip()[:_NOTA_MAX]
    nombre = (body.nombre or "").strip()[:255] or url.rsplit("/", 1)[-1]
    tipo = _tipo_comprobante(url, body.tipo)
    ahora = _utcnow()
    autor = user.get("name") or user.get("username") or "sistema"

    async with AsyncSessionLocal() as s:
        row = await _lead_visible(s, lead_id, user)
        if not (_is_admin_or_bo(user) or _is_supervisor(user) or _es_dueno(row, user)):
            raise HTTPException(403, "Solo el agente del cliente o gestión pueden subir el comprobante")
        estado = row.get("caso_estado") or None
        if estado not in ("pendiente", "solventado", "vencido"):
            raise HTTPException(400, "Este cliente no tiene un caso a solventar")
        await s.execute(text("""
            INSERT INTO lead_caso_comprobantes (lead_id, tipo, url, nombre, nota, created_by, created_at, llamada, numero)
            VALUES (:lid, :tipo, :url, :nombre, :nota, :by, :now, 'caso', 1)
        """), {"lid": str(row["id"]), "tipo": tipo, "url": url, "nombre": nombre,
               "nota": nota or None, "by": autor, "now": ahora})
        # Con el primer comprobante el caso queda solventado. Si ya venció (el
        # cliente está en oficina) el comprobante se guarda pero no lo reabre.
        if estado == "pendiente":
            # La llamada del caso es la de verificación: desde ella se cuentan los
            # seguimientos (14 días, 14 días y luego cada 30).
            await s.execute(text(
                "UPDATE leads SET caso_estado = 'solventado', caso_solventado_at = :now, "
                "seg_ultima_llamada_at = :now, seg_llamadas = 0, "
                "updated_at = :now, updated_by = :by WHERE id = :id AND caso_estado = 'pendiente'"),
                {"now": ahora, "by": user.get("username", ""), "id": row["id"]})
        await s.commit()

    asyncio.create_task(_log_activity(
        "Caso solventado" if estado == "pendiente" else "Comprobante de caso",
        row.get("nombre_cliente") or "", f"Comprobante ({tipo}) subido", user))
    await realtime.publish("residencial", {"type": "residencial", "action": "caso"})
    return await caso_de_lead(lead_id, user)


@router.delete("/api/leads/{lead_id}/caso/comprobante/{comp_id}")
async def borrar_comprobante(lead_id: str, comp_id: int, user: dict = Depends(current_user)):
    if not _is_admin_or_bo(user):
        raise HTTPException(403, "Solo administración o backoffice pueden borrar comprobantes")
    async with AsyncSessionLocal() as s:
        row = await _lead_visible(s, lead_id, user)
        r = await s.execute(text("DELETE FROM lead_caso_comprobantes WHERE id = :cid AND lead_id = :lid"),
                            {"cid": comp_id, "lid": str(row["id"])})
        if r.rowcount == 0:
            raise HTTPException(404, "Comprobante no encontrado")
        # Recalcular a partir de lo que quede. Sin comprobante del caso, un caso
        # solventado vuelve a pendiente (su reloj sigue contando desde el inicio,
        # así que puede pasar a otro color) y se anula el ciclo de seguimiento.
        rq = await s.execute(text("""
            SELECT SUM(llamada = 'caso') AS caso, SUM(llamada = 'seguimiento') AS seg,
                   MAX(IF(llamada = 'seguimiento', created_at, NULL)) AS ult_seg
            FROM lead_caso_comprobantes WHERE lead_id = :lid"""), {"lid": str(row["id"])})
        q = rq.mappings().first() or {}
        if row.get("caso_estado") == "solventado":
            if not int(q.get("caso") or 0):
                await s.execute(text(
                    "UPDATE leads SET caso_estado = 'pendiente', caso_solventado_at = NULL, "
                    "seg_ultima_llamada_at = NULL, seg_llamadas = 0 WHERE id = :id"), {"id": row["id"]})
            else:
                await s.execute(text(
                    "UPDATE leads SET seg_llamadas = :n, "
                    "seg_ultima_llamada_at = COALESCE(:ult, caso_solventado_at) WHERE id = :id"),
                    {"n": int(q.get("seg") or 0), "ult": q.get("ult_seg"), "id": row["id"]})
        await s.commit()
    await realtime.publish("residencial", {"type": "residencial", "action": "caso"})
    return await caso_de_lead(lead_id, user)


@router.post("/api/leads/{lead_id}/seguimiento")
async def subir_seguimiento(lead_id: str, body: ComprobanteBody, user: dict = Depends(current_user)):
    """Registra la llamada de seguimiento que toca (captura o audio + nota)."""
    url = (body.url or "").strip()
    if not _URL_COMPROBANTE.match(url) or ".." in url:
        raise HTTPException(400, "La llamada debe subirse al CRM (captura o audio)")
    nota = (body.nota or "").strip()[:_NOTA_MAX]
    nombre = (body.nombre or "").strip()[:255] or url.rsplit("/", 1)[-1]
    tipo = _tipo_comprobante(url, body.tipo)
    ahora = _utcnow()
    autor = user.get("name") or user.get("username") or "sistema"
    async with AsyncSessionLocal() as s:
        row = await _lead_visible(s, lead_id, user)
        if not (_is_admin_or_bo(user) or _is_supervisor(user) or _es_dueno(row, user)):
            raise HTTPException(403, "Solo el agente del cliente o gestión pueden registrar la llamada")
        prox = casos.proximo_seguimiento(row.get("seg_ultima_llamada_at"), row.get("seg_llamadas"))
        completado = bool(re.match(r"^(complet|activ)", str(row.get("status") or "").lower()))
        if row.get("caso_estado") != "solventado" or not completado or not prox:
            raise HTTPException(400, "Este cliente no tiene llamadas de seguimiento")
        if prox > ahora:
            raise HTTPException(400, "Todavía no toca la siguiente llamada de seguimiento")
        numero = int(row.get("seg_llamadas") or 0) + 1
        await s.execute(text("""
            INSERT INTO lead_caso_comprobantes (lead_id, tipo, url, nombre, nota, created_by, created_at, llamada, numero)
            VALUES (:lid, :tipo, :url, :nombre, :nota, :by, :now, 'seguimiento', :num)
        """), {"lid": str(row["id"]), "tipo": tipo, "url": url, "nombre": nombre,
               "nota": nota or None, "by": autor, "now": ahora, "num": numero})
        await s.execute(text(
            "UPDATE leads SET seg_llamadas = :num, seg_ultima_llamada_at = :now, "
            "updated_at = :now, updated_by = :by WHERE id = :id"),
            {"num": numero, "now": ahora, "by": user.get("username", ""), "id": row["id"]})
        await s.commit()
    asyncio.create_task(_log_activity(
        "Llamada de seguimiento", row.get("nombre_cliente") or "",
        f"Seguimiento {numero} registrado ({tipo})", user))
    await realtime.publish("residencial", {"type": "residencial", "action": "caso"})
    return await caso_de_lead(lead_id, user)
