"""
Migraciones de datos one-time — YA EJECUTADAS en producción.
No corren en el arranque del servidor. Conservadas como referencia histórica.
Para ejecutar manualmente: python scripts/data_migrations.py
"""
import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))

from database_mysql import AsyncSessionLocal
from sqlalchemy import text

_DATA_MIGRATIONS = [
    # Normalizar campo 'sistema' en leads según servicios contratados
    """UPDATE leads SET sistema = CASE
        WHEN servicios LIKE '%VIDEO DIRECTV%'     THEN 'SARA'
        WHEN servicios LIKE '%ATT 300%'           THEN 'SARA'
        WHEN servicios LIKE '%ATT 500%'           THEN 'SARA'
        WHEN servicios LIKE '%ATT 1G%'            THEN 'SARA'
        WHEN servicios LIKE '%ATT 100%'           THEN 'SARA'
        WHEN servicios LIKE '%ATT 50%'            THEN 'SARA'
        WHEN servicios LIKE '%ATT 18%'            THEN 'SARA'
        WHEN servicios LIKE '%ATT AIR%'           THEN 'SARA'
        WHEN servicios LIKE '%AIR%'               THEN 'SARA'
        WHEN servicios LIKE '%SPECTRUM%'          THEN 'SARA'
        WHEN servicios LIKE '%FRONTIER%'          THEN 'SARA'
        WHEN servicios LIKE '%CONSOLIDATED%'      THEN 'SARA'
        WHEN servicios LIKE '%BRIGHTSPEED%'       THEN 'SARA'
        WHEN servicios LIKE '%EARTHLINK%'         THEN 'SARA'
        WHEN servicios LIKE '%ZIPLY%'             THEN 'SARA'
        WHEN servicios LIKE '%OPTIMUM%'           THEN 'SARA'
        WHEN servicios LIKE '%ALTAFIBER%'         THEN 'SARA'
        WHEN servicios LIKE '%WINDSTREAM%'        THEN 'SARA'
        WHEN servicios LIKE '%CENTURYLINK%'       THEN 'SARA'
        WHEN servicios LIKE '%METRONET%'          THEN 'SARA'
        WHEN servicios LIKE '%HAWAIIAN%'          THEN 'SARA'
        WHEN servicios LIKE '%WOW%'               THEN 'SARA'
        WHEN servicios LIKE '%XFINITY%'           THEN 'N/A'
        WHEN servicios LIKE '%HUGHESNET%'         THEN 'CHUZO'
        WHEN servicios LIKE '%VIASAT%'            THEN 'CHUZO'
        WHEN servicios LIKE '%VIVINT%'            THEN 'CHUZO'
        WHEN servicios LIKE '%MOBILITY%'          THEN 'CHUZO'
        ELSE sistema
    END
    WHERE (sistema IS NULL OR sistema = '')
      AND servicios IS NOT NULL AND servicios != '' AND servicios != '[]'""",

    "UPDATE leads SET autopago = 1 WHERE autopago IS NULL",

    # Normalizar riesgo: valores en español → inglés estándar
    """UPDATE leads SET riesgo = CASE
        WHEN LOWER(TRIM(riesgo)) IN ('bajo','low')     THEN 'LOW'
        WHEN LOWER(TRIM(riesgo)) IN ('medio','medium') THEN 'MEDIUM'
        WHEN LOWER(TRIM(riesgo)) IN ('alto','high')    THEN 'HIGH'
        WHEN LOWER(TRIM(riesgo)) IN ('n/a','na')       THEN 'N/A'
        ELSE riesgo
    END
    WHERE riesgo IS NOT NULL AND TRIM(riesgo) != ''""",

    # Normalizar team en lineas_clientes según supervisor
    "UPDATE lineas_clientes SET team = 'TEAM LINEAS JONATHAN' WHERE UPPER(TRIM(COALESCE(supervisor,''))) LIKE 'JONATHAN%'",
    "UPDATE lineas_clientes SET team = 'TEAM LINEAS LUIS'     WHERE UPPER(TRIM(COALESCE(supervisor,''))) LIKE 'LUIS%'",

    # Backfill supervisor en leads desde perfil del agente
    """UPDATE leads l
       INNER JOIN users u ON (
           LOWER(TRIM(l.agente_nombre)) = LOWER(TRIM(u.username))
        OR LOWER(TRIM(l.agente))        = LOWER(TRIM(u.username))
        OR LOWER(TRIM(l.created_by))    = LOWER(TRIM(u.username))
       )
       SET l.supervisor = u.supervisor
       WHERE (l.supervisor IS NULL OR TRIM(l.supervisor) = '')
         AND u.supervisor IS NOT NULL AND TRIM(u.supervisor) != ''""",

    # Backfill supervisor en lineas_clientes desde team
    """UPDATE lineas_clientes SET supervisor = CASE
         WHEN UPPER(TRIM(COALESCE(team,''))) LIKE '%LUIS%'     THEN 'LUIS G'
         WHEN UPPER(TRIM(COALESCE(team,''))) LIKE '%JONATHAN%' THEN 'JONATHAN F'
         ELSE supervisor
       END
       WHERE (supervisor IS NULL OR TRIM(supervisor) = '') AND COALESCE(TRIM(team),'') != ''""",

    # Backfill supervisor en lineas_clientes desde perfil del agente
    """UPDATE lineas_clientes lc
       INNER JOIN users u ON (
           LOWER(TRIM(lc.agente))          = LOWER(TRIM(u.username))
        OR LOWER(TRIM(lc.agente_nombre))   = LOWER(TRIM(u.username))
        OR LOWER(TRIM(lc.agente_asignado)) = LOWER(TRIM(u.username))
        OR LOWER(TRIM(lc.agente))          = LOWER(TRIM(u.name))
        OR LOWER(TRIM(lc.agente_nombre))   = LOWER(TRIM(u.name))
        OR LOWER(TRIM(lc.agente_asignado)) = LOWER(TRIM(u.name))
       )
       SET lc.supervisor = CASE
         WHEN LOWER(TRIM(COALESCE(u.team,''))) LIKE '%lineas luis%'
              OR LOWER(TRIM(COALESCE(u.supervisor,''))) LIKE '%luis%'     THEN 'LUIS G'
         WHEN LOWER(TRIM(COALESCE(u.team,''))) LIKE '%lineas jonathan%'
              OR LOWER(TRIM(COALESCE(u.supervisor,''))) LIKE '%jonathan%' THEN 'JONATHAN F'
         ELSE lc.supervisor
       END
       WHERE (lc.supervisor IS NULL OR TRIM(lc.supervisor) = '')""",
]

async def run():
    from dotenv import load_dotenv
    load_dotenv()
    async with AsyncSessionLocal() as s:
        for i, sql in enumerate(_DATA_MIGRATIONS, 1):
            try:
                result = await s.execute(text(sql))
                print(f"[{i}/{len(_DATA_MIGRATIONS)}] OK — {result.rowcount} filas afectadas")
            except Exception as e:
                print(f"[{i}/{len(_DATA_MIGRATIONS)}] ERROR — {e}")
        await s.commit()
    print("Migraciones de datos completadas.")

if __name__ == "__main__":
    asyncio.run(run())
