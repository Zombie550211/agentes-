"""
Asistente de IA del CRM — solo lectura (v1).

Arquitectura clave: las "tools" que puede llamar el modelo NO consultan la base de
datos directamente — llaman EN PROCESO a la misma lógica que ya usan los endpoints
existentes (routers/leads.py, routers/ranking.py, routers/equipo.py), pasándoles el
`user` real de la sesión. Así heredan automáticamente todos los filtros de permiso ya
probados (rol, agente propio, resolve_market_restriction) sin reimplementar nada.

El modelo corre en Ollama LOCAL (no Claude/OpenAI/Gemini — decisión explícita del
usuario: sin costo por token, los datos del CRM no salen hacia un tercero). Como Ollama
no tiene autenticación propia y el CRM corre en Render, se llama a través de un gateway
con token (scripts/ollama_gateway.py) expuesto por un túnel — nunca directo.
"""
import os
import json
import httpx
from datetime import datetime, timezone

AI_GATEWAY_URL   = os.getenv("AI_GATEWAY_URL", "").rstrip("/")
AI_GATEWAY_TOKEN = os.getenv("AI_GATEWAY_TOKEN", "")
AI_MODEL         = os.getenv("AI_MODEL", "qwen2.5:7b-instruct")

MAX_TOOL_ROUNDS = 5  # tope de vueltas de tool-calling, evita loops infinitos


def _system_prompt() -> str:
    # Se arma por request (no como constante de módulo) para que la fecha de hoy
    # siempre sea la real — un modelo chico sin esto puede "inventar" un año viejo.
    hoy = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return f"""Sos el asistente de datos del CRM Connecting. Respondés siempre en \
español, de forma breve y concreta. La fecha de hoy es {hoy}.

Reglas estrictas:
1. Para CUALQUIER número o dato (ventas, totales, ranking, productividad, etc.) SIEMPRE \
tenés que usar una de las herramientas disponibles. Nunca inventes ni calcules de memoria.
2. Cada herramienta te devuelve un campo "resumen" con la respuesta YA REDACTADA en \
español con los números exactos. SIEMPRE basá tu respuesta en ese texto — copialo o \
adaptalo apenas al tono de la pregunta, pero NUNCA vuelvas a calcular, redondear ni \
reinterpretar los números vos mismo a partir de los otros campos del JSON. Si "resumen" \
dice que el total es 3198, tu respuesta tiene que decir 3198, ni un número distinto.
3. Las herramientas ya filtran los datos según los permisos del usuario que pregunta \
(equipo, mercado asignado, rol). El campo "por_mercado" (o similar) del resultado \
siempre refleja el mercado REAL que el usuario tiene permiso de ver — usá ESE nombre \
de mercado en tu respuesta, NUNCA el nombre de mercado que haya usado el usuario en su \
pregunta. Si preguntan por un mercado (ej. ICON) y el resultado solo trae otro (ej. \
BAMO), NO digas que esos números son de ICON: aclarale que no tiene permiso para ver \
ICON y que los datos que sí puede ver son de BAMO (usando el nombre real del campo). \
Esa restricción es del usuario, no del momento: NUNCA ofrezcas "conseguir" o "mostrar \
después" el dato del mercado restringido, porque no vas a poder dárselo tampoco la \
próxima vez.
4. Si falta contexto para elegir bien los parámetros de una herramienta (qué mes, qué \
equipo), preguntalo antes de inventar un valor.
"""

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "consultar_leads",
            "description": (
                "Cuenta y resume leads/ventas por status y mercado en un mes dado. "
                "Usalo para preguntas tipo '¿cuántas ventas hay este mes?' o "
                "'¿cuántas están pendientes/canceladas?'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {
                        "type": "string",
                        "description": "Mes en formato YYYY-MM. Si se omite, usa el mes actual.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_ranking",
            "description": (
                "Devuelve el ranking de agentes por ventas en un mes (por defecto, el mes "
                "en curso). Usalo para '¿quién vendió más?', '¿cuál es el ranking?'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "month":  {"type": "string", "description": "Mes en formato YYYY-MM. Opcional."},
                    "agente": {"type": "string", "description": "Filtra por nombre de agente (coincidencia parcial). Opcional."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_productividad_equipos",
            "description": (
                "Devuelve, por equipo, el total de ventas del mes o del día, desglosado "
                "por mercado. Usalo para '¿cómo va mi equipo?', '¿qué equipo vendió más?'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "scope": {
                        "type": "string",
                        "enum": ["month", "day"],
                        "description": "'month' = mes en curso (default), 'day' = solo hoy.",
                    },
                },
            },
        },
    },
]


async def _market_restriction_note(user: dict) -> str:
    """Si el usuario tiene el permiso 'market:restrict_view' activo, arma una aclaración
    explícita para meter en el 'resumen' de cada tool — así la respuesta final no depende
    de que el modelo infiera solo, a partir de los datos, qué mercado puede ver (un
    modelo chico a veces repite el nombre de mercado que usó el usuario en su pregunta
    en vez del que realmente viene en el resultado)."""
    from permissions import resolve_market_restriction
    restrict = await resolve_market_restriction(user)
    if restrict:
        return f"Tu acceso está limitado al mercado {restrict}: los datos que siguen son únicamente de {restrict}. "
    return ""


async def _tool_consultar_leads(args: dict, user: dict) -> dict:
    from routers.leads import _leads_bootstrap_core
    # Si no se pide un mes puntual, se resuelve el mes actual acá mismo (no se deja
    # month=None): _leads_bootstrap_core, sin mes explícito, devuelve los ÚLTIMOS 3
    # MESES combinados (pensado para la búsqueda de la Lista de Clientes, no para
    # reportes) — eso hacía parecer "inventado" un total que en realidad era correcto
    # pero para un rango distinto al que preguntaban.
    month = (args or {}).get("month") or datetime.now(timezone.utc).strftime("%Y-%m")
    # stats=True: mismo modo "global dentro del mercado permitido" que usa la propia
    # página de Estadísticas para cualquier rol — no expone PII (ver _serialize_lead_stats).
    data = await _leads_bootstrap_core(month=month, stats="1", user=user)
    leads = data.get("leads") or []
    por_status: dict = {}
    por_mercado: dict = {}
    for lead in leads:
        st = str(lead.get("status") or "SIN STATUS").strip().upper()
        mk = str(lead.get("mercado") or "SIN MERCADO").strip().upper()
        por_status[st] = por_status.get(st, 0) + 1
        por_mercado[mk] = por_mercado.get(mk, 0) + 1
    total = len(leads)
    mercados_txt = ", ".join(f"{k}: {v}" for k, v in sorted(por_mercado.items(), key=lambda kv: -kv[1]))
    status_txt = ", ".join(f"{k.lower()}: {v}" for k, v in sorted(por_status.items(), key=lambda kv: -kv[1]))
    nota = await _market_restriction_note(user)
    resumen = (
        f"{nota}El número EXACTO de leads/ventas de {month or 'este mes'} es {total}. "
        f"Por mercado: {mercados_txt or 'sin datos'}. Por status: {status_txt or 'sin datos'}."
    )
    return {
        "resumen": resumen,
        "mes": month or "actual",
        "total_leads": total,
        "por_status": por_status,
        "por_mercado": por_mercado,
    }


async def _tool_consultar_ranking(args: dict, user: dict) -> dict:
    from routers.ranking import _get_ranking_core
    month  = (args or {}).get("month")
    agente = (args or {}).get("agente")
    data = await _get_ranking_core(month=month, agente=agente, limit=15, user=user)
    ranking = data.get("ranking") or []
    items = [
        {
            "agente":   r.get("nombre"),
            "equipo":   r.get("team"),
            "ventas":   r.get("ventas"),
            "posicion": r.get("position"),
        }
        for r in ranking
    ]
    nota = await _market_restriction_note(user)
    if items:
        top = ", ".join(f"{it['posicion']}° {it['agente']} ({it['equipo']}) con {it['ventas']} ventas" for it in items[:5])
        resumen = f"{nota}El ranking EXACTO de {month or 'este mes'}, de mayor a menor: {top}."
    else:
        resumen = f"{nota}No hay datos de ranking para {month or 'este mes'}."
    return {"resumen": resumen, "ranking": items}


async def _tool_consultar_productividad_equipos(args: dict, user: dict) -> dict:
    from routers.equipo import _equipo_estadisticas_core
    scope = (args or {}).get("scope") or "month"
    data = await _equipo_estadisticas_core(scope=scope, user=user)
    equipos = data.get("data") or []
    periodo = "hoy" if scope == "day" else "este mes"
    nota = await _market_restriction_note(user)
    if equipos:
        top = ", ".join(
            f"{e.get('TEAM')} con {e.get('Total')} ventas (ICON: {e.get('ICON')}, BAMO: {e.get('BAMO')})"
            for e in equipos[:8]
        )
        resumen = f"{nota}Productividad EXACTA por equipo de {periodo}: {top}."
    else:
        resumen = f"{nota}No hay datos de productividad por equipo para {periodo}."
    return {"resumen": resumen, "scope": scope, "equipos": equipos}


TOOL_IMPLS = {
    "consultar_leads":                  _tool_consultar_leads,
    "consultar_ranking":                _tool_consultar_ranking,
    "consultar_productividad_equipos":  _tool_consultar_productividad_equipos,
}


class AIAssistantError(Exception):
    """Error operativo (gateway/Ollama no disponible, mal configurado, etc.)."""


def _safe_json_args(v) -> dict:
    if isinstance(v, dict):
        return v
    try:
        parsed = json.loads(v)
        return parsed if isinstance(parsed, dict) else {}
    except (ValueError, TypeError):
        return {}


async def _call_gateway(messages: list) -> dict:
    if not AI_GATEWAY_URL or not AI_GATEWAY_TOKEN:
        raise AIAssistantError("El asistente no está configurado todavía (falta AI_GATEWAY_URL/AI_GATEWAY_TOKEN).")
    payload = {"model": AI_MODEL, "messages": messages, "tools": TOOLS, "stream": False}
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            resp = await client.post(
                f"{AI_GATEWAY_URL}/api/chat",
                json=payload,
                headers={"Authorization": f"Bearer {AI_GATEWAY_TOKEN}"},
            )
    except httpx.RequestError:
        raise AIAssistantError("El asistente no está disponible en este momento (no se pudo contactar al servidor de IA).")
    if resp.status_code != 200:
        raise AIAssistantError(f"El asistente no está disponible en este momento (código {resp.status_code}).")
    try:
        return resp.json()
    except ValueError:
        raise AIAssistantError("El asistente devolvió una respuesta inválida.")


async def ask_stream(message: str, history: list, user: dict):
    """Corre el loop de tool-calling contra Ollama, emitiendo eventos a medida que
    avanza (para SSE): {"type":"tool_start"|"tool_end", "tool": name} mientras consulta
    datos, y un evento final {"type":"answer", "text": ...} o {"type":"error", ...}.

    `user` es el dict del usuario autenticado (mismo shape que Depends(current_user));
    se pasa tal cual a cada tool para que la lógica de permisos ya existente se aplique
    exactamente igual que en un request HTTP normal.
    """
    messages = [{"role": "system", "content": _system_prompt()}]
    for h in (history or [])[-10:]:
        role = h.get("role")
        if role in ("user", "assistant") and h.get("content"):
            messages.append({"role": role, "content": str(h["content"])[:4000]})
    messages.append({"role": "user", "content": message})

    try:
        for _ in range(MAX_TOOL_ROUNDS):
            data = await _call_gateway(messages)
            msg = (data or {}).get("message") or {}
            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                yield {"type": "answer", "text": msg.get("content") or "No pude generar una respuesta."}
                return

            messages.append(msg)
            for call in tool_calls:
                fn = (call.get("function") or {})
                name = fn.get("name")
                args = _safe_json_args(fn.get("arguments") or {})
                yield {"type": "tool_start", "tool": name}
                impl = TOOL_IMPLS.get(name)
                if not impl:
                    result = {"error": f"Herramienta desconocida: {name}"}
                else:
                    try:
                        result = await impl(args, user)
                    except Exception as e:
                        result = {"error": f"No se pudo completar la consulta: {e}"}
                yield {"type": "tool_end", "tool": name}
                messages.append({"role": "tool", "content": json.dumps(result, ensure_ascii=False, default=str)})

        yield {"type": "answer", "text": "No pude completar la consulta (demasiados pasos de análisis)."}
    except AIAssistantError as e:
        yield {"type": "error", "message": str(e)}
