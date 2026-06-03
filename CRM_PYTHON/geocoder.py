"""
Geocodificación asíncrona de direcciones de EE.UU.
Usa el US Census Bureau Geocoding API: gratuito, sin API key, solo EE.UU.
"""
import httpx, asyncio, logging
from database_mysql import AsyncSessionLocal
from sqlalchemy import text

log = logging.getLogger(__name__)

_CENSUS_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"


async def geocode_us_address(address: str) -> tuple[float, float] | None:
    """Convierte una dirección de texto a (lat, lng). Retorna None si falla."""
    if not address or not address.strip():
        return None
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(_CENSUS_URL, params={
                "address":   address.strip(),
                "benchmark": "2020",
                "format":    "json",
            })
            if r.status_code != 200:
                return None
            data = r.json()
            matches = data.get("result", {}).get("addressMatches", [])
            if not matches:
                return None
            coords = matches[0].get("coordinates", {})
            lat = coords.get("y")
            lng = coords.get("x")
            if lat is not None and lng is not None:
                return float(lat), float(lng)
    except Exception as e:
        log.debug("[geocoder] error: %s", e)
    return None


async def geocode_and_save(lead_id: int, address: str) -> None:
    """Geocodifica y guarda lat/lng en la fila del lead. Fire-and-forget."""
    coords = await geocode_us_address(address)
    if not coords:
        return
    try:
        async with AsyncSessionLocal() as s:
            await s.execute(
                text("UPDATE leads SET lat=:lat, lng=:lng WHERE id=:id"),
                {"lat": coords[0], "lng": coords[1], "id": lead_id},
            )
            await s.commit()
    except Exception as e:
        log.warning("[geocoder] no se pudo guardar lead %s: %s", lead_id, e)
