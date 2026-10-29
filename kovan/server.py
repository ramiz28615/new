"""Kovan MCP sunucusu. Claude Code ve Codex bu sunucuya bağlanıp ortak görev panosunu,
ortak hafızayı ve çapraz inceleme araçlarını kullanır.

Çalıştırma:  python -m kovan.server   (stdio)
"""
import json, os
try:
    from mcp.server.fastmcp import FastMCP  # mcp 1.x
except ImportError:  # mcp 2.x
    from mcp.server.mcpserver import MCPServer as FastMCP
from . import db

mcp = FastMCP("kovan")
AGENT = os.environ.get("KOVAN_AGENT", "agent")

def _j(x):
    return json.dumps(x, ensure_ascii=False, indent=2, default=str)

@mcp.tool()
def kovan_status(run_id: int = 0) -> str:
    """Aktif (veya verilen) çalışmanın durumunu döner: istek, görevler, bütçe."""
    run_id = run_id or db.latest_run_id()
    if not run_id:
        return "Henüz çalışma yok."
    run = db.get_run(run_id)
    tasks = [{k: t[k] for k in ("id", "title", "agent", "status")} for t in db.list_tasks(run_id)]
    return _j({"run": run, "tasks": tasks})

@mcp.tool()
def kovan_task_list(run_id: int = 0) -> str:
    """Bir çalışmanın tüm görevlerini sonuç ve incelemeleriyle listeler."""
    run_id = run_id or db.latest_run_id()
    return _j(db.list_tasks(run_id) if run_id else [])

@mcp.tool()
def kovan_task_add(title: str, detail: str = "", agent: str = "claude", run_id: int = 0) -> str:
    """Panoya yeni bir alt görev ekler (agent: 'claude' veya 'codex'). Büyük işi bölmek için kullan."""
    run_id = run_id or db.latest_run_id()
    if not run_id:
        return "Çalışma yok; önce `kovan run` başlatılmalı."
    tid = db.add_task(run_id, title, detail, agent if agent in ("claude", "codex") else "claude")
    db.log(run_id, AGENT, "task_add", f"#{tid} {title}")
    return f"Görev eklendi: #{tid}"

@mcp.tool()
def kovan_task_update(task_id: int, status: str, result: str = "") -> str:
    """Görevin durumunu günceller. status: in_progress | done | blocked. result: ne yaptığının özeti."""
    t = db.get_task(task_id)
    if not t:
        return f"#{task_id} bulunamadı."
    fields = {"status": status}
    if result:
        fields["result"] = result
    db.update_task(task_id, **fields)
    db.log(t["run_id"], AGENT, "task_update", f"#{task_id} -> {status}: {result[:300]}")
    return f"#{task_id} güncellendi: {status}"

@mcp.tool()
def kovan_memory_set(key: str, value: str) -> str:
    """Ortak hafızaya yazar. Diğer ajan bunu okuyabilir (kararlar, API adresleri, stil kuralları...)."""
    db.mem_set(key, value, db.latest_run_id(), AGENT)
    run_id = db.latest_run_id()
    if run_id:
        db.log(run_id, AGENT, "memory", f"{key} = {value[:200]}")
    return f"Kaydedildi: {key}"

@mcp.tool()
def kovan_memory_get(key: str) -> str:
    """Ortak hafızadan bir anahtarı okur."""
    m = db.mem_get(key)
    return m["value"] if m else f"'{key}' hafızada yok."

@mcp.tool()
def kovan_memory_search(query: str) -> str:
    """Ortak hafızada anahtar veya değer içinde metin arar."""
    return _j([{k: m[k] for k in ("key", "value", "author")} for m in db.mem_search(query)])

@mcp.tool()
def kovan_review_submit(task_id: int, approved: bool, notes: str = "") -> str:
    """Başka ajanın görevini inceleyip onaylar veya düzeltme ister."""
    t = db.get_task(task_id)
    if not t:
        return f"#{task_id} bulunamadı."
    verdict = "APPROVE" if approved else f"CHANGES: {notes}"
    db.update_task(task_id, review=verdict, reviewer=AGENT)
    db.log(t["run_id"], AGENT, "review", f"#{task_id} {verdict[:300]}")
    return f"İnceleme kaydedildi: {verdict[:80]}"

@mcp.tool()
def kovan_log(message: str) -> str:
    """Canlı panoya ilerleme notu düşer."""
    run_id = db.latest_run_id()
    if run_id:
        db.log(run_id, AGENT, "note", message)
    return "ok"

def main():
    mcp.run()

if __name__ == "__main__":
    main()
