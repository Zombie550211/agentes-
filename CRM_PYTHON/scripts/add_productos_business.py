"""
Agrega la sección BUSINESS al catálogo de productos (solo Residencial).

`ensure_productos()` siembra SOLO si la tabla está vacía, así que en una BD ya
poblada no hace nada: este script es el que mete las filas nuevas sin pisar las
ediciones que el admin haya hecho desde la página de permisos.

Categorías nuevas -> el select "Servicios" arma el optgroup solo, y el tipo
nuevo aparece solo en "Tipo de servicio" (ambos salen de la tabla productos).

Uso:
  python add_productos_business.py           -- dry-run (muestra qué haría)
  python add_productos_business.py --apply   -- aplica los cambios

Antes de aplicar guarda las filas que va a tocar en
backups/productos-pre-business-<fecha>.json para poder revertir.
"""
import asyncio, json, os, sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text, bindparam  # noqa: E402
from database_mysql import AsyncSessionLocal  # noqa: E402
from scoring import SCORING_SEED, service_meta  # noqa: E402

# Servicios business a garantizar (se leen del seed: fuente única).
BUSINESS_CATS = ('LINEA BUSINESS', 'DIRECTV BUSINESS', 'STARLINK BUSINESS')


def _rows():
    out = []
    for servicio, cfg in SCORING_SEED.items():
        cat = cfg.get('categoria') or ''
        if cat not in BUSINESS_CATS:
            continue
        tipo, sistema = service_meta(servicio, cat)
        out.append({
            's': servicio, 'c': cat, 'tp': tipo,
            'sis': cfg.get('sistema') or sistema,
            'b': cfg.get('base'),
        })
    return out


async def main(apply: bool) -> None:
    rows = _rows()
    async with AsyncSessionLocal() as s:
        # Estado actual de los servicios involucrados (para diff y respaldo).
        nombres = [r['s'] for r in rows]
        q = await s.execute(
            text("SELECT id, servicio, categoria, tipo, sistema, score_base, score_low, "
                 "score_medium, score_high, score_na FROM productos WHERE servicio IN :n")
            .bindparams(bindparam("n", expanding=True)), {"n": nombres})
        actuales = {x['servicio']: dict(x) for x in q.mappings().all()}

        nuevos, cambios, iguales = [], [], []
        for r in rows:
            cur = actuales.get(r['s'])
            if not cur:
                nuevos.append(r)
            elif (cur['categoria'] != r['c'] or cur['tipo'] != r['tp']
                  or cur['sistema'] != r['sis']
                  or (cur['score_base'] is None) != (r['b'] is None)
                  or (cur['score_base'] is not None and float(cur['score_base']) != float(r['b']))):
                cambios.append((r, cur))
            else:
                iguales.append(r)

        print(f"Nuevos:      {len(nuevos)}")
        for r in nuevos:
            print(f"  + {r['s']:<38} {r['c']:<18} {r['tp']:<18} {r['sis']:<6} {r['b']}")
        print(f"Modificados: {len(cambios)}")
        for r, cur in cambios:
            print(f"  ~ {r['s']}")
            print(f"      antes:  cat={cur['categoria']} tipo={cur['tipo']} sis={cur['sistema']} base={cur['score_base']}")
            print(f"      despues cat={r['c']} tipo={r['tp']} sis={r['sis']} base={r['b']}")
        print(f"Sin cambios: {len(iguales)}")

        if not apply:
            print("\n[dry-run] nada escrito. Usar --apply para aplicar.")
            return
        if not nuevos and not cambios:
            print("\nNada que hacer.")
            return

        if cambios:
            bdir = Path(__file__).resolve().parent.parent.parent / "backups"
            bdir.mkdir(exist_ok=True)
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            respaldo = bdir / f"productos-pre-business-{stamp}.json"
            respaldo.write_text(json.dumps(
                [cur for _, cur in cambios], indent=2, default=str), encoding="utf-8")
            print(f"\nRespaldo de filas modificadas: {respaldo}")

        for r in nuevos + [x for x, _ in cambios]:
            await s.execute(text("""
                INSERT INTO productos (servicio, categoria, tipo, sistema, score_base)
                VALUES (:s, :c, :tp, :sis, :b)
                ON DUPLICATE KEY UPDATE categoria=:c, tipo=:tp, sistema=:sis, score_base=:b
            """), r)
        await s.commit()
        print(f"\nOK: {len(nuevos)} insertados, {len(cambios)} actualizados.")


if __name__ == "__main__":
    asyncio.run(main("--apply" in sys.argv))
