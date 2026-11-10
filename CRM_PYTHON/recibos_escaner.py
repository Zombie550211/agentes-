"""Lectura de recibos PDF de Google Ads (ver routers/recibos_google.py).

Extrae el texto de todas las páginas y busca los datos generales del pago: fecha,
Billing ID, método de pago y monto. Está pensado para el recibo de pago de Google Ads
en inglés y en español, pero cada dato se busca por varias etiquetas para tolerar
otros formatos. Referencia (recibo real):

    Payment Receipt
    Payment date Oct 7, 2026
    Billing ID 9187-3693-1348
    Payment method Mastercard • • • • 1023
    Payment amount $500.00

Lo que no encuentre vuelve como None y el usuario lo completa a mano. Los PDF
escaneados como imagen no tienen texto: se devuelve `con_texto=False`.
"""
from __future__ import annotations

import io
import json
import re
import resource
import subprocess
import sys
from datetime import date
from pathlib import Path

from pypdf import PdfReader

MAX_PAGINAS = 20
# Límites del proceso aislado que lee el PDF (ver escanear_aislado).
MEMORIA_MAX_MB = 512

MESES = {
    "jan": 1, "january": 1, "ene": 1, "enero": 1,
    "feb": 2, "february": 2, "febrero": 2,
    "mar": 3, "march": 3, "marzo": 3,
    "apr": 4, "april": 4, "abr": 4, "abril": 4,
    "may": 5, "mayo": 5,
    "jun": 6, "june": 6, "junio": 6,
    "jul": 7, "july": 7, "julio": 7,
    "aug": 8, "august": 8, "ago": 8, "agosto": 8,
    "sep": 9, "sept": 9, "september": 9, "set": 9, "septiembre": 9, "setiembre": 9,
    "oct": 10, "october": 10, "octubre": 10,
    "nov": 11, "november": 11, "noviembre": 11,
    "dec": 12, "december": 12, "dic": 12, "diciembre": 12,
}

# Entre la etiqueta y el valor: separadores y, como mucho, un salto de línea.
_HUECO = r"[\s:\-–]{0,4}(?:[^\n]{0,40}\n)??\s*"

ETIQUETAS_FECHA = r"(?:payment date|date paid|fecha (?:del? )?pago|fecha de cobro)"
ETIQUETAS_BILLING = r"(?:billing id|id de facturaci[oó]n|id\. de facturaci[oó]n)"
ETIQUETAS_METODO = r"(?:payment method|m[eé]todo de pago|forma de pago|medio de pago)"
# De la más específica a la más general: se usa la primera que tenga un monto al lado.
ETIQUETAS_MONTO = (
    "payment amount", "amount paid", "total amount", "total paid",
    "importe del pago", "importe pagado", "importe total", "monto pagado",
    "monto del pago", "total pagado", "amount", "importe", "monto", "total",
)

_FECHA_TEXTO_EN = re.compile(r"([a-záéíóú]{3,10})\.?\s+(\d{1,2}),?\s+(\d{4})", re.I)
_FECHA_TEXTO_ES = re.compile(r"(\d{1,2})\s+(?:de\s+)?([a-záéíóú]{3,10})\.?,?\s+(?:de\s+)?(\d{4})", re.I)
_FECHA_ISO = re.compile(r"(\d{4})-(\d{2})-(\d{2})")
_DINERO = re.compile(r"(?:US\$|USD|\$)\s*([\d.,]+\d)|([\d.,]+\d)\s*(?:USD|US\$)", re.I)
_TARJETA = re.compile(
    r"(visa|mastercard|master card|american express|amex|discover|diners(?: club)?)"
    r"[^\w\n]{0,16}(\d{4})", re.I)


def extraer_texto(contenido: bytes) -> tuple[str, int]:
    """Texto de todas las páginas (hasta MAX_PAGINAS) y cuántas páginas tiene el PDF."""
    lector = PdfReader(io.BytesIO(contenido))
    texto = "\n".join((p.extract_text() or "") for p in lector.pages[:MAX_PAGINAS])
    # Algunos PDF separan grupos de dígitos con caracteres de control (\x00) o con
    # espacios especiales (sin romper, finos…): todo eso pasa a ser un espacio normal.
    texto = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\u00a0\u2000-\u200b\u202f]", " ", texto)
    return re.sub(r"[ \t]+", " ", texto), len(lector.pages)


def _fecha_de(s: str) -> str | None:
    for patron, orden in ((_FECHA_TEXTO_EN, "mda"), (_FECHA_TEXTO_ES, "dma")):
        for m in patron.finditer(s):
            g = m.groups()
            mes_txt, dia, anio = (g[0], g[1], g[2]) if orden == "mda" else (g[1], g[0], g[2])
            mes = MESES.get(mes_txt.lower().rstrip("."))
            if not mes:
                continue
            try:
                return date(int(anio), mes, int(dia)).isoformat()
            except ValueError:
                continue
    m = _FECHA_ISO.search(s)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat()
        except ValueError:
            pass
    return None


def _monto_de(s: str) -> str | None:
    m = _DINERO.search(s)
    if not m:
        return None
    crudo = m[1] or m[2]
    # "1,500.00" (inglés) o "1.500,00" (español): el último separador es el decimal.
    if re.search(r",\d{2}$", crudo):
        crudo = crudo.replace(".", "").replace(",", ".")
    else:
        crudo = crudo.replace(",", "")
    try:
        valor = float(crudo)
    except ValueError:
        return None
    return f"{valor:.2f}" if valor > 0 else None


def _marca(txt: str) -> str:
    t = txt.lower()
    if t in ("amex", "american express"):
        return "American Express"
    if t.startswith("master"):
        return "Mastercard"
    if t.startswith("diners"):
        return "Diners Club"
    return txt.capitalize()


def analizar(texto: str) -> dict:
    datos: dict = {"fecha_pago": None, "billing_id": None, "metodo_pago": None, "monto": None}

    # Fecha: primero junto a su etiqueta; si no, la primera fecha del documento.
    for m in re.finditer(ETIQUETAS_FECHA, texto, re.I):
        datos["fecha_pago"] = _fecha_de(texto[m.end(): m.end() + 80])
        if datos["fecha_pago"]:
            break
    if not datos["fecha_pago"]:
        datos["fecha_pago"] = _fecha_de(texto)

    m = re.search(ETIQUETAS_BILLING + _HUECO + r"(\d{4}-\d{4}-\d{4})", texto, re.I)
    if m:
        datos["billing_id"] = m[1]

    for m in re.finditer(ETIQUETAS_METODO, texto, re.I):
        t = _TARJETA.search(texto[m.end(): m.end() + 120])
        if t:
            datos["metodo_pago"] = f"{_marca(t[1])} •••• {t[2]}"
            break
    if not datos["metodo_pago"]:
        t = _TARJETA.search(texto)
        if t:
            datos["metodo_pago"] = f"{_marca(t[1])} •••• {t[2]}"

    for etiqueta in ETIQUETAS_MONTO:
        for m in re.finditer(r"\b" + etiqueta + r"\b", texto, re.I):
            monto = _monto_de(texto[m.end(): m.end() + 60])
            if monto:
                datos["monto"] = monto
                break
        if datos["monto"]:
            break
    if not datos["monto"]:
        datos["monto"] = _monto_de(texto)

    return datos


def escanear(contenido: bytes) -> dict:
    """Datos del pago + `con_texto` (False si el PDF es una imagen) + `paginas`."""
    texto, paginas = extraer_texto(contenido)
    con_texto = len(texto.strip()) >= 20
    datos = analizar(texto) if con_texto else {
        "fecha_pago": None, "billing_id": None, "metodo_pago": None, "monto": None}
    datos["con_texto"] = con_texto
    datos["paginas"] = paginas
    return datos


# ── Lectura aislada ──────────────────────────────────────────────
# Un PDF malicioso puede dejar a pypdf en un bucle infinito o hacerle gastar memoria
# sin límite (pasó con 10 CVE de pypdf 6.21.1). asyncio.wait_for no basta: corta la
# espera, pero el hilo sigue girando dentro del backend (un solo worker) y se come la
# CPU o la RAM del EC2. Por eso el PDF se lee en un proceso aparte (este mismo archivo
# ejecutado con -I), con tope de memoria y de CPU, que se mata si pasa del tiempo.
# Así un fallo futuro de pypdf no puede tumbar el CRM.

def escanear_aislado(contenido: bytes, timeout: float = 20, memoria_mb: int = MEMORIA_MAX_MB) -> dict:
    """Como escanear(), pero en un proceso aparte que se mata al pasar `timeout` segundos.

    Lanza TimeoutError si no termina a tiempo y ValueError si el PDF no se pudo leer.
    Es bloqueante: desde código async llamarlo con asyncio.to_thread."""
    try:
        r = subprocess.run(
            [sys.executable, "-I", str(Path(__file__).resolve()), str(memoria_mb), str(int(timeout) + 1)],
            input=contenido, capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:   # subprocess.run ya mató al hijo
        raise TimeoutError("el PDF tardó demasiado en leerse")
    if r.returncode != 0:
        raise ValueError("el PDF no se pudo leer")
    try:
        datos = json.loads(r.stdout)
    except ValueError:
        raise ValueError("el PDF no se pudo leer")
    if "error" in datos:
        raise ValueError(f"el PDF no se pudo leer ({datos['error']})")
    return datos


if __name__ == "__main__":
    # Proceso hijo de escanear_aislado: PDF por stdin, JSON por stdout.
    _lim = int(sys.argv[1]) * 1024 * 1024
    resource.setrlimit(resource.RLIMIT_AS, (_lim, _lim))
    resource.setrlimit(resource.RLIMIT_CPU, (int(sys.argv[2]), int(sys.argv[2])))
    try:
        _salida = escanear(sys.stdin.buffer.read())
    except MemoryError:
        _salida = {"error": "memoria"}
    except Exception as _e:  # PDF dañado, cifrado, etc.
        _salida = {"error": type(_e).__name__}
    sys.stdout.write(json.dumps(_salida))
