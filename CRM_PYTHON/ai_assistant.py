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


def _system_prompt(user: dict) -> str:
    # Se arma por request (no como constante de módulo) para que la fecha de hoy
    # siempre sea la real — un modelo chico sin esto puede "inventar" un año viejo.
    hoy = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    nombre = user.get("name") or user.get("username") or "usuario"
    username = user.get("username") or ""
    rol = user.get("role") or "sin rol"
    equipo = user.get("team") or "sin equipo asignado"
    # Prompt corto A PROPÓSITO: en la CPU sin GPU donde corre Ollama, el tiempo de
    # "leer" este prompt (prefill) antes de poder generar nada ya se come buena parte
    # del timeout — un prompt largo puede hacer que hasta una pregunta simple exceda el
    # límite. Cada regla de acá abajo viene de un bug real encontrado con QA (ver
    # docs/MANTENIMIENTO_2026-07-25.md secc. 2.5) — no acortar sin cuidado.
    return f"""Asistente de datos del CRM Connecting. Español, breve. Hoy: {hoy}.

Quién pregunta (para "yo"/"mi equipo"/"mi puntaje" — siempre esta persona):
{nombre} ({username}) · rol {rol} · equipo {equipo}

Reglas:
1. Todo número (ventas, ranking, puntaje, productividad) sale de una herramienta. Nunca \
inventes ni calcules de memoria.
2. Cada herramienta devuelve "resumen" ya redactado con el número exacto — copialo o \
adaptalo apenas, nunca lo recalculés/redondeés vos. Si el dato pedido no está en el \
resultado, decí que no lo tenés — prohibido inventarlo.
3. El mercado del resultado (ej. "por_mercado") es el que el usuario SÍ puede ver — usá \
ese nombre, nunca el que pidió. Si pidió otro mercado restringido, aclará que no tiene \
permiso y mostrá el que sí puede ver; nunca ofrezcas conseguirlo después.
4. Si falta el mes o equipo para elegir bien los parámetros, preguntalo antes de inventar.
5. Facturación/Comisiones son solo admin — si la herramienta devuelve error:sin_permiso, \
decilo con naturalidad, sin inventar número ni sugerir otra vía.
6. "Mis ventas"/"mi puntaje" → consultar_mis_ventas (ya filtra por esta persona). Su \
posición en el ranking general → consultar_ranking con agente={nombre}.
"""

# Descripciones cortas A PROPÓSITO — ver nota de _system_prompt sobre tiempo de prefill
# en CPU sin GPU. Cada palabra de más acá se paga en segundos en cada pregunta.
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "consultar_leads",
            "description": "Cuenta leads/ventas por status y mercado en un mes. Ej.: '¿cuántas ventas hay este mes?', '¿cuántas pendientes/canceladas?'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {"type": "string", "description": "YYYY-MM. Si se omite, mes actual."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_mis_ventas",
            "description": "SOLO las ventas propias de quien pregunta (no todo el CRM) en un mes. Ej.: '¿cuántas ventas tengo?', '¿cómo voy?', 'mi puntaje'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month": {"type": "string", "description": "YYYY-MM. Si se omite, mes actual."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_ranking",
            "description": "Ranking de agentes por ventas en un mes (default: actual). Ej.: '¿quién vendió más?', 'ranking'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "month":  {"type": "string", "description": "YYYY-MM. Opcional."},
                    "agente": {"type": "string", "description": "Filtra por nombre (parcial). Opcional."},
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_productividad_equipos",
            "description": "Ventas y puntaje por equipo (del mes o del día), por mercado. Ej.: '¿cómo va mi equipo?', 'puntaje de tal equipo'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "scope": {
                        "type": "string", "enum": ["month", "day"],
                        "description": "'month' (default) o 'day' (solo hoy).",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_empleado_del_mes",
            "description": "Empleado del mes (y segundo puesto). Cualquier rol.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_premios_activos",
            "description": "Premios/promociones activas y últimos ganadores. Cualquier rol.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_permisos_activos",
            "description": "Catálogo de permisos del CRM y cuáles están activos (no quién los tiene). Cualquier rol.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_facturacion",
            "description": "Total facturado del mes/año actual. SOLO administradores.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "consultar_comisiones",
            "description": "Ventas y puntos de comisión por equipo, mes actual. SOLO administradores/backoffice.",
            "parameters": {"type": "object", "properties": {}},
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


async def _tool_consultar_mis_ventas(args: dict, user: dict) -> dict:
    """Ventas propias del usuario que pregunta (filtra por su propio agente_nombre/
    agente/created_by) — mismo criterio que ya usa leads.py para 'un agente ve solo lo
    suyo', pero expuesto como tool explícita en vez de depender del modo stats (que
    devuelve datos globales, no propios)."""
    from database_mysql import AsyncSessionLocal
    from sqlalchemy import text
    username = user.get("username") or ""
    month = (args or {}).get("month") or datetime.now(timezone.utc).strftime("%Y-%m")
    if not username:
        return {"resumen": "No pude identificar tu usuario para buscar tus ventas propias.", "total": 0}

    from permissions import resolve_market_restriction
    mercado_restrict = await resolve_market_restriction(user)
    where = ["(agente_nombre = :u OR agente = :u OR created_by = :u)",
             "(DATE_FORMAT(dia_venta,'%Y-%m') = :ym OR (dia_venta IS NULL AND DATE_FORMAT(created_at,'%Y-%m') = :ym))"]
    params = {"u": username, "ym": month}
    if mercado_restrict:
        where.append("UPPER(TRIM(COALESCE(mercado,''))) = :mer")
        params["mer"] = mercado_restrict

    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT UPPER(TRIM(COALESCE(status,''))) AS status, COALESCE(puntaje,0) AS puntaje
            FROM leads WHERE {' AND '.join(where)}
        """), params)
        rows = r.mappings().all()

    total = len(rows)
    puntaje_total = sum(float(row["puntaje"] or 0) for row in rows)
    por_status: dict = {}
    for row in rows:
        st = row["status"] or "SIN STATUS"
        por_status[st] = por_status.get(st, 0) + 1
    status_txt = ", ".join(f"{k.lower()}: {v}" for k, v in sorted(por_status.items(), key=lambda kv: -kv[1]))
    resumen = (
        f"EXACTO — Tus ventas propias ({username}) de {month}: {total} en total, "
        f"puntaje acumulado {round(puntaje_total, 2)}. Por status: {status_txt or 'sin datos'}."
    )
    return {"resumen": resumen, "mes": month, "total": total, "puntaje": round(puntaje_total, 2), "por_status": por_status}


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
            # puntos_ventas (no "puntos"/sumPuntaje): la página de Ranking muestra el
            # puntaje SIN el bonus de colchón por defecto (el toggle "Sumar Colchón"
            # está apagado a menos que el usuario lo active) — "puntos" ya lo incluye
            # sumado y da un número mayor al que se ve en pantalla.
            "puntaje":  round(float(r.get("puntos_ventas") or 0), 2),
            "posicion": r.get("position"),
        }
        for r in ranking
    ]
    nota = await _market_restriction_note(user)
    if items:
        top = ", ".join(
            f"{it['posicion']}° {it['agente']} ({it['equipo']}) con {it['ventas']} ventas y {it['puntaje']} puntos"
            for it in items[:5]
        )
        resumen = f"{nota}El ranking EXACTO de {month or 'este mes'}, de mayor a menor (ventas y puntaje): {top}."
    else:
        resumen = f"{nota}No hay datos de ranking para {month or 'este mes'}."
    return {"resumen": resumen, "ranking": items}


async def _tool_consultar_productividad_equipos(args: dict, user: dict) -> dict:
    """OJO: NO usa routers/equipo.py (equipo_estadisticas) — ese endpoint aplica reglas
    de status distintas (excluye HOLD/reserva/reprogramado además de cancelado) y NO es
    lo que alimenta la tabla "Ventas Mensuales por Equipo" que ve el usuario en
    residencial/estadisticas.html. Esa tabla se arma en el frontend directo desde
    /api/leads/bootstrap con un filtro simple (no cancelado + mes actual) — replicado acá
    para que la IA diga el MISMO número que ve la persona en pantalla, no uno distinto
    calculado con otra regla de negocio."""
    from routers.leads import _leads_bootstrap_core
    scope = (args or {}).get("scope") or "month"
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    hoy = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    data = await _leads_bootstrap_core(month=month, stats="1", user=user)
    leads = data.get("leads") or []

    grupos: dict = {}
    for lead in leads:
        dia_venta = str(lead.get("dia_venta") or "")
        if dia_venta[:7] != month:
            continue
        if str(lead.get("status") or "").strip().lower() == "cancelled":
            continue
        if scope == "day" and dia_venta[:10] != hoy:
            continue
        team = (lead.get("team") or lead.get("supervisor") or "SIN EQUIPO").strip().upper() or "SIN EQUIPO"
        g = grupos.setdefault(team, {"TEAM": team, "Total": 0, "Puntaje": 0.0, "ICON": 0, "BAMO": 0})
        g["Total"] += 1
        g["Puntaje"] += float(lead.get("puntaje") or 0)
        mercado = str(lead.get("mercado") or "").upper()
        if "ICON" in mercado:
            g["ICON"] += 1
        if "BAMO" in mercado:
            g["BAMO"] += 1

    equipos = sorted(grupos.values(), key=lambda g: -g["Total"])
    for g in equipos:
        g["Puntaje"] = round(g["Puntaje"], 2)

    periodo = "hoy" if scope == "day" else "este mes"
    nota = await _market_restriction_note(user)
    if equipos:
        top = ", ".join(
            f"{e['TEAM']} → ventas: {e['Total']}, puntaje: {e['Puntaje']}, ICON: {e['ICON']}, BAMO: {e['BAMO']}"
            for e in equipos[:8]
        )
        resumen = f"{nota}Productividad EXACTA por equipo de {periodo} (usá estos números tal cual, incluido el puntaje): {top}."
    else:
        resumen = f"{nota}No hay datos de productividad por equipo para {periodo}."
    return {"resumen": resumen, "scope": scope, "equipos": equipos}


async def _tool_consultar_empleado_del_mes(args: dict, user: dict) -> dict:
    from database_mysql import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            "SELECT employee, name, description, period_date FROM employees_month ORDER BY updated_at DESC"
        ))
        rows = [dict(x) for x in r.mappings().all()]
    if not rows:
        return {"resumen": "No hay ningún empleado del mes cargado todavía.", "empleados": []}
    partes = []
    for row in rows:
        etiqueta = "Empleado del mes" if row.get("employee") == "first" else "Segundo puesto"
        desc = f" — {row['description']}" if row.get("description") else ""
        partes.append(f"{etiqueta}: {row.get('name') or 'sin nombre'}{desc}")
    resumen = "EXACTO — " + "; ".join(partes) + "."
    return {"resumen": resumen, "empleados": rows}


async def _tool_consultar_premios_activos(args: dict, user: dict) -> dict:
    from database_mysql import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as s:
        r1 = await s.execute(text(
            "SELECT tipo, titulo, descripcion, categoria, monto FROM premios_activos ORDER BY created_at ASC"
        ))
        activos = [dict(x) for x in r1.mappings().all()]
        r2 = await s.execute(text(
            "SELECT nombre, tipo, monto, categoria, fecha, status FROM premios_ganadores ORDER BY created_at DESC LIMIT 10"
        ))
        ganadores = [dict(x) for x in r2.mappings().all()]
    partes = []
    if activos:
        partes.append("Premios/promociones activas: " + "; ".join(
            f"{p['titulo']} ({p['categoria']}, monto {p['monto']})" for p in activos))
    else:
        partes.append("No hay premios/promociones activas cargadas.")
    if ganadores:
        partes.append("Últimos ganadores: " + "; ".join(
            f"{g['nombre']} ({g['tipo']}, monto {g['monto']})" for g in ganadores[:5]))
    resumen = "EXACTO — " + " ".join(partes)
    return {"resumen": resumen, "activos": activos, "ganadores": ganadores}


async def _tool_consultar_permisos_activos(args: dict, user: dict) -> dict:
    from database_mysql import AsyncSessionLocal
    from sqlalchemy import text
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(
            "SELECT label, description, group_name, enforced FROM permission_definitions "
            "WHERE active = 1 ORDER BY group_name, label"
        ))
        rows = [dict(x) for x in r.mappings().all()]
    if not rows:
        return {"resumen": "No hay permisos activos en el catálogo.", "permisos": []}
    grupos: dict = {}
    for p in rows:
        grupos.setdefault(p["group_name"] or "General", []).append(p["label"])
    resumen_grupos = "; ".join(f"{g} ({len(labels)}: {', '.join(labels)})" for g, labels in grupos.items())
    resumen = (
        f"EXACTO — Hay {len(rows)} permisos activos en el CRM, agrupados así: {resumen_grupos}. "
        f"Si preguntan por uno puntual, buscalo en esta lista en vez de listarlos todos de nuevo."
    )
    return {"resumen": resumen, "permisos": rows}


async def _tool_consultar_facturacion(args: dict, user: dict) -> dict:
    from deps import ADMIN_ROLES
    if user.get("role") not in ADMIN_ROLES:
        return {"error": "sin_permiso", "resumen": "No tenés permiso para ver datos de Facturación (solo administradores)."}
    from routers.facturacion import _campos_from_row, _to_number
    from database_mysql import AsyncSessionLocal
    from sqlalchemy import text
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as s:
        r = await s.execute(text("SELECT campos FROM facturacion WHERE anio = :y AND mes = :m"), {"y": now.year, "m": now.month})
        rows = r.mappings().all()
    total_mes = sum(_to_number(_campos_from_row(row)[12]) for row in rows)
    resumen = f"EXACTO — El total facturado en {now.year}-{now.month:02d} es {round(total_mes, 2)}."
    return {"resumen": resumen, "anio": now.year, "mes": now.month, "total": round(total_mes, 2)}


async def _tool_consultar_comisiones(args: dict, user: dict) -> dict:
    import unicodedata
    r_role = unicodedata.normalize("NFD", str(user.get("role") or "")).encode("ascii", "ignore").decode().lower()
    is_admin_or_bo = ("admin" in r_role or "backoffice" in r_role or "rol_icon" in r_role
                       or "rol_bamo" in r_role or r_role == "icon" or r_role == "bamo")
    if not is_admin_or_bo:
        return {"error": "sin_permiso", "resumen": "No tenés permiso para ver datos de Comisiones (solo administradores/backoffice)."}
    from routers.comisiones_stats import _EFECTIVO_YM, _COMPLETED
    from database_mysql import AsyncSessionLocal
    from sqlalchemy import text
    now = datetime.now(timezone.utc)
    ym = now.strftime("%Y-%m")
    async with AsyncSessionLocal() as s:
        r = await s.execute(text(f"""
            SELECT TRIM(COALESCE(supervisor,'')) AS team, COUNT(*) AS ventas, COALESCE(SUM(puntaje),0) AS pts
            FROM leads
            WHERE {_EFECTIVO_YM} = :ym AND ({_COMPLETED})
            GROUP BY 1 ORDER BY pts DESC
        """), {"ym": ym})
        rows = [dict(x) for x in r.mappings().all()]
    if not rows:
        return {"resumen": f"EXACTO — No hay datos de comisiones para {ym}.", "equipos": []}
    top = ", ".join(f"{row['team'] or 'sin equipo'}: {row['ventas']} ventas, {round(float(row['pts']),2)} puntos" for row in rows)
    resumen = f"EXACTO — Comisiones de {ym} por equipo: {top}."
    return {"resumen": resumen, "mes": ym, "equipos": rows}


TOOL_IMPLS = {
    "consultar_leads":                  _tool_consultar_leads,
    "consultar_mis_ventas":              _tool_consultar_mis_ventas,
    "consultar_ranking":                _tool_consultar_ranking,
    "consultar_productividad_equipos":  _tool_consultar_productividad_equipos,
    "consultar_empleado_del_mes":       _tool_consultar_empleado_del_mes,
    "consultar_premios_activos":        _tool_consultar_premios_activos,
    "consultar_permisos_activos":       _tool_consultar_permisos_activos,
    "consultar_facturacion":            _tool_consultar_facturacion,
    "consultar_comisiones":             _tool_consultar_comisiones,
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
    # keep_alive largo: evita que Ollama descargue el modelo de RAM entre preguntas
    # (una recarga en frío suma 10-15s extra a la primera respuesta después de un rato
    # sin uso, justo lo que puede empujar un pedido más allá del límite del túnel).
    #
    # num_predict: tope de tokens de salida. OJO — probado y confirmado que Ollama
    # (0.32.3) IGNORA "options.num_predict" cuando el payload también trae "tools": un
    # pedido idéntico sin tools sí respeta el tope (done_reason:"length" a los 50
    # tokens); el mismo pedido CON tools se cuelga igual, sin cortar nunca. Se deja el
    # tope puesto por si una versión futura de Ollama lo empieza a respetar, pero NO hay
    # que confiar en él — la protección real contra un modelo que divaga sin parar (se
    # vio un caso real de >9 minutos, CPU al 200%+ todo ese tiempo) es el timeout de acá
    # abajo: cerrar ESTA conexión obliga a Ollama a abortar la generación en curso.
    payload = {
        "model": AI_MODEL, "messages": messages, "tools": TOOLS, "stream": False,
        "keep_alive": "30m", "options": {"num_predict": 500},
    }
    # Tope real bajo ~100s: el túnel gratuito de cloudflared corta ahí (524) igual, así
    # que no tiene sentido esperar más que eso de nuestro lado — mejor fallar rápido y
    # dejar que el frontend reintente, que quedar con la CPU local trabada generando una
    # respuesta que el usuario ya ni va a recibir. Con qwen2.5:3b-instruct una llamada
    # típica (prompt+tools ~1000 tokens) tarda ~50s — 75s da margen sin acercarse al
    # límite del túnel.
    try:
        async with httpx.AsyncClient(timeout=75) as client:
            resp = await client.post(
                f"{AI_GATEWAY_URL}/api/chat",
                json=payload,
                headers={"Authorization": f"Bearer {AI_GATEWAY_TOKEN}"},
            )
    except httpx.TimeoutException:
        raise AIAssistantError("El asistente tardó demasiado en responder. Probá de nuevo o hacé la pregunta más simple.")
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
    messages = [{"role": "system", "content": _system_prompt(user)}]
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
