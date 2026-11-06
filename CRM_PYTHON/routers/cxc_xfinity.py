"""Cantidad de CXC Xfinity (frontend/residencial/estadisticas.html).

Tabla de solo lectura: cuenta los registros del formulario con motivo «CXC Xfinity»,
por día de venta y con el mismo criterio que Ventas por equipo (sin canceladas ni REPRO).
Dos vistas: por team y por agente; la columna Mes suma los días del mes.

Lo que se cargó a mano antes de este cambio sigue en cxc_xfinity_dia y se suma, para
que los totales de esos días no se pierdan. Esa tabla ya no recibe datos nuevos.
"""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text

from database_mysql import AsyncSessionLocal
from deps import current_user, team_seccion
from tiempo_sv import ahora_sv

router = APIRouter(prefix="/api/cxc-xfinity", tags=["CXC Xfinity"])

# Valor del catálogo «motivo» (catalogos.py) que alimenta la tabla.
MOTIVO_CXC = "CXC XFINITY"


def _fecha(valor: str) -> date:
    """Valida YYYY-MM-DD y que no sea un día futuro (hora de El Salvador)."""
    try:
        d = date.fromisoformat(valor or "")
    except ValueError:
        raise HTTPException(400, "Fecha inválida (YYYY-MM-DD)")
    if d > ahora_sv().date():
        raise HTTPException(400, "No se puede usar una fecha futura")
    return d


def _es_agente(role) -> bool:
    x = str(role or "").lower()
    return ("agente" in x or "vendedor" in x) and "supervisor" not in x


def _norm(valor) -> str:
    return " ".join(str(valor or "").replace("_", " ").split()).upper()


@router.get("")
async def obtener(fecha: str, user: dict = Depends(current_user)):
    dia = _fecha(fecha)
    inicio_mes = dia.replace(day=1)
    fin_mes = (inicio_mes + timedelta(days=32)).replace(day=1)
    async with AsyncSessionLocal() as s:
        # Teams de venta de Residencial (los que tienen supervisor), como Ventas por equipo.
        r = await s.execute(text("""
            SELECT TRIM(team) AS team FROM users
            WHERE team IS NOT NULL AND TRIM(team) != ''
            GROUP BY TRIM(team)
            HAVING SUM(LOWER(role) LIKE '%supervisor%') > 0
            ORDER BY team
        """))
        teams = [row["team"] for row in r.mappings().all() if team_seccion(row["team"]) == "residencial"]
        # Agentes activos de Residencial.
        r = await s.execute(text("""
            SELECT id, username, role, TRIM(team) AS team FROM users
            WHERE COALESCE(active, 1) = 1 AND COALESCE(acceso_crm, 1) = 1
              AND team IS NOT NULL AND TRIM(team) != ''
            ORDER BY team, username
        """))
        agentes = [
            {"id": str(row["id"]), "nombre": row["username"] or "", "team": row["team"]}
            for row in r.mappings().all()
            if _es_agente(row["role"]) and team_seccion(row["team"], row["role"]) == "residencial"
               and row["team"] in teams
        ]
        # Todos los usuarios (también inactivos), para ubicar a quien hizo cada registro.
        r = await s.execute(text("SELECT id, username, name, role, TRIM(team) AS team FROM users"))
        usuarios = [dict(row) for row in r.mappings().all()]
        # Registros con el motivo. Mismas exclusiones que Ventas por equipo.
        r = await s.execute(text("""
            SELECT DATE(dia_venta) AS dia, agente, agente_nombre, TRIM(team) AS team, supervisor
            FROM leads
            WHERE dia_venta >= :ini AND dia_venta < :fin
              AND UPPER(TRIM(motivo_llamada)) = :motivo
              AND LOWER(COALESCE(status, '')) != 'cancelled'
              AND LOWER(COALESCE(status, '')) NOT REGEXP 'repro|resched|reagend'
        """), {"ini": inicio_mes, "fin": fin_mes, "motivo": MOTIVO_CXC})
        registros = [dict(row) for row in r.mappings().all()]
        # Lo que se cargó a mano antes de que la tabla fuera automática.
        r = await s.execute(text("""
            SELECT fecha, tipo, clave, nombre, team, cantidad FROM cxc_xfinity_dia
            WHERE fecha >= :ini AND fecha < :fin
        """), {"ini": inicio_mes, "fin": fin_mes})
        manuales = [dict(row) for row in r.mappings().all()]

    por_nombre: dict = {}
    team_de_supervisor: dict = {}
    for u in usuarios:
        for nombre in (u["username"], u["name"]):
            if not _norm(nombre):
                continue
            por_nombre.setdefault(_norm(nombre), u)
            if u["team"] and "supervisor" in str(u["role"] or "").lower():
                team_de_supervisor.setdefault(_norm(nombre), u["team"])
    teams_por_norma = {_norm(t): t for t in teams}

    valores: dict = {}
    mes: dict = {}

    def sumar(fecha_dato, tipo, clave, nombre, team, cantidad):
        k = (tipo, clave)
        fila = mes.setdefault(k, {"tipo": tipo, "clave": clave, "nombre": nombre, "team": team, "total": 0})
        fila["total"] += cantidad
        if fecha_dato == dia:
            v = valores.setdefault(k, {"tipo": tipo, "clave": clave, "nombre": nombre, "team": team, "cantidad": 0})
            v["cantidad"] += cantidad

    for m in manuales:
        sumar(m["fecha"], m["tipo"], m["clave"], m["nombre"], m["team"], int(m["cantidad"] or 0))

    for reg in registros:
        nombre = (reg["agente"] or reg["agente_nombre"] or "").strip() or "Sin agente"
        autor = por_nombre.get(_norm(reg["agente"])) or por_nombre.get(_norm(reg["agente_nombre"]))
        # Team como en Ventas por equipo: el del registro o el de su supervisor;
        # si ninguno es un team de venta, el del agente.
        team = None
        for candidato in (reg["team"], reg["supervisor"]):
            t = team_de_supervisor.get(_norm(candidato)) or candidato
            if _norm(t) in teams_por_norma:
                team = teams_por_norma[_norm(t)]
                break
        team = team or (autor and autor["team"]) or "Sin team"
        sumar(reg["dia"], "team", team, team, team, 1)
        clave_ag = str(autor["id"]) if autor else nombre
        nombre_ag = (autor["username"] if autor else None) or nombre
        team_ag = (autor and autor["team"]) or team
        sumar(reg["dia"], "agente", clave_ag, nombre_ag, team_ag, 1)

    return {
        "success": True,
        "fecha": dia.isoformat(),
        "teams": teams,
        "agentes": agentes,
        "valores": list(valores.values()),
        "mes": list(mes.values()),
    }
