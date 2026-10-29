"""Kovan ortak durum deposu (SQLite). Hem MCP sunucusu hem orkestratör hem pano kullanır."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from pathlib import Path

_LOCK = threading.Lock()
_READY: set[str] = set()
SCHEMA_VERSION = 2

ACTIVE_RUN = ("planning", "running", "cancelling")
TERMINAL_RUN = ("finished", "partial", "budget", "cancelled", "error")
OK_TASK = ("approved", "done")
BAD_TASK = ("failed", "skipped", "cancelled", "rolled_back")

TABLES = """
CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, prompt TEXT, status TEXT, workdir TEXT,
  budget REAL, cost REAL DEFAULT 0, summary TEXT, created REAL, updated REAL,
  options TEXT, pid INTEGER, finished REAL);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, run_id INTEGER, title TEXT, detail TEXT,
  agent TEXT, status TEXT, result TEXT, reviewer TEXT, review TEXT, attempts INTEGER DEFAULT 0,
  created REAL, updated REAL, depends_on TEXT DEFAULT '[]', cost REAL DEFAULT 0,
  started REAL, finished REAL, commit_sha TEXT);
CREATE TABLE IF NOT EXISTS memory(ns TEXT NOT NULL, key TEXT NOT NULL, value TEXT, run_id INTEGER,
  author TEXT, updated REAL, PRIMARY KEY(ns, key));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, run_id INTEGER, ts REAL, agent TEXT,
  kind TEXT, message TEXT);
"""

INDEXES = """
CREATE INDEX IF NOT EXISTS ix_tasks_run ON tasks(run_id);
CREATE INDEX IF NOT EXISTS ix_events_run ON events(run_id, id);
CREATE INDEX IF NOT EXISTS ix_memory_run ON memory(run_id);
"""

# Eski (0.1) veritabanlarına eklenecek sütunlar
NEW_COLUMNS = {
    "runs": {"options": "TEXT", "pid": "INTEGER", "finished": "REAL"},
    "tasks": {"depends_on": "TEXT DEFAULT '[]'", "cost": "REAL DEFAULT 0", "started": "REAL",
              "finished": "REAL", "commit_sha": "TEXT"},
}


def db_path() -> Path:
    env = os.environ.get("KOVAN_DB")
    if env:
        p = Path(env).expanduser()
    else:
        from . import config
        p = config.home() / "kovan.db"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _columns(c: sqlite3.Connection, table: str) -> set[str]:
    return {r[1] for r in c.execute(f"PRAGMA table_info({table})")}


def migrate(c: sqlite3.Connection) -> None:
    """Şemayı oluşturur ve eski veritabanlarını güvenle günceller (veri kaybı olmadan)."""
    c.executescript(TABLES)
    for table, cols in NEW_COLUMNS.items():
        have = _columns(c, table)
        for name, ddl in cols.items():
            if name not in have:
                c.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
    if "ns" not in _columns(c, "memory"):
        # 0.1: memory(key PRIMARY KEY, ...) -> 0.2: (ns, key) birincil anahtar
        c.executescript("""
        ALTER TABLE memory RENAME TO memory_v1;
        CREATE TABLE memory(ns TEXT NOT NULL, key TEXT NOT NULL, value TEXT, run_id INTEGER,
          author TEXT, updated REAL, PRIMARY KEY(ns, key));
        INSERT OR REPLACE INTO memory(ns,key,value,run_id,author,updated)
          SELECT CASE WHEN run_id IS NULL THEN 'global' ELSE 'run:' || run_id END,
                 key, value, run_id, author, updated FROM memory_v1;
        DROP TABLE memory_v1;
        """)
    c.executescript(INDEXES)
    c.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
    c.commit()


def connect() -> sqlite3.Connection:
    path = db_path()
    c = sqlite3.connect(path, timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    if str(path) not in _READY:
        c.execute("PRAGMA journal_mode=WAL")
        migrate(c)
        _READY.add(str(path))
    return c


def _rows(cur):
    return [dict(r) for r in cur.fetchall()]


def q(sql, args=(), one=False):
    with _LOCK:
        c = connect()
        try:
            cur = c.execute(sql, args)
            c.commit()
            if sql.lstrip().upper().startswith(("SELECT", "PRAGMA")):
                rows = _rows(cur)
                return (rows[0] if rows else None) if one else rows
            return cur.lastrowid
        finally:
            c.close()


def now() -> float:
    return time.time()


# ---- runs
def create_run(prompt, workdir, budget, options=None):
    return q("INSERT INTO runs(prompt,status,workdir,budget,options,created,updated) VALUES(?,?,?,?,?,?,?)",
             (prompt, "planning", str(workdir), budget, json.dumps(options or {}), now(), now()))


def update_run(run_id, **kw):
    kw["updated"] = now()
    sets = ",".join(f"{k}=?" for k in kw)
    q(f"UPDATE runs SET {sets} WHERE id=?", (*kw.values(), run_id))


def add_cost(run_id, usd, task_id=None):
    if usd:
        q("UPDATE runs SET cost=cost+? WHERE id=?", (float(usd), run_id))
        if task_id:
            q("UPDATE tasks SET cost=COALESCE(cost,0)+? WHERE id=?", (float(usd), task_id))


def get_run(run_id):
    return q("SELECT * FROM runs WHERE id=?", (run_id,), one=True)


def latest_run_id():
    r = q("SELECT id FROM runs ORDER BY id DESC LIMIT 1", one=True)
    return r["id"] if r else None


def run_options(run):
    try:
        return json.loads(run.get("options") or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}


def cancel_requested(run_id) -> bool:
    r = q("SELECT status FROM runs WHERE id=?", (run_id,), one=True)
    return bool(r) and r["status"] in ("cancelling", "cancelled")


# ---- tasks
def _task(row):
    if row is None:
        return None
    try:
        row["depends_on"] = [int(x) for x in json.loads(row.get("depends_on") or "[]")]
    except (TypeError, ValueError):
        row["depends_on"] = []
    return row


def add_task(run_id, title, detail="", agent="claude", depends_on=None):
    deps = json.dumps([int(d) for d in (depends_on or [])])
    return q("INSERT INTO tasks(run_id,title,detail,agent,status,depends_on,created,updated) VALUES(?,?,?,?,?,?,?,?)",
             (run_id, title, detail, agent, "pending", deps, now(), now()))


def update_task(task_id, **kw):
    if "depends_on" in kw and not isinstance(kw["depends_on"], str):
        kw["depends_on"] = json.dumps([int(d) for d in kw["depends_on"]])
    kw["updated"] = now()
    sets = ",".join(f"{k}=?" for k in kw)
    q(f"UPDATE tasks SET {sets} WHERE id=?", (*kw.values(), task_id))


def get_task(task_id):
    return _task(q("SELECT * FROM tasks WHERE id=?", (task_id,), one=True))


def list_tasks(run_id):
    return [_task(r) for r in q("SELECT * FROM tasks WHERE run_id=? ORDER BY id", (run_id,))]


def reset_unfinished(run_id) -> int:
    """resume için: bitmemiş görevleri yeniden 'pending' yapar."""
    rows = q("SELECT id FROM tasks WHERE run_id=? AND status NOT IN ('approved','done','rolled_back')", (run_id,))
    for r in rows:
        update_task(r["id"], status="pending", started=None, finished=None)
    return len(rows)


# ---- memory (çalışmaya göre ad alanı; "global:" önekli anahtarlar tüm çalışmalarda ortak)
GLOBAL_PREFIX = "global:"


def _ns(key, run_id):
    if key.startswith(GLOBAL_PREFIX) or not run_id:
        return "global", key[len(GLOBAL_PREFIX):] if key.startswith(GLOBAL_PREFIX) else key
    return f"run:{int(run_id)}", key


def _mem_out(row):
    if row and row["ns"] == "global":
        row["key"] = GLOBAL_PREFIX + row["key"]
    return row


def mem_set(key, value, run_id=None, author="?"):
    ns, k = _ns(key, run_id)
    q("INSERT INTO memory(ns,key,value,run_id,author,updated) VALUES(?,?,?,?,?,?) "
      "ON CONFLICT(ns,key) DO UPDATE SET value=excluded.value, run_id=excluded.run_id, "
      "author=excluded.author, updated=excluded.updated",
      (ns, k, value, run_id if ns != "global" else None, author, now()))
    return ns


def mem_get(key, run_id=None):
    """Önce çalışmanın kendi hafızasına, bulunamazsa global hafızaya bakar."""
    ns, k = _ns(key, run_id)
    row = q("SELECT * FROM memory WHERE ns=? AND key=?", (ns, k), one=True)
    if row is None and ns != "global":
        row = q("SELECT * FROM memory WHERE ns='global' AND key=?", (k,), one=True)
    return _mem_out(row)


def mem_search(text, run_id=None, limit=20):
    like = f"%{text}%"
    nss = ["global"] + ([f"run:{int(run_id)}"] if run_id else [])
    marks = ",".join("?" for _ in nss)
    rows = q(f"SELECT * FROM memory WHERE ns IN ({marks}) AND (key LIKE ? OR value LIKE ?) "
             "ORDER BY updated DESC LIMIT ?", (*nss, like, like, limit))
    return [_mem_out(r) for r in rows]


def mem_list(run_id=None, limit=50):
    return mem_search("", run_id, limit)


# ---- events
def log(run_id, agent, kind, message):
    return q("INSERT INTO events(run_id,ts,agent,kind,message) VALUES(?,?,?,?,?)",
             (run_id, now(), agent, kind, str(message)[:4000]))


def events(run_id, limit=300):
    return list(reversed(q("SELECT * FROM events WHERE run_id=? ORDER BY id DESC LIMIT ?", (run_id, limit))))


def events_after(run_id, after=0, limit=500):
    return q("SELECT * FROM events WHERE run_id=? AND id>? ORDER BY id LIMIT ?", (run_id, int(after or 0), limit))


def state(run_id=None):
    runs = q("SELECT id,prompt,status,cost,budget,created FROM runs ORDER BY id DESC LIMIT 20")
    run_id = run_id or (runs[0]["id"] if runs else None)
    run = get_run(run_id) if run_id else None
    if not run:
        return {"runs": runs, "run": None, "tasks": [], "events": [], "memory": []}
    run = dict(run)
    run.pop("pid", None)
    return {"runs": runs, "run": run, "tasks": list_tasks(run_id),
            "events": events(run_id), "memory": mem_list(run_id)}
