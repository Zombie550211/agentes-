"""Hora de El Salvador para todo lo que es «hoy» o «el mes en curso».

El servidor corre en UTC: desde las 6 p. m. de El Salvador, en UTC ya es el día (o el mes)
siguiente. Todo filtro de «mes actual» o «hoy» debe usar ahora_sv(); las marcas de tiempo
que se guardan en la BD siguen en UTC (_utcnow() de cada módulo).
"""
from datetime import datetime
from zoneinfo import ZoneInfo

TZ_SV = ZoneInfo("America/El_Salvador")


def ahora_sv() -> datetime:
    """Fecha y hora actuales de El Salvador, sin zona (naive), como _utcnow()."""
    return datetime.now(TZ_SV).replace(tzinfo=None)
