"""Auditor de llamadas (residencial/auditoria.html).

Un servicio de captura (repo aparte: Reintento/auditor/servicio/auditor.py) corre en la PC
donde suena la llamada: graba por separado el micrófono (agente) y los audífonos (cliente),
transcribe cada frase con Whisper en esa misma PC y la manda aquí. El CRM:
- guarda la llamada completa, frase por frase (auditoria_llamadas, auditoria_segmentos);
- revisa cada frase del AGENTE con las reglas R1–R6 (REGLAS) y marca las que rompe
  (auditoria_hallazgos). Solo reporta: nada corta la llamada;
- identifica al agente: el que tiene asignada la estación o, si no, el nombre con que se
  presenta («le habla …») comparado con los usuarios del CRM;
- identifica al cliente: el lead que ese agente tipifica durante la llamada o poco después
  (leads.nombre_cliente) y, mientras tanto, el nombre que dice en la llamada;
- avisa al instante a los auditores por el centro de notificaciones
  ({"type": "auditoria", "llamada": uuid, "falta": bool} en su canal personal).

Por ahora solo lo usan tres administradores (AUDITORES, por id de users): Daniel Martinez,
Kelvin Rodriguez y Roberto Velasquez. Nadie más ve la página ni la API (403), y el agente
no se entera de nada salvo que un hallazgo se convierta en falta de Monitoreo.

Servicio (cabecera X-Api-Key = AUDITOR_SERVICIO_KEY del .env):
- POST /api/auditoria/servicio/llamadas: empieza una llamada.
- POST /api/auditoria/servicio/llamadas/{uuid}/segmentos: una frase transcrita.
- POST /api/auditoria/servicio/llamadas/{uuid}/fin: terminó.
- POST /api/auditoria/servicio/llamadas/{uuid}/audio: la grabación (izquierda agente,
  derecha cliente). Se guarda fuera de /uploads, en datos_privados/auditoria_llamadas.

Panel (solo AUDITORES):
- GET /api/auditoria/llamadas · GET /api/auditoria/llamadas/{uuid}[?desde=<id de frase>]
- PATCH /api/auditoria/llamadas/{uuid}: corregir agente o cliente a mano.
- GET /api/auditoria/llamadas/{uuid}/audio
- GET /api/auditoria/hallazgos · PATCH /api/auditoria/hallazgos/{id}
- POST /api/auditoria/hallazgos/{id}/falta: lo convierte en falta de Monitoreo.

Todo se guarda RETENCION_DIAS días y se purga solo.
"""
import difflib
import hmac
import os
import random
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import text

import audit
import realtime
from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion
from routers.monitoreo import _MAX_POR_DIA, _avisar, _es_agente, _semana
from tiempo_sv import ahora_sv

router = APIRouter(prefix="/api/auditoria", tags=["Auditoría de llamadas"])

# users.id de quienes pueden usar el auditor (los ids son los mismos en local y producción).
AUDITORES = {2, 46, 148}   # Daniel Martinez, Kelvin Rodriguez, ROBERTO VELASQUEZ.

RETENCION_DIAS = 90

AUDIO_DIR = Path(os.environ.get("AUDITORIA_AUDIO_DIR")
                 or Path(__file__).resolve().parent.parent.parent / "datos_privados" / "auditoria_llamadas")
MAX_AUDIO_BYTES = 80 * 1024 * 1024
_EXT_AUDIO = {".ogg": "audio/ogg", ".opus": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav"}

_UUID = r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"

# Reglas de venta. Los patrones van sobre el texto normalizado (minúsculas, sin tildes).
REGLAS = {
    "R1": ("Lenguaje soez", "alta", re.compile(
        r"\b(mierda|puta|puto|pendej\w*|cerot\w*|maldit\w*|cabron\w*|hijueputa|verga|estupid\w*"
        r"|idiota|imbecil|baboso|culer\w*|chinga\w*)\b")),
    "R2": ("Descuento no autorizado", "alta", re.compile(
        r"(le (doy|hago|dejo|aplico) (un )?(descuento|precio especial)|descuento (especial|exclusivo|solo para usted)"
        r"|se lo dejo (en|a) \$?\d+|precio especial para usted|\d+ ?(%|por ciento) de descuento)")),
    "R3": ("Rebaja en la mensualidad", "alta", re.compile(
        r"(bajar|rebajar|reducir|quitar)(le)? (la|su) (mensualidad|cuota|factura)|(mensualidad|cuota) (mas baja|rebajada|reducida)"
        r"|le (quito|rebajo|bajo) \$?\d+ (al mes|de la mensualidad)|le (bajamos|rebajamos|reducimos) (la|su) (mensualidad|cuota)")),
    "R4": ("Promesa de descuento futuro", "alta", re.compile(
        r"(despues de|a los|en|dentro de) (dos|tres|2|3|unos) mes\w*.{0,40}(descuento|rebaja|precio|bajamos|rebajamos|mensualidad)"
        r"|(descuento|rebaja).{0,40}(despues de|a los|dentro de) (dos|tres|2|3) mes")),
    "R5": ("Sorteos o premios", "media", re.compile(
        r"\b(sorteo\w*|rifa\w*|participa\w* (en|por)|ganarse|ganar(a|ia)? un|premio\w*|concurso)\b")),
    "R6": ("No pagar deuda anterior", "alta", re.compile(
        r"(no (tiene|necesita|va a tener) que pagar (la|su|esa)? ?(deuda|saldo|lo que debe))"
        r"|(deuda|saldo pendiente|lo que debe).{0,30}(se borra|se elimina|se olvida|no importa|no se cobra|la perdonamos|queda en cero)")),
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", str(s or "").lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def reglas_rotas(texto: str) -> list[str]:
    n = norm(texto)
    return [rid for rid, (_, _, patron) in REGLAS.items() if patron.search(n)]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Acceso ───────────────────────────────────────────────────────
def es_auditor(user: dict) -> bool:
    try:
        return int(user.get("id")) in AUDITORES
    except (TypeError, ValueError):
        return False


async def solo_auditores(user: dict = Depends(current_user)) -> dict:
    if not es_auditor(user):
        raise HTTPException(403, "Sin permiso")
    return user


def solo_servicio(x_api_key: Optional[str] = Header(None)) -> None:
    esperada = os.getenv("AUDITOR_SERVICIO_KEY", "")
    if not esperada:
        raise HTTPException(503, "Falta AUDITOR_SERVICIO_KEY en el .env del CRM")
    if not x_api_key or not hmac.compare_digest(x_api_key, esperada):
        raise HTTPException(401, "Clave inválida")


async def _avisar_auditores(uuid: str, falta: bool = False) -> None:
    for uid in AUDITORES:
        await realtime.publish(realtime.canal_usuario(uid),
                               {"type": "auditoria", "llamada": uuid, "falta": falta})


# ── Identificación del agente y del cliente ──────────────────────
# «le habla Carlos Méndez de Connecting» → «carlos mendez». Se corta en la primera palabra
# que no es parte de un nombre.
_NO_NOMBRE = {"de", "del", "la", "el", "los", "las", "y", "con", "su", "un", "una", "para", "por", "en",
              "que", "desde", "aqui", "aca", "connecting", "conecting", "senor", "senora", "senorita",
              "don", "dona", "buenas", "buenos", "tardes", "dias", "noches", "hola", "si", "no", "bien",
              "ella", "usted", "quien", "mucho", "gusto", "todo", "asesor", "asesora", "agente",
              "representante", "ejecutivo", "ejecutiva", "servicio", "cliente", "llamando"}
_PRESENTA_AGENTE = re.compile(r"\b(?:le habla|les habla|mi nombre es|me llamo|soy)\s+((?:[a-zñ]+\s*){1,3})")
_PRESENTA_CLIENTE = re.compile(r"\b(?:habla|soy|mi nombre es|me llamo|le habla|con)\s+((?:[a-zñ]+\s*){1,3})")
_TRATO_CLIENTE = re.compile(r"\b(?:senor|senora|senorita|don|dona)\s+((?:[a-zñ]+\s*){1,2})")


def _nombre(fragmento: str) -> str:
    partes = []
    for p in fragmento.split():
        if p in _NO_NOMBRE or len(p) < 2:
            break
        partes.append(p)
    return " ".join(partes[:2])


def nombre_presentado(texto: str, patron=_PRESENTA_AGENTE) -> str:
    for m in patron.finditer(norm(texto)):
        n = _nombre(m.group(1))
        if n:
            return n
    return ""


def _parecido(dicho: str, username: str) -> float:
    a, b = norm(dicho).split(), norm(username).replace(".", " ").split()
    if not a or not b:
        return 0.0
    if len(a) == 1:      # solo dijo el nombre: se compara con el primer nombre
        return difflib.SequenceMatcher(None, a[0], b[0]).ratio()
    return difflib.SequenceMatcher(None, " ".join(a[:2]), " ".join(b[:2])).ratio()


async def _buscar_usuario(s, dicho: str, solo_agentes: bool = True) -> Optional[int]:
    """El usuario activo del CRM cuyo nombre se parece a `dicho`, si hay uno claro.
    solo_agentes=False para el agente asignado a una estación (lo configura quien la instala)."""
    r = await s.execute(text("""
        SELECT id, username, role FROM users
        WHERE COALESCE(active, 1) = 1 AND COALESCE(acceso_crm, 1) = 1
    """))
    puntos = sorted(((_parecido(dicho, u["username"]), u["id"]) for u in r.mappings().all()
                     if not solo_agentes or _es_agente(u["role"]) or "supervisor" in str(u["role"] or "").lower()),
                    reverse=True)
    if not puntos or puntos[0][0] < 0.82:
        return None
    if len(puntos) > 1 and puntos[1][0] > puntos[0][0] - 0.05:
        return None      # dos parecidos: mejor que lo corrija un auditor
    return int(puntos[0][1])


async def _cliente_tipificado(s, llamada: dict) -> Optional[dict]:
    """El lead que el agente de la llamada creó durante ella o hasta 45 min después y que
    no está ya enlazado a otra llamada."""
    if not llamada["agente_id"]:
        return None
    r = await s.execute(text("SELECT username FROM users WHERE id = :id"), {"id": llamada["agente_id"]})
    agente = r.scalar()
    if not agente:
        return None
    fin = llamada["fin"] or _utcnow()
    r = await s.execute(text("""
        SELECT id, nombre_cliente FROM leads
        WHERE (agente = :a OR agente_nombre = :a OR created_by = :a)
          AND created_at BETWEEN :desde AND :hasta
          AND COALESCE(nombre_cliente, '') != ''
          AND id NOT IN (SELECT lead_id FROM auditoria_llamadas
                         WHERE lead_id IS NOT NULL AND id != :yo)
        ORDER BY ABS(TIMESTAMPDIFF(SECOND, created_at, :fin)) LIMIT 1
    """), {"a": agente, "desde": llamada["inicio"] - timedelta(minutes=10),
           "hasta": fin + timedelta(minutes=45), "fin": fin, "yo": llamada["id"]})
    lead = r.mappings().first()
    return dict(lead) if lead else None


async def _intentar_tipificacion(s, llamada: dict) -> bool:
    """Si ya hay lead tipificado, lo enlaza y su cliente reemplaza al de la transcripción."""
    if llamada["lead_id"] or llamada["cliente_fuente"] == "manual":
        return False
    lead = await _cliente_tipificado(s, llamada)
    if not lead:
        return False
    await s.execute(text("""
        UPDATE auditoria_llamadas SET lead_id = :l, cliente = :c, cliente_fuente = 'tipificacion'
        WHERE id = :id
    """), {"l": lead["id"], "c": lead["nombre_cliente"][:200], "id": llamada["id"]})
    return True


# ── Servicio de captura ──────────────────────────────────────────
class LlamadaIn(BaseModel):
    uuid: str = Field(pattern=_UUID)
    estacion: Optional[str] = Field(None, max_length=80)
    agente: Optional[str] = Field(None, max_length=150)   # agente asignado a la estación
    # Segundos desde que empezó la llamada: el servicio la crea aquí con la primera frase ya
    # transcrita, unos segundos después de la primera voz.
    transcurrido: float = Field(0, ge=0, le=3600)


class SegmentoIn(BaseModel):
    canal: Literal["agente", "cliente"]
    t_ini: float = Field(ge=0, le=86400)
    t_fin: float = Field(ge=0, le=86400)
    texto: str = Field(min_length=1, max_length=2000)


async def _llamada(s, uuid: str) -> dict:
    r = await s.execute(text("SELECT * FROM auditoria_llamadas WHERE uuid = :u"), {"u": uuid})
    ll = r.mappings().first()
    if not ll:
        raise HTTPException(404, "Llamada no encontrada")
    return dict(ll)


async def _purgar(s) -> None:
    limite = ahora_sv().date() - timedelta(days=RETENCION_DIAS)
    r = await s.execute(text("SELECT id, audio FROM auditoria_llamadas WHERE fecha < :l"), {"l": limite})
    viejas = r.mappings().all()
    for v in viejas:
        await s.execute(text("DELETE FROM auditoria_segmentos WHERE llamada_id = :i"), {"i": v["id"]})
        await s.execute(text("DELETE FROM auditoria_hallazgos WHERE llamada_id = :i"), {"i": v["id"]})
        await s.execute(text("DELETE FROM auditoria_llamadas WHERE id = :i"), {"i": v["id"]})
        if v["audio"]:
            (AUDIO_DIR / v["audio"]).unlink(missing_ok=True)


@router.post("/servicio/llamadas", dependencies=[Depends(solo_servicio)])
async def servicio_inicio(body: LlamadaIn):
    async with AsyncSessionLocal() as s:
        agente_id = await _buscar_usuario(s, body.agente, solo_agentes=False) if body.agente else None
        await s.execute(text("""
            INSERT IGNORE INTO auditoria_llamadas
                (uuid, estacion, agente_id, agente_detectado, agente_fuente, fecha, inicio)
            VALUES (:u, :e, :a, :d, :f, :fecha, :ini)
        """), {"u": body.uuid, "e": (body.estacion or "").strip() or None, "a": agente_id,
               "d": (body.agente or "").strip() or None, "f": "estacion" if agente_id else None,
               "fecha": ahora_sv().date(), "ini": _utcnow() - timedelta(seconds=body.transcurrido)})
        if random.random() < 0.05:
            await _purgar(s)
        await s.commit()
    await _avisar_auditores(body.uuid)
    return {"success": True, "agente_id": str(agente_id) if agente_id else None}


@router.post("/servicio/llamadas/{uuid}/segmentos", dependencies=[Depends(solo_servicio)])
async def servicio_segmento(uuid: str, body: SegmentoIn):
    texto = " ".join(body.texto.split())[:2000]
    if not texto:
        return {"success": True}
    reglas = reglas_rotas(texto) if body.canal == "agente" else []
    async with AsyncSessionLocal() as s:
        ll = await _llamada(s, uuid)
        r = await s.execute(text("""
            INSERT INTO auditoria_segmentos (llamada_id, canal, t_ini, t_fin, texto, reglas)
            VALUES (:l, :c, :i, :f, :t, :r)
        """), {"l": ll["id"], "c": body.canal, "i": round(body.t_ini, 2),
               "f": round(max(body.t_fin, body.t_ini), 2), "t": texto, "r": ",".join(reglas) or None})
        seg_id = r.lastrowid
        for rid in reglas:
            await s.execute(text("""
                INSERT INTO auditoria_hallazgos (llamada_id, segmento_id, regla, frase, fecha)
                VALUES (:l, :s, :r, :t, :f)
            """), {"l": ll["id"], "s": seg_id, "r": rid, "t": texto, "f": ll["fecha"]})
        if reglas:
            await s.execute(text("UPDATE auditoria_llamadas SET faltas = faltas + :n WHERE id = :id"),
                            {"n": len(reglas), "id": ll["id"]})

        # Quién es quién, con lo que se va diciendo.
        if body.canal == "agente" and not ll["agente_id"]:
            dicho = nombre_presentado(texto)
            if dicho:
                aid = await _buscar_usuario(s, dicho)
                await s.execute(text("""
                    UPDATE auditoria_llamadas SET agente_detectado = :d, agente_id = :a,
                           agente_fuente = IF(:a IS NULL, NULL, 'llamada')
                    WHERE id = :id
                """), {"d": dicho.title(), "a": aid, "id": ll["id"]})
        if not ll["cliente"]:
            if body.canal == "cliente":
                dicho = nombre_presentado(texto, _PRESENTA_CLIENTE)
            else:
                dicho = nombre_presentado(texto, _TRATO_CLIENTE)
            if dicho:
                await s.execute(text("""
                    UPDATE auditoria_llamadas SET cliente = :c, cliente_fuente = 'llamada'
                    WHERE id = :id AND cliente IS NULL
                """), {"c": dicho.title(), "id": ll["id"]})
        await s.commit()

    await _avisar_auditores(uuid, falta=bool(reglas))
    if reglas:
        audit._log("AUDITORIA_HALLAZGO", username="servicio",
                   extra={"llamada": uuid, "agente_id": ll["agente_id"], "reglas": reglas})
    return {"success": True, "reglas": reglas}


@router.post("/servicio/llamadas/{uuid}/fin", dependencies=[Depends(solo_servicio)])
async def servicio_fin(uuid: str):
    async with AsyncSessionLocal() as s:
        ll = await _llamada(s, uuid)
        await s.execute(text("""
            UPDATE auditoria_llamadas SET estado = 'terminada', fin = COALESCE(fin, :f) WHERE id = :id
        """), {"f": _utcnow(), "id": ll["id"]})
        ll = await _llamada(s, uuid)
        await _intentar_tipificacion(s, ll)
        await s.commit()
    await _avisar_auditores(uuid)
    return {"success": True}


@router.post("/servicio/llamadas/{uuid}/audio", dependencies=[Depends(solo_servicio)])
async def servicio_audio(uuid: str, archivo: UploadFile = File(...)):
    ext = Path(archivo.filename or "").suffix.lower()
    if ext not in _EXT_AUDIO:
        raise HTTPException(400, "Formato de audio no permitido")
    datos = await archivo.read(MAX_AUDIO_BYTES + 1)
    if len(datos) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "La grabación es demasiado grande")
    async with AsyncSessionLocal() as s:
        ll = await _llamada(s, uuid)
        AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        nombre = f"{uuid}{ext}"      # uuid validado por el servicio al crear la llamada
        (AUDIO_DIR / nombre).write_bytes(datos)
        await s.execute(text("UPDATE auditoria_llamadas SET audio = :a WHERE id = :id"),
                        {"a": nombre, "id": ll["id"]})
        await s.commit()
    await _avisar_auditores(uuid)
    return {"success": True}


# ── Panel de los auditores ───────────────────────────────────────
def _iso_utc(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() + "Z" if d else None


async def _usuarios(s, ids) -> dict:
    ids = {int(i) for i in ids if i}
    if not ids:
        return {}
    r = await s.execute(text(f"SELECT id, username, TRIM(team) AS team FROM users WHERE id IN ({','.join(map(str, ids))})"))
    return {int(u["id"]): dict(u) for u in r.mappings().all()}


def _llamada_json(ll: dict, usuarios: dict) -> dict:
    u = usuarios.get(int(ll["agente_id"])) if ll["agente_id"] else None
    return {
        "uuid": ll["uuid"], "estacion": ll["estacion"] or "",
        "agente_id": str(ll["agente_id"]) if ll["agente_id"] else None,
        "agente": u["username"] if u else "", "team": (u or {}).get("team") or "",
        "agente_detectado": ll["agente_detectado"] or "", "agente_fuente": ll["agente_fuente"] or "",
        "cliente": ll["cliente"] or "", "cliente_fuente": ll["cliente_fuente"] or "",
        "lead_id": str(ll["lead_id"]) if ll["lead_id"] else None,
        "estado": ll["estado"], "faltas": int(ll["faltas"] or 0), "audio": bool(ll["audio"]),
        "inicio": _iso_utc(ll["inicio"]), "fin": _iso_utc(ll["fin"]),
    }


@router.get("/llamadas")
async def listar_llamadas(dias: int = 1, user: dict = Depends(solo_auditores)):
    dias = max(1, min(dias, RETENCION_DIAS))
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT * FROM auditoria_llamadas WHERE fecha >= :d ORDER BY id DESC LIMIT 300
        """), {"d": ahora_sv().date() - timedelta(days=dias - 1)})
        filas = [dict(f) for f in r.mappings().all()]
        usuarios = await _usuarios(s, [f["agente_id"] for f in filas])
    return {"success": True, "llamadas": [_llamada_json(f, usuarios) for f in filas]}


@router.get("/llamadas/{uuid}")
async def detalle_llamada(uuid: str, desde: int = 0, user: dict = Depends(solo_auditores)):
    async with AsyncSessionLocal() as s:
        ll = await _llamada(s, uuid)
        # La tipificación puede llegar después de colgar: se reintenta al consultar.
        if (ll["estado"] == "terminada" and not ll["lead_id"] and ll["fin"]
                and _utcnow() - ll["fin"] < timedelta(hours=2)):
            if await _intentar_tipificacion(s, ll):
                await s.commit()
                ll = await _llamada(s, uuid)
        r = await s.execute(text("""
            SELECT id, canal, t_ini, t_fin, texto, reglas FROM auditoria_segmentos
            WHERE llamada_id = :l AND id > :d ORDER BY id
        """), {"l": ll["id"], "d": max(0, desde)})
        segmentos = [{"id": str(x["id"]), "canal": x["canal"], "t_ini": float(x["t_ini"]),
                      "t_fin": float(x["t_fin"]), "texto": x["texto"],
                      "reglas": [{"id": rid, "nombre": REGLAS[rid][0], "gravedad": REGLAS[rid][1]}
                                 for rid in (x["reglas"] or "").split(",") if rid in REGLAS]}
                     for x in r.mappings().all()]
        r = await s.execute(text("""
            SELECT id, segmento_id, regla, frase, estado, revisado_por FROM auditoria_hallazgos
            WHERE llamada_id = :l ORDER BY id
        """), {"l": ll["id"]})
        hallazgos = [_hallazgo_json(h) for h in r.mappings().all()]
        usuarios = await _usuarios(s, [ll["agente_id"]])
    return {"success": True, "llamada": _llamada_json(ll, usuarios),
            "segmentos": segmentos, "hallazgos": hallazgos}


class CorreccionIn(BaseModel):
    agente_id: Optional[int] = None
    cliente: Optional[str] = Field(None, max_length=200)


@router.patch("/llamadas/{uuid}")
async def corregir_llamada(uuid: str, body: CorreccionIn, user: dict = Depends(solo_auditores)):
    async with AsyncSessionLocal() as s:
        ll = await _llamada(s, uuid)
        if body.agente_id is not None:
            r = await s.execute(text("SELECT id FROM users WHERE id = :id AND COALESCE(active, 1) = 1"),
                                {"id": body.agente_id})
            if not r.scalar():
                raise HTTPException(404, "Agente no encontrado")
            await s.execute(text("""
                UPDATE auditoria_llamadas SET agente_id = :a, agente_fuente = 'manual' WHERE id = :id
            """), {"a": body.agente_id, "id": ll["id"]})
        if body.cliente is not None:
            await s.execute(text("""
                UPDATE auditoria_llamadas SET cliente = :c, cliente_fuente = 'manual' WHERE id = :id
            """), {"c": body.cliente.strip() or None, "id": ll["id"]})
        await s.commit()
    await _avisar_auditores(uuid)
    return {"success": True}


@router.get("/llamadas/{uuid}/audio")
async def audio_llamada(uuid: str, user: dict = Depends(solo_auditores)):
    async with AsyncSessionLocal() as s:
        ll = await _llamada(s, uuid)
    ruta = AUDIO_DIR / (ll["audio"] or "")
    if not ll["audio"] or not ruta.is_file():
        raise HTTPException(404, "Sin grabación")
    return FileResponse(ruta, media_type=_EXT_AUDIO.get(ruta.suffix, "application/octet-stream"),
                        headers={"Cache-Control": "private, no-store"})


@router.get("/agentes")
async def agentes(user: dict = Depends(solo_auditores)):
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT id, username, role, TRIM(team) AS team FROM users
            WHERE COALESCE(active, 1) = 1 AND COALESCE(acceso_crm, 1) = 1
            ORDER BY username
        """))
        filas = r.mappings().all()
    return {"success": True, "agentes": [
        {"id": str(f["id"]), "username": f["username"], "team": f["team"] or ""}
        for f in filas
        if _es_agente(f["role"]) and team_seccion(f["team"] or "") == "residencial"
    ]}


def _hallazgo_json(h) -> dict:
    regla = REGLAS.get(h["regla"], ("", "media", None))
    return {"id": str(h["id"]), "segmento_id": str(h["segmento_id"]), "regla": h["regla"],
            "detalle": regla[0], "gravedad": regla[1], "frase": h["frase"],
            "estado": h["estado"], "revisado_por": h["revisado_por"] or ""}


@router.get("/hallazgos")
async def listar_hallazgos(dias: int = 1, user: dict = Depends(solo_auditores)):
    dias = max(1, min(dias, RETENCION_DIAS))
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("""
            SELECT h.*, l.uuid, l.agente_id, l.agente_detectado, l.cliente, h.created_at AS hora
            FROM auditoria_hallazgos h JOIN auditoria_llamadas l ON l.id = h.llamada_id
            WHERE h.fecha >= :d ORDER BY h.id DESC LIMIT 500
        """), {"d": ahora_sv().date() - timedelta(days=dias - 1)})
        filas = [dict(f) for f in r.mappings().all()]
        usuarios = await _usuarios(s, [f["agente_id"] for f in filas])
    return {"success": True, "hallazgos": [dict(
        _hallazgo_json(f), llamada=f["uuid"], cliente=f["cliente"] or "", hora=_iso_utc(f["hora"]),
        agente=(usuarios.get(int(f["agente_id"])) or {}).get("username", "") if f["agente_id"]
        else (f["agente_detectado"] or "")) for f in filas]}


class EstadoIn(BaseModel):
    estado: Literal["nuevo", "revisado", "descartado"]


async def _hallazgo(s, hallazgo_id: int) -> dict:
    r = await s.execute(text("""
        SELECT h.*, l.uuid, l.agente_id FROM auditoria_hallazgos h
        JOIN auditoria_llamadas l ON l.id = h.llamada_id WHERE h.id = :id
    """), {"id": hallazgo_id})
    h = r.mappings().first()
    if not h:
        raise HTTPException(404, "Hallazgo no encontrado")
    return dict(h)


@router.patch("/hallazgos/{hallazgo_id}")
async def cambiar_estado(hallazgo_id: int, body: EstadoIn, user: dict = Depends(solo_auditores)):
    por = str(user.get("username") or "")[:150]
    async with AsyncSessionLocal() as s:
        h = await _hallazgo(s, hallazgo_id)
        if h["estado"] == "falta":
            raise HTTPException(400, "Ya es una falta: se quita desde Monitoreo")
        await s.execute(text("""
            UPDATE auditoria_hallazgos SET estado = :e, revisado_por = :por WHERE id = :id
        """), {"e": body.estado, "por": por, "id": hallazgo_id})
        await s.commit()
    await _avisar_auditores(h["uuid"])
    audit._log("AUDITORIA_ESTADO", username=por, extra={"hallazgo": hallazgo_id, "estado": body.estado})
    return {"success": True}


@router.post("/hallazgos/{hallazgo_id}/falta")
async def convertir_en_falta(hallazgo_id: int, user: dict = Depends(solo_auditores)):
    por = str(user.get("username") or "")[:150]
    lunes, domingo, _ = _semana()
    async with AsyncSessionLocal() as s:
        h = await _hallazgo(s, hallazgo_id)
        if h["estado"] == "falta":
            raise HTTPException(400, "Ya es una falta")
        if not h["agente_id"]:
            raise HTTPException(400, "Primero indica quién es el agente de la llamada")
        if not (lunes <= h["fecha"] <= domingo):
            raise HTTPException(400, "Solo se convierten en falta los hallazgos de esta semana")
        r = await s.execute(text("SELECT username, role, TRIM(team) AS team FROM users WHERE id = :id"),
                            {"id": h["agente_id"]})
        agente = r.mappings().first()
        if not agente or not _es_agente(agente["role"]) or team_seccion(agente["team"] or "") != "residencial":
            raise HTTPException(400, "Las faltas de Monitoreo son solo para agentes de Residencial")
        r = await s.execute(text("""
            SELECT COUNT(*) FROM monitoreo_faltas WHERE user_id = :u AND fecha = :f
        """), {"u": h["agente_id"], "f": h["fecha"]})
        if int(r.scalar() or 0) >= _MAX_POR_DIA:
            raise HTTPException(400, f"Máximo {_MAX_POR_DIA} faltas por día")
        nombre = REGLAS.get(h["regla"], ("",))[0]
        nota = f"Auditor {h['regla']} · {nombre}: «{h['frase']}»"[:500]
        r = await s.execute(text("""
            INSERT INTO monitoreo_faltas (user_id, fecha, nota, marcado_por)
            VALUES (:u, :f, :nota, :por)
        """), {"u": h["agente_id"], "f": h["fecha"], "nota": nota, "por": por})
        falta_id = r.lastrowid
        await s.execute(text("""
            UPDATE auditoria_hallazgos SET estado = 'falta', revisado_por = :por, falta_id = :fid
            WHERE id = :id
        """), {"por": por, "fid": falta_id, "id": hallazgo_id})
        await s.commit()

    await _avisar(h["agente_id"])
    await _avisar_auditores(h["uuid"])
    audit._log("MONITOREO_FALTA_AGREGAR", username=por,
               extra={"agente": agente["username"], "fecha": h["fecha"].isoformat(),
                      "nota": nota, "auditoria": hallazgo_id})
    return {"success": True, "falta_id": str(falta_id)}
