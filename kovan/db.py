"""Kovan ortak durum deposu (SQLite). Hem MCP sunucusu hem orkestratör kullanır."""
import json, os, sqlite3, threading, time
from pathlib import Path

_LOCK = threading.Lock()

SCHEMA = """
CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY, prompt TEXT, status TEXT, workdir TEXT,
  budget REAL, cost REAL DEFAULT 0, summary TEXT, created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS tasks(id INTEGER PRIMARY KEY, run_id INTEGER, title TEXT, detail TEXT,
  agent TEXT, status TEXT, result TEXT, reviewer TEXT, review TEXT, attempts INTEGER DEFAULT 0,
  created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS memory(key TEXT PRIMARY KEY, value TEXT, run_id INTEGER, author TEXT, updated REAL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, run_id INTEGER, ts REAL, agent TEXT, kind TEXT, message TEXT);
"""

def db_path() -> Path:
    p = Path(os.environ.get("KOVAN_DB", Path.home() / ".kovan" / "kovan.db")).expanduser()
    p.parent.mkdir(parents=True, exist_ok=True)
    return p

def connect() -> sqlite3.Connection:
    c = sqlite3.connect(db_path(), timeout=30, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.executescript(SCHEMA)
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

now = time.time

# ---- runs
def create_run(prompt, workdir, budget):
    return q("INSERT INTO runs(prompt,status,workdir,budget,created,updated) VALUES(?,?,?,?,?,?)",
             (prompt, "planning", str(workdir), budget, now(), now()))

def update_run(run_id, **kw):
    kw["updated"] = now()
    sets = ",".join(f"{k}=?" for k in kw)
    q(f"UPDATE runs SET {sets} WHERE id=?", (*kw.values(), run_id))

def add_cost(run_id, usd):
    if usd:
        q("UPDATE runs SET cost=cost+? WHERE id=?", (float(usd), run_id))

def get_run(run_id):
    return q("SELECT * FROM runs WHERE id=?", (run_id,), one=True)

def latest_run_id():
    r = q("SELECT id FROM runs ORDER BY id DESC LIMIT 1", one=True)
    return r["id"] if r else None

# ---- tasks
def add_task(run_id, title, detail="", agent="claude"):
    return q("INSERT INTO tasks(run_id,title,detail,agent,status,created,updated) VALUES(?,?,?,?,?,?,?)",
             (run_id, title, detail, agent, "pending", now(), now()))

def update_task(task_id, **kw):
    kw["updated"] = now()
    sets = ",".join(f"{k}=?" for k in kw)
    q(f"UPDATE tasks SET {sets} WHERE id=?", (*kw.values(), task_id))

def get_task(task_id):
    return q("SELECT * FROM tasks WHERE id=?", (task_id,), one=True)

def list_tasks(run_id):
    return q("SELECT * FROM tasks WHERE run_id=? ORDER BY id", (run_id,))

# ---- memory
def mem_set(key, value, run_id=None, author="?"):
    q("INSERT INTO memory(key,value,run_id,author,updated) VALUES(?,?,?,?,?) "
      "ON CONFLICT(key) DO UPDATE SET value=excluded.value, run_id=excluded.run_id, "
      "author=excluded.author, updated=excluded.updated", (key, value, run_id, author, now()))

def mem_get(key):
    return q("SELECT * FROM memory WHERE key=?", (key,), one=True)

def mem_search(text, limit=20):
    like = f"%{text}%"
    return q("SELECT * FROM memory WHERE key LIKE ? OR value LIKE ? ORDER BY updated DESC LIMIT ?",
             (like, like, limit))

# ---- events
def log(run_id, agent, kind, message):
    q("INSERT INTO events(run_id,ts,agent,kind,message) VALUES(?,?,?,?,?)",
      (run_id, now(), agent, kind, str(message)[:4000]))

def events(run_id, limit=200):
    return list(reversed(q("SELECT * FROM events WHERE run_id=? ORDER BY id DESC LIMIT ?", (run_id, limit))))

def state(run_id=None):
    runs = q("SELECT id,prompt,status,cost,budget,created FROM runs ORDER BY id DESC LIMIT 20")
    run_id = run_id or (runs[0]["id"] if runs else None)
    if not run_id:
        return {"runs": [], "run": None, "tasks": [], "events": [], "memory": []}
    return {"runs": runs, "run": get_run(run_id), "tasks": list_tasks(run_id),
            "events": events(run_id), "memory": q("SELECT * FROM memory ORDER BY updated DESC LIMIT 50")}
