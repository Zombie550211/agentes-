"""Status de comisión: el único status que mueve el CRM (desde el 28-10-2026).

`leads.status_comision` toma un valor de LISTA (la columna SISTEMA de la hoja de comisiones más
tres estados propios del CRM). Todo lo que antes contaba o reaccionaba por `leads.status`
(KPIs, ranking, premios, semáforo, Riesgo CX, llamada de verificación, avisos) lee ahora el
GRUPO del status de comisión. `leads.status` queda como dato informativo: se guarda y sale en el
historial, nada más.

Grupos (los mismos nombres que usaba el status normal, para que la lógica no cambie):
  completed  → comisiona: lleva la palabra ACTIVE (ACTIVE, ACTIVE BY SYSTEM, ACTIVE BY FASTGM)
  cancelled  → CANCEL, CANCEL BY SYSTEM, CHARGEBACK
  hold       → HOLD
  oficina    → OFICINA (el semáforo pasa ahí los casos vencidos)
  reserva    → RESERVA
  repro      → REPRO (reprocesa una venta de días atrás; no cuenta como venta)
  pending    → todo lo demás (CXNC, NO SE PUEDE VALIDAR, NEXT PAY, FES…)

En SQL el grupo es la columna generada `leads.status_grupo` (migración 0078), que MySQL calcula
sola desde status_comision; en Python, grupo().
"""

LISTA = (
    "ACTIVE", "CANCEL", "COLLECTION", "HOLD", "IL", "FES", "REC AUD", "CHECK", "CXNC", "EDAB",
    "ACTIVE BY SYSTEM", "CHB ALERT", "CUENTA SUSPENDIDA", "CASO PTE", "CHB",
    "CANCEL BY SYSTEM", "SNAR", "NO SE PUEDE VALIDAR", "ACTIVE BY FASTGM", "NEXT PAY",
    "PENDING", "OFICINA", "RESERVA", "REPRO", "CHARGEBACK",
)

# Con el que entra toda venta nueva.
INICIAL = "PENDING"


def _sql_grupo(col: str) -> str:
    s = f"UPPER(TRIM(COALESCE({col},'')))"
    return (f"(CASE WHEN {s} LIKE '%ACTIVE%' OR {s} LIKE 'COMPLET%' OR {s} IN ('ACTIVO','ACTIVA') THEN 'completed' "
            f"WHEN {s} LIKE 'CANCEL%' OR {s} = 'CHARGEBACK' THEN 'cancelled' "
            f"WHEN {s} = 'HOLD' THEN 'hold' "
            f"WHEN {s} = 'OFICINA' THEN 'oficina' "
            f"WHEN {s} LIKE 'RESERV%' THEN 'reserva' "
            f"WHEN {s} LIKE '%REPRO%' OR {s} LIKE 'RESCHED%' THEN 'repro' "
            f"ELSE 'pending' END)")


# Expresión de la columna generada (y para usar sobre otra columna, p. ej. un parámetro).
SQL_GRUPO = _sql_grupo("status_comision")


def grupo(valor) -> str:
    s = str(valor or "").strip().upper()
    if "ACTIVE" in s or s.startswith("COMPLET") or s in ("ACTIVO", "ACTIVA"):
        return "completed"
    if s.startswith("CANCEL") or s == "CHARGEBACK":
        return "cancelled"
    if s == "HOLD":
        return "hold"
    if s == "OFICINA":
        return "oficina"
    if s.startswith("RESERV"):
        return "reserva"
    if "REPRO" in s or s.startswith("RESCHED"):
        return "repro"
    return "pending"


def normalizar(valor) -> str:
    """Valor de LISTA tal cual se guarda (mayúsculas); '' si no es válido."""
    v = str(valor or "").strip().upper()
    return v if v in LISTA else ""
