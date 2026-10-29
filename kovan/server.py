"""Kovan MCP sunucusu. Claude Code ve Codex bu sunucuya bağlanıp ortak görev panosunu,
ortak hafızayı ve çapraz inceleme araçlarını kullanır.

Çalıştırma:  python -m kovan.server   (stdio)

Ortam değişkenleri:
  KOVAN_RUN    araçların hedeflediği çalışma (orkestratör ajanı başlatırken verir).
               Yoksa en son çalışma kullanılır (ör. `kovan connect` ile elle kullanım).
  KOVAN_AGENT  kayıtlarda görünecek ajan adı.
"""
from __future__ import annotations

import json
import os

try:
    from mcp.server.fastmcp import FastMCP  # mcp 1.x
except ImportError:  # mcp 2.x
    from mcp.server.mcpserver import MCPServer as FastMCP

from . import db

mcp = FastMCP("kovan")
AGENT = os.environ.get("KOVAN_AGENT", "agent")


def current_run(run_id: int = 0):
    """Açıkça verilen > KOVAN_RUN > en son çalışma."""
    if run_id:
        return int(run_id)
    env = os.environ.get("KOVAN_RUN", "").strip()
    if env.isdigit():
        return int(env)
    return db.latest_run_id()


def _j(x):
    return json.dumps(x, ensure_ascii=False, indent=2, default=str)


@mcp.tool()
def kovan_status(run_id: int = 0) -> str:
    """Aktif (veya verilen) çalışmanın durumunu döner: istek, görevler, bütçe."""
    run_id = current_run(run_id)
    if not run_id or not db.get_run(run_id):
        return "Henüz çalışma yok."
    run = {k: v for k, v in db.get_run(run_id).items() if k not in ("pid", "options")}
    tasks = [{k: t[k] for k in ("id", "title", "agent", "status", "depends_on")} for t in db.list_tasks(run_id)]
    return _j({"run": run, "tasks": tasks})


@mcp.tool()
def kovan_task_list(run_id: int = 0) -> str:
    """Bir çalışmanın tüm görevlerini sonuç, bağımlılık ve incelemeleriyle listeler."""
    run_id = current_run(run_id)
    return _j(db.list_tasks(run_id) if run_id else [])


@mcp.tool()
def kovan_task_add(title: str, detail: str = "", agent: str = "claude", run_id: int = 0,
                   depends_on: list[int] | None = None) -> str:
    """Panoya yeni bir alt görev ekler (agent: 'claude' veya 'codex').
    depends_on: önce bitmesi gereken görev numaraları (#id)."""
    run_id = current_run(run_id)
    if not run_id:
        return "Çalışma yok; önce `kovan run` başlatılmalı."
    known = {t["id"] for t in db.list_tasks(run_id)}
    deps = [int(d) for d in (depends_on or []) if int(d) in known]
    tid = db.add_task(run_id, title, detail, agent if agent in ("claude", "codex") else "claude", deps)
    db.log(run_id, AGENT, "task_add", f"#{tid} {title}" + (f" (bağımlı: {deps})" if deps else ""))
    return f"Görev eklendi: #{tid}"


@mcp.tool()
def kovan_task_update(task_id: int, status: str, result: str = "") -> str:
    """Görevin durumunu günceller. status: in_progress | done | blocked. result: ne yaptığının özeti."""
    t = db.get_task(task_id)
    if not t:
        return f"#{task_id} bulunamadı."
    if status not in ("in_progress", "done", "blocked"):
        return "Geçersiz durum; in_progress | done | blocked kullan."
    fields = {"status": status}
    if result:
        fields["result"] = result
    db.update_task(task_id, **fields)
    db.log(t["run_id"], AGENT, "task_update", f"#{task_id} -> {status}: {result[:300]}")
    return f"#{task_id} güncellendi: {status}"


@mcp.tool()
def kovan_memory_set(key: str, value: str) -> str:
    """Ortak hafızaya yazar. Varsayılan olarak bu çalışmaya özeldir;
    tüm çalışmalarda ortak olsun istersen anahtarı 'global:' ile başlat (ör. global:stil)."""
    run_id = current_run()
    ns = db.mem_set(key, value, run_id, AGENT)
    if run_id:
        db.log(run_id, AGENT, "memory", f"{key} = {value[:200]}")
    return f"Kaydedildi: {key} ({'global' if ns == 'global' else f'çalışma #{run_id}'})"


@mcp.tool()
def kovan_memory_get(key: str) -> str:
    """Ortak hafızadan bir anahtarı okur (önce bu çalışma, sonra global)."""
    m = db.mem_get(key, current_run())
    return m["value"] if m else f"'{key}' hafızada yok."


@mcp.tool()
def kovan_memory_search(query: str) -> str:
    """Bu çalışmanın ve global hafızanın anahtar/değerlerinde metin arar."""
    return _j([{k: m[k] for k in ("key", "value", "author")} for m in db.mem_search(query, current_run())])


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
    run_id = current_run()
    if run_id:
        db.log(run_id, AGENT, "note", message)
    return "ok"


def main():
    mcp.run()


if __name__ == "__main__":
    main()
