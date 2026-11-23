"""API externa de facturación: llave, validación, mezcla con lo guardado y cálculos."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main
from routers import facturacion_externa as fe
from tiempo_sv import ahora_sv


def _res(**kw):
    """Fila de `facturacion.campos` (20 campos) con valores por índice: _res(c0="10")."""
    f = [""] * 20
    for k, v in kw.items():
        f[int(k[1:])] = v
    return f


def _lin(*vals):
    f = [""] * 9
    f[:len(vals)] = vals
    return f


@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.setenv("FACTURACION_API_KEYS", "llave-buena")
    return TestClient(main.app, raise_server_exceptions=False)


AYER = (ahora_sv().date() - timedelta(days=1)).isoformat()
H = {"X-API-Key": "llave-buena"}


# ── Llave ────────────────────────────────────────────────────────

def test_sin_llaves_configuradas_la_api_esta_apagada(monkeypatch):
    monkeypatch.delenv("FACTURACION_API_KEYS", raising=False)
    with pytest.raises(HTTPException) as e:
        fe.verificar_llave("algo", None)
    assert e.value.status_code == 503


@pytest.mark.parametrize("x_key, auth", [(None, None), ("mala", None), ("", "Bearer mala"), (None, "Basic llave-buena")])
def test_llave_invalida(monkeypatch, x_key, auth):
    monkeypatch.setenv("FACTURACION_API_KEYS", "llave-buena")
    with pytest.raises(HTTPException) as e:
        fe.verificar_llave(x_key, auth)
    assert e.value.status_code == 401


def test_llave_valida_por_cabecera_o_bearer_y_rotacion(monkeypatch):
    monkeypatch.setenv("FACTURACION_API_KEYS", "vieja, nueva")
    fe.verificar_llave("vieja", None)
    fe.verificar_llave(None, "Bearer nueva")


@pytest.mark.parametrize("metodo, ruta", [
    ("GET", "/api/externo/facturacion/resumen"),
    ("POST", "/api/externo/facturacion/residencial"),
    ("POST", "/api/externo/facturacion/lineas"),
])
def test_sin_llave_401_antes_de_validar_el_cuerpo(cliente, metodo, ruta):
    # Cuerpo inválido a propósito: sin llave debe dar 401, no 422 (no revela el formato).
    assert cliente.request(metodo, ruta, json={"x": 1}).status_code == 401
    assert cliente.request(metodo, ruta, json={"x": 1}, headers={"X-API-Key": "mala"}).status_code == 401


def test_la_llave_no_abre_otras_rutas(cliente):
    for url in ("/api/facturacion/2026/11", "/api/leads", "/api/facturacion-lineas-pub/2026/11"):
        assert cliente.get(url, headers=H).status_code in (401, 403)


@pytest.mark.parametrize("ruta, cuerpo", [
    ("residencial", {"fecha": AYER, "publicistas": {"Pepito": {"monto": 1}}}),         # nombre desconocido
    ("residencial", {"fecha": AYER, "publicistas": {"Alexis": {"monto": -5}}}),        # negativo
    ("residencial", {"fecha": AYER, "publicistas": {"Alexis": {"monto": 10, "x": 1}}}), # campo extra
    ("residencial", {"fecha": AYER}),                                                  # sin datos
    ("residencial", {"fecha": "2099-01-01", "publicistas": {"Alexis": {"monto": 1}}}), # futuro
    ("lineas", {"fecha": AYER, "cuentas": {"Líneas Bamo": {"ventas": 1}}}),
    ("lineas", {"fecha": "no-es-fecha", "cuentas": {}}),
])
def test_cuerpos_invalidos_se_rechazan(cliente, ruta, cuerpo):
    r = cliente.post(f"/api/externo/facturacion/{ruta}", json=cuerpo, headers=H)
    assert r.status_code in (400, 422), r.text


# ── Escritura: mezcla y cálculos ─────────────────────────────────

def _body_res(**kw):
    return fe.ResidencialIn(fecha=date(2026, 11, 20), **kw)


def test_residencial_calcula_valores_y_totales_como_la_pagina():
    c = fe.aplicar_residencial([], _body_res(publicistas={
        "Alexis": {"monto": 100, "ventas": 4}, "Tito": {"monto": 50.5, "ventas": 0}}, puntos=5))
    assert c[0] == "100.00" and c[1] == "4" and c[2] == "25.00"   # Alexis: valor = 100/4
    assert c[9] == "50.50" and c[10] == "0" and c[11] == ""       # Tito sin ventas: sin valor
    assert c[12] == "150.50" and c[13] == "4" and c[14] == "37.62"   # 150.50/4 = 37.625, truncado como la página
    assert c[15] == "5" and len(c) == 20


def test_residencial_solo_cambia_lo_enviado():
    guardado = _res(c0="100.00", c1="4", c3="80.00", c4="2", c15="7", c16="x")
    c = fe.aplicar_residencial(guardado, _body_res(publicistas={"Garay Residencial": {"ventas": 4}}))
    assert c[0] == "100.00" and c[1] == "4"           # Alexis intacto
    assert c[3] == "80.00" and c[4] == "4" and c[5] == "20.00"   # Garay: monto intacto, ventas nuevas
    assert c[15] == "7" and c[16] == "x"              # puntos y campo libre intactos
    assert c[12] == "180.00" and c[13] == "8"


def test_lineas_calcula_totales():
    body = fe.LineasIn(fecha=date(2026, 11, 20), cuentas={
        "Líneas Garay": {"ventas": 2, "lineas": 5, "monto": 100}, "Líneas Connecting": {"monto": 20.5}})
    c = fe.aplicar_lineas(_lin("", "", "", "1", "1"), body)
    assert c == ["2", "5", "100", "1", "1", "20.5", "120.5", "3", "6"]


# ── Lectura ──────────────────────────────────────────────────────

def test_resumen_residencial_un_dia():
    r = fe.resumen_residencial([_res(c0="$100.00", c1="4", c9="50", c10="0", c15="5")])
    assert r["monto"] == 150.0 and r["ventas"] == 4 and r["valor_venta"] == 37.5
    assert r["cpa_puntos"] == 30.0
    assert r["por_publicista"]["Tito"]["valor_venta"] is None


def test_armar_resumen_dia_y_acumulado():
    res = {1: _res(c0="10", c1="1"), 5: _res(c0="20", c1="2")}
    out = fe.armar_resumen(date(2026, 11, 5), res, {5: _lin("1", "1", "5")})
    assert out["dia"]["monto_total"] == 25.0 and out["dia"]["hay_datos"]
    m = out["mes_hasta_la_fecha"]
    assert m["dias_con_datos"] == 2 and m["residencial"]["monto"] == 30.0 and m["monto_total"] == 35.0


def test_dia_sin_datos():
    out = fe.armar_resumen(date(2026, 11, 3), {1: _res(c0="10")}, {})
    assert out["dia"]["hay_datos"] is False and out["mes_hasta_la_fecha"]["monto_total"] == 10.0


def test_nombres_sin_tildes_ni_mayusculas():
    body = fe.LineasIn(fecha=date(2026, 11, 20), cuentas={"lineas  GARAY": {"ventas": 1}})
    fe.validar_lineas(body)
    assert list(body.cuentas) == ["Líneas Garay"]
    body = fe.ResidencialIn(fecha=date(2026, 11, 20), publicistas={"tito lineas": {"monto": 1}})
    fe.validar_residencial(body)
    assert list(body.publicistas) == ["Tito Líneas"]


def test_nombre_repetido_con_otra_escritura_se_rechaza():
    body = fe.ResidencialIn(fecha=date(2026, 11, 20),
                            publicistas={"Tito": {"monto": 1}, "TITO": {"monto": 2}})
    with pytest.raises(HTTPException) as e:
        fe.validar_residencial(body)
    assert e.value.status_code == 422
