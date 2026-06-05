"""
Script de arranque estable para Windows + Python 3.14.
Crea el SelectorEventLoop ANTES de que uvicorn lo haga,
evitando el bug de SSL con aiomysql en Windows ProactorEventLoop.
"""
import asyncio, sys, warnings

if sys.platform == "win32":
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except Exception:
            pass
    loop = asyncio.SelectorEventLoop()
    asyncio.set_event_loop(loop)
else:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

import uvicorn

if __name__ == "__main__":
    config = uvicorn.Config(
        "main:app",
        host="0.0.0.0",
        port=8001,
        reload=False,
        log_level="info",
    )
    server = uvicorn.Server(config)
    loop.run_until_complete(server.serve())
