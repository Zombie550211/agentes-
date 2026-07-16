"""
Catálogos genéricos gestionados por el backend (fuente única, BD).

Listas del formulario que antes estaban hardcodeadas en el frontend:
mercado, motivo (¿por qué llamó?), riesgo, status, autopago.

Se guardan en la tabla `catalogos` (tipo, valor, label, orden) y se editan
desde la página de permisos. El frontend las consume vía /api/catalogos.
"""

# tipo -> lista ordenada de (valor, label)
CATALOGOS_SEED = {
    'mercado': [('ICON', 'ICON'), ('BAMO', 'BAMO')],
    'motivo': [
        ('BILL ALTO', '⚡ Bill Alto'),
        ('PROBLEMAS DE INTERNET', '🌐 Prob. Internet'),
        ('ADQUIRIR SERVICIOS', '🛒 Adquirir Serv.'),
        ('MUDANZA', '📦 Mudanza'),
        ('CANCELAR SERVICIOS', '❌ Cancelar Serv.'),
        ('PAGAR BILL', '💳 Pagar Bill'),
        ('ATENCION AL CLIENTE', '💬 Atención Cliente'),
    ],
    'riesgo': [('LOW', 'LOW'), ('MEDIUM', 'MEDIUM'), ('HIGH', 'HIGH'), ('N/A', 'N/A')],
    'status': [('PENDING', 'Pending'), ('REPRO', 'Repro')],
    'autopago': [('SI', 'SI'), ('NO', 'NO')],
    # Modalidades extra para "tipo de servicio" que NO derivan de un producto
    # (el resto de tipos se calculan automáticamente desde la tabla productos).
    # DOUBLE PLAY dispara reglas especiales de puntaje (ver scoring.special_score).
    'tipo_extra': [('DOUBLE PLAY', 'DOUBLE PLAY')],
}


async def ensure_catalogos(session) -> None:
    """Crea la tabla `catalogos` y la siembra SOLO si está vacía (no pisa ediciones)."""
    from sqlalchemy import text
    await session.execute(text("""
        CREATE TABLE IF NOT EXISTS catalogos (
            id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
            tipo       VARCHAR(40) NOT NULL,
            valor      VARCHAR(120) NOT NULL,
            label      VARCHAR(160),
            orden      INT DEFAULT 0,
            activo     BOOLEAN DEFAULT TRUE,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uq_tipo_valor (tipo, valor),
            INDEX idx_tipo (tipo)
        ) ENGINE=InnoDB
    """))
    r = await session.execute(text("SELECT COUNT(*) FROM catalogos"))
    if (r.scalar() or 0) == 0:
        for tipo, items in CATALOGOS_SEED.items():
            for i, (valor, label) in enumerate(items):
                await session.execute(text("""
                    INSERT INTO catalogos (tipo, valor, label, orden)
                    VALUES (:t, :v, :l, :o)
                """), {"t": tipo, "v": valor, "l": label, "o": i})
        await session.commit()
        return

    # Tabla ya sembrada: garantizar 'tipo_extra' (p. ej. DOUBLE PLAY) para BDs
    # existentes que se sembraron antes de agregar esta categoría. Solo si no hay
    # ninguna fila 'tipo_extra' (respeta ediciones/borrados posteriores del admin).
    r2 = await session.execute(text("SELECT COUNT(*) FROM catalogos WHERE tipo = 'tipo_extra'"))
    if (r2.scalar() or 0) == 0:
        for i, (valor, label) in enumerate(CATALOGOS_SEED.get('tipo_extra', [])):
            await session.execute(text("""
                INSERT INTO catalogos (tipo, valor, label, orden)
                VALUES ('tipo_extra', :v, :l, :o)
                ON DUPLICATE KEY UPDATE label = VALUES(label)
            """), {"v": valor, "l": label, "o": i})
        await session.commit()
