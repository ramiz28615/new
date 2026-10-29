import json
import shutil
import sqlite3
import threading
import time

import pytest

from kovan import agents, db, gitops, report
from kovan.orchestrator import Orchestrator, cancel_run, find_cycle, normalize_plan


def _plan(monkeypatch, items):
    monkeypatch.setenv("KOVAN_MOCK_PLAN", json.dumps(items, ensure_ascii=False))


# ---- DAG
def test_find_cycle():
    assert find_cycle({0: [], 1: [0], 2: [0, 1]}) is None
    cyc = find_cycle({0: [2], 1: [0], 2: [1]})
    assert cyc and cyc[0] == cyc[-1] and set(cyc) == {0, 1, 2}
    assert find_cycle({5: [5]}) == [5, 5]


def test_normalize_plan_drops_invalid_and_cyclic_deps():
    items, cycle = normalize_plan([
        {"title": "a", "depends_on": [1]},
        {"title": "b", "depends_on": [0]},
        {"title": "c", "depends_on": [0, 9, "x", 2]},
        {"title": "d", "agent": "gpt", "depends_on": 2},
    ])
    assert cycle is not None
    assert items[0]["depends_on"] == [] and items[1]["depends_on"] == []
    assert items[2]["depends_on"] == [0]
    assert items[3]["depends_on"] == [2] and items[3]["agent"] == "claude"


def test_dag_ordering(tmp_path, monkeypatch):
    _plan(monkeypatch, [
        {"title": "A temel", "agent": "claude", "depends_on": []},
        {"title": "B", "agent": "codex", "depends_on": [0]},
        {"title": "C", "agent": "claude", "depends_on": [0]},
        {"title": "D son", "agent": "codex", "depends_on": [1, 2]},
    ])
    rid = Orchestrator("dag", tmp_path / "o", mock=True, workers=4, git=False).run()
    t = {x["title"]: x for x in db.list_tasks(rid)}
    assert all(x["status"] == "approved" for x in t.values())
    assert t["B"]["started"] >= t["A temel"]["finished"]
    assert t["C"]["started"] >= t["A temel"]["finished"]
    assert t["D son"]["started"] >= max(t["B"]["finished"], t["C"]["finished"])
    assert t["D son"]["depends_on"] == [t["B"]["id"], t["C"]["id"]]


def test_cyclic_plan_still_runs(tmp_path, monkeypatch):
    _plan(monkeypatch, [{"title": "x", "depends_on": [1]}, {"title": "y", "depends_on": [0]}])
    rid = Orchestrator("döngü", tmp_path / "o", mock=True, git=False).run()
    assert db.get_run(rid)["status"] == "finished"
    assert any("döngü" in e["message"] for e in db.events(rid))


def test_runtime_cycle_is_skipped(tmp_path, monkeypatch):
    _plan(monkeypatch, [{"title": "tek"}])
    o = Orchestrator("x", tmp_path / "o", mock=True, git=False)
    a = db.add_task(o.run_id, "p")
    b = db.add_task(o.run_id, "q", depends_on=[a])
    db.update_task(a, depends_on=[b])
    o.run()
    st = {t["title"]: t for t in db.list_tasks(o.run_id)}
    assert st["p"]["status"] == "skipped" and "Döngüsel" in st["p"]["result"]
    assert db.get_run(o.run_id)["status"] == "partial"


def test_failed_dependency_skips_dependents(tmp_path, monkeypatch):
    _plan(monkeypatch, [
        {"title": "kırık", "depends_on": []},
        {"title": "bağımlı", "depends_on": [0]},
        {"title": "bağımsız", "depends_on": []},
    ])
    monkeypatch.setenv("KOVAN_MOCK_FAIL", "kırık")
    rid = Orchestrator("x", tmp_path / "o", mock=True, git=False, retries=0).run()
    st = {t["title"]: t["status"] for t in db.list_tasks(rid)}
    assert st == {"kırık": "failed", "bağımlı": "skipped", "bağımsız": "approved"}
    assert db.get_run(rid)["status"] == "partial"


# ---- iptal / devam
def test_cancel_kills_running_agents(tmp_path, monkeypatch):
    monkeypatch.setenv("KOVAN_MOCK_DELAY", "20")
    o = Orchestrator("yavaş", tmp_path / "o", mock=True, git=False)
    th = threading.Thread(target=o.run)
    t0 = time.monotonic()
    th.start()
    time.sleep(1.0)
    assert cancel_run(o.run_id) == "cancelling"
    th.join(15)
    assert not th.is_alive()
    assert time.monotonic() - t0 < 12
    assert db.get_run(o.run_id)["status"] == "cancelled"


def test_cancel_then_resume(tmp_path, monkeypatch):
    o = Orchestrator("devam", tmp_path / "o", mock=True, git=False)
    # planı yap, ama işçi aşamasında iptal et
    monkeypatch.setenv("KOVAN_MOCK_DELAY", "20")
    rid = o.run_id
    db.update_run(rid, status="planning")
    for title in ("a", "b"):
        db.add_task(rid, title)
    th = threading.Thread(target=o.run)
    th.start()
    time.sleep(1.0)
    cancel_run(rid)
    th.join(15)
    assert db.get_run(rid)["status"] == "cancelled"
    assert {t["status"] for t in db.list_tasks(rid)} == {"cancelled"}
    monkeypatch.setenv("KOVAN_MOCK_DELAY", "0.05")
    Orchestrator.resume(rid).run()
    assert db.get_run(rid)["status"] == "finished"
    assert {t["status"] for t in db.list_tasks(rid)} == {"approved"}


def test_cancel_without_live_process_marks_cancelled():
    rid = db.create_run("ölü", "/tmp", 1.0)
    db.update_run(rid, status="running", pid=999_999_999)
    db.add_task(rid, "x")
    assert cancel_run(rid) == "cancelled"
    assert db.list_tasks(rid)[0]["status"] == "cancelled"


# ---- yeniden deneme / zaman aşımı
def test_transient_failure_is_retried(tmp_path, monkeypatch):
    _plan(monkeypatch, [{"title": "titrek iş"}])
    monkeypatch.setenv("KOVAN_MOCK_FLAKY", "titrek")
    rid = Orchestrator("x", tmp_path / "o", mock=True, git=False, retries=1).run()
    assert db.list_tasks(rid)[0]["status"] == "approved"
    assert any(e["kind"] == "retry" for e in db.events(rid))


def test_timeout(tmp_path, monkeypatch):
    monkeypatch.setenv("KOVAN_MOCK_DELAY", "10")
    t0 = time.monotonic()
    rid = Orchestrator("x", tmp_path / "o", mock=True, git=False, timeout=1, retries=0).run()
    assert time.monotonic() - t0 < 9
    assert db.list_tasks(rid)[0]["status"] == "failed"
    assert "Zaman aşımı" in db.list_tasks(rid)[0]["result"]


def test_is_transient():
    assert agents.is_transient(agents.AgentResult(False, "Error: 429 rate limit"))
    assert not agents.is_transient(agents.AgentResult(False, "SyntaxError"))
    assert not agents.is_transient(agents.AgentResult(False, "x", timed_out=True))
    assert not agents.is_transient(agents.AgentResult(True, "429"))


# ---- maliyet ve bütçe
def test_codex_usage_parsing_and_cost():
    prices = {"codex": {"input": 1.0, "output": 10.0, "blended": 2.0}}
    assert agents.parse_codex_usage("bitti\ntokens used\n12,345\n") == {"total": 12345}
    assert agents.parse_codex_usage("tokens used: 1000") == {"total": 1000}
    js = '{"type":"turn.completed","usage":{"input_tokens":1000,"cached_input_tokens":0,"output_tokens":100}}'
    assert agents.parse_codex_usage(js) == {"input": 1000, "output": 100}
    assert agents.estimate_cost("codex", {"input": 1_000_000, "output": 100_000}, prices) == pytest.approx(2.0)
    assert agents.estimate_cost("codex", {"total": 500_000}, prices) == pytest.approx(1.0)
    assert agents.parse_codex_usage("hiçbir şey") == {}


def test_budget_stop_covers_both_agents(tmp_path, monkeypatch):
    _plan(monkeypatch, [{"title": f"g{i}", "agent": "codex" if i % 2 else "claude"} for i in range(4)])
    monkeypatch.setenv("KOVAN_MOCK_COST", "0.4")  # claude çağrısı başına
    monkeypatch.setenv("KOVAN_MOCK_TOKENS", "200000")  # codex: 200k * $3/M = $0.6
    rid = Orchestrator("pahalı", tmp_path / "o", mock=True, git=False, budget=1.5, workers=1).run()
    run = db.get_run(rid)
    tasks = db.list_tasks(rid)
    assert run["status"] == "budget"
    assert any(t["status"] == "skipped" for t in tasks)
    assert run["cost"] >= 1.5
    codex_cost = sum(t["cost"] for t in tasks if t["agent"] == "codex")
    claude_cost = sum(t["cost"] for t in tasks if t["agent"] == "claude")
    assert codex_cost > 0 and claude_cost > 0
    assert sum(t["cost"] for t in tasks) <= run["cost"] + 1e-9


# ---- hafıza kapsamı
def test_memory_scoping():
    r1 = db.create_run("bir", "/tmp", 1)
    r2 = db.create_run("iki", "/tmp", 1)
    db.mem_set("api", "r1-adres", r1, "claude")
    db.mem_set("api", "r2-adres", r2, "codex")
    db.mem_set("global:stil", "Tailwind", r1, "claude")
    assert db.mem_get("api", r1)["value"] == "r1-adres"
    assert db.mem_get("api", r2)["value"] == "r2-adres"
    assert db.mem_get("stil", r2)["value"] == "Tailwind"  # global'e düşer
    assert db.mem_get("global:stil", r2)["key"] == "global:stil"
    keys = {(m["key"], m["value"]) for m in db.mem_search("", r2)}
    assert ("api", "r2-adres") in keys and ("api", "r1-adres") not in keys and ("global:stil", "Tailwind") in keys


def test_mcp_current_run_from_env(monkeypatch):
    from kovan import server
    r1 = db.create_run("bir", "/tmp", 1)
    db.create_run("iki", "/tmp", 1)
    monkeypatch.setenv("KOVAN_RUN", str(r1))
    assert server.current_run() == r1
    server.kovan_memory_set("karar", "SQLite")
    assert db.mem_get("karar", r1)["value"] == "SQLite"
    monkeypatch.delenv("KOVAN_RUN")
    assert server.current_run() == db.latest_run_id() != r1


# ---- rapor
def test_report_generation(tmp_path):
    rid = Orchestrator("Rapor testi", tmp_path / "o", mock=True).run()
    md = report.build(rid)
    assert "# Kovan raporu — çalışma #" in md and "Rapor testi" in md
    assert "```mermaid" in md and "| # | Görev |" in md and "Toplam" in md
    path = report.write(rid)
    assert path.name == "REPORT.md"
    assert "Kovan raporu" in path.read_text(encoding="utf-8")


# ---- git kontrol noktaları
@pytest.mark.skipif(not shutil.which("git"), reason="git yok")
def test_git_checkpoints_and_rollback(tmp_path):
    work = tmp_path / "o"
    rid = Orchestrator("git", work, mock=True, workers=1).run()
    tasks = db.list_tasks(rid)
    assert all(t["commit_sha"] for t in tasks)
    first = tasks[0]
    assert (work / f"gorev-{first['id']}.md").exists()
    assert f"gorev-{first['id']}.md" in gitops.show(work, first["commit_sha"])
    gitops.revert(work, first["commit_sha"])
    assert not (work / f"gorev-{first['id']}.md").exists()


# ---- veritabanı göçü
def test_db_migration_from_v01(tmp_path, monkeypatch):
    path = tmp_path / "old.db"
    c = sqlite3.connect(path)
    c.executescript("""
    CREATE TABLE runs(id INTEGER PRIMARY KEY, prompt TEXT, status TEXT, workdir TEXT,
      budget REAL, cost REAL DEFAULT 0, summary TEXT, created REAL, updated REAL);
    CREATE TABLE tasks(id INTEGER PRIMARY KEY, run_id INTEGER, title TEXT, detail TEXT,
      agent TEXT, status TEXT, result TEXT, reviewer TEXT, review TEXT, attempts INTEGER DEFAULT 0,
      created REAL, updated REAL);
    CREATE TABLE memory(key TEXT PRIMARY KEY, value TEXT, run_id INTEGER, author TEXT, updated REAL);
    CREATE TABLE events(id INTEGER PRIMARY KEY, run_id INTEGER, ts REAL, agent TEXT, kind TEXT, message TEXT);
    INSERT INTO runs VALUES(1,'eski','finished','/tmp',5,0.5,'ok',1,1);
    INSERT INTO tasks(id,run_id,title,agent,status) VALUES(1,1,'eski görev','claude','approved');
    INSERT INTO memory VALUES('stil','modern',1,'claude',1);
    INSERT INTO memory VALUES('ortak','evet',NULL,'claude',1);
    """)
    c.commit()
    c.close()
    monkeypatch.setenv("KOVAN_DB", str(path))
    t = db.list_tasks(1)[0]
    assert t["title"] == "eski görev" and t["depends_on"] == [] and t["cost"] == 0
    assert db.get_run(1)["prompt"] == "eski"
    assert db.mem_get("stil", 1)["value"] == "modern"
    assert db.mem_get("ortak", 1)["value"] == "evet"
    cols = {r["name"] for r in db.q("PRAGMA table_info(tasks)")}
    assert {"depends_on", "cost", "started", "finished", "commit_sha"} <= cols
    assert db.q("PRAGMA user_version", one=True)["user_version"] == db.SCHEMA_VERSION
    db.add_task(1, "yeni", depends_on=[1])  # göç sonrası yazma çalışır
