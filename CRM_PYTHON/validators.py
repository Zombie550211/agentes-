"""
Validadores compartidos por los modelos Pydantic de los routers.
"""
import re
from typing import Annotated

from pydantic import AfterValidator

# imagen_url se pinta en el frontend dentro de src="…" y de onclick="…('…')". Un
# valor con comillas, <, > o \ escapa de esos contextos y ejecuta código en el
# navegador de quien abra la ficha (XSS almacenado): cualquier agente puede
# guardarlo llamando a la API directamente, sin pasar por el formulario.
#
# Los valores legítimos son de tres formas y ninguna lleva esos caracteres:
#   https://res.cloudinary.com/…   /uploads/…   /api/files/<id>/image
# Los nombres de archivo subidos sí pueden llevar espacios y paréntesis
# («image (3).png»), por eso no se rechazan.
#
# Es la misma regla que _resolveImgUrl en el frontend, que queda como 2ª capa
# para los valores guardados antes de existir este validador.
_IMG_CARACTERES_PROHIBIDOS = re.compile(r"[\"'<>`\\\x00-\x1f\x7f]")
_IMG_ESQUEMA = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")
_IMG_MAX = 500  # VARCHAR(500) en leads, lineas_clientes y las tablas de llamadas


def validar_imagen_url(v: str) -> str:
    v = v.strip()
    if not v:
        return v
    if len(v) > _IMG_MAX:
        raise ValueError(f"imagen_url supera {_IMG_MAX} caracteres")
    if _IMG_CARACTERES_PROHIBIDOS.search(v) or ".." in v:
        raise ValueError("imagen_url contiene caracteres no permitidos")
    if v.startswith("//"):
        # Relativa al protocolo: cargaría la imagen desde un dominio externo.
        raise ValueError("imagen_url no puede apuntar a otro dominio sin esquema")
    if _IMG_ESQUEMA.match(v) and not v.lower().startswith(("http://", "https://")):
        # javascript:, data:, vbscript:, …
        raise ValueError("imagen_url solo admite http(s) o rutas del propio sitio")
    return v


ImagenUrl = Annotated[str, AfterValidator(validar_imagen_url)]
