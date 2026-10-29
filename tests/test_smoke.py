import asyncio
import os
import sys

from kovan import db
from kovan.orchestrator import Orchestrator


def test_mock_run(tmp_path):
    o = Orchestrator("Todo uygulaması yap", tmp_path / "out", mock=True)
    rid = o.run()
    tasks = db.list_tasks(rid)
    assert len(tasks) == 3 and all(t["status"] == "approved" for t in tasks)
    assert db.get_run(rid)["status"] == "finished"


def test_mcp_server():
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client

    rid = db.create_run("mcp testi", "/tmp", 1.0)

    async def go():
        params = StdioServerParameters(command=sys.executable, args=["-m", "kovan.server"],
                                       env={**os.environ, "KOVAN_AGENT": "test", "KOVAN_RUN": str(rid)})
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as s:
                await s.initialize()
                names = {t.name for t in (await s.list_tools()).tools}
                assert {"kovan_task_add", "kovan_memory_set", "kovan_review_submit"} <= names
                await s.call_tool("kovan_memory_set", {"key": "stil", "value": "Tailwind kullan"})
                out = await s.call_tool("kovan_memory_get", {"key": "stil"})
                assert "Tailwind" in out.content[0].text
                out = await s.call_tool("kovan_task_add", {"title": "Ek görev", "agent": "codex"})
                assert "#" in out.content[0].text
    asyncio.run(go())
    # araçlar KOVAN_RUN ile doğru çalışmayı hedefledi
    assert db.mem_get("stil", rid)["value"] == "Tailwind kullan"
    assert [t["title"] for t in db.list_tasks(rid)] == ["Ek görev"]
