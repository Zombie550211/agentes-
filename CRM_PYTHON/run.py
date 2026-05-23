import asyncio, warnings, sys

# Corre en TODOS los procesos (main + workers de reload).
# En Python 3.14 Windows, ProactorEventLoop no soporta SSL con aiomysql.
if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import uvicorn

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
