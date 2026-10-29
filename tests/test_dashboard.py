import http.client
import json
import threading
import time

import pytest

from kovan import config, db
from kovan.dashboard import make_server

TOKEN = "test-token-1234567890"


@pytest.fixture
def srv():
    s = make_server("127.0.0.1", 0, token=TOKEN, cfg=config.load())
    th = threading.Thread(target=s.serve_forever, daemon=True)
    th.start()
    yield s
    s.shutdown()
    s.server_close()


def call(srv, method, path, body=None, token=TOKEN, headers=None, raw=None):
    c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
    h = dict(headers or {})
    if token:
        h["Authorization"] = f"Bearer {token}"
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    if data is not None:
        h["Content-Type"] = "application/json"
    c.request(method, path, body=data, headers=h)
    r = c.getresponse()
    text = r.read().decode()
    c.close()
    try:
        payload = json.loads(text)
    except ValueError:
        payload = text
    return r.status, dict(r.getheaders()), payload


def wait_run(run_id, timeout=20):
    end = time.time() + timeout
    while time.time() < end:
        if db.get_run(run_id)["status"] in db.TERMINAL_RUN:
            return db.get_run(run_id)
        time.sleep(0.1)
    raise AssertionError("çalışma bitmedi")


def test_health_is_public(srv):
    st, _, body = call(srv, "GET", "/api/health", token=None)
    assert st == 200 and body["ok"] is True and "version" in body


def test_index_page_is_public(srv):
    st, h, body = call(srv, "GET", "/", token=None)
    assert st == 200 and "Kovan" in body and h["X-Frame-Options"] == "DENY"
    assert TOKEN not in body


@pytest.mark.parametrize("path", ["/api/state", "/api/files", "/api/events", "/api/runs/1/report"])
def test_auth_rejects_missing_token(srv, path):
    st, _, body = call(srv, "GET", path, token=None)
    assert st == 401 and "Token" in body["error"]


def test_auth_rejects_wrong_token_and_post_without_token(srv):
    assert call(srv, "GET", "/api/state", token="yanlis")[0] == 401
    assert call(srv, "POST", "/api/run", {"prompt": "x", "mock": True}, token=None)[0] == 401
    # POST için ?token= kabul edilmez (yalnızca başlık)
    assert call(srv, "POST", f"/api/run?token={TOKEN}", {"prompt": "x", "mock": True}, token=None)[0] == 401
    assert call(srv, "POST", "/api/runs/1/cancel", {}, token=None)[0] == 401


def test_auth_accepts_bearer_and_query_token_on_get(srv):
    assert call(srv, "GET", "/api/state")[0] == 200
    assert call(srv, "GET", f"/api/state?token={TOKEN}", token=None)[0] == 200


def test_cors_allowlist(srv):
    st, h, _ = call(srv, "GET", "/api/health", token=None, headers={"Origin": "https://evil.example"})
    assert st == 403 and "Access-Control-Allow-Origin" not in h
    st, h, _ = call(srv, "OPTIONS", "/api/run", token=None, headers={"Origin": "https://evil.example"})
    assert st == 403 and "Access-Control-Allow-Origin" not in h
    st, h, _ = call(srv, "OPTIONS", "/api/run", token=None, headers={"Origin": "https://ramiz28615.github.io"})
    assert st == 204 and h["Access-Control-Allow-Origin"] == "https://ramiz28615.github.io"
    assert "Authorization" in h["Access-Control-Allow-Headers"]
    st, h, _ = call(srv, "GET", "/api/state", headers={"Origin": "http://localhost:5173"})
    assert st == 200 and h["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert h.get("Access-Control-Allow-Origin") != "*"
    # 401 yanıtı da izinli kaynağa CORS başlığıyla döner (Studio net hata gösterebilsin)
    st, h, _ = call(srv, "GET", "/api/state", token=None, headers={"Origin": "https://ramiz28615.github.io"})
    assert st == 401 and h["Access-Control-Allow-Origin"] == "https://ramiz28615.github.io"


def test_cors_env_override(monkeypatch):
    monkeypatch.setenv("KOVAN_ALLOWED_ORIGINS", "https://ornek.dev")
    s = make_server("127.0.0.1", 0, token=TOKEN, cfg=config.load())
    th = threading.Thread(target=s.serve_forever, daemon=True)
    th.start()
    try:
        assert call(s, "GET", "/api/health", headers={"Origin": "https://ornek.dev"})[0] == 200
        assert call(s, "GET", "/api/health", headers={"Origin": "https://ramiz28615.github.io"})[0] == 403
    finally:
        s.shutdown()
        s.server_close()


def test_dns_rebinding_host_rejected(srv):
    st, _, _ = call(srv, "GET", "/api/health", token=None, headers={"Host": "evil.example:7777"})
    assert st == 421


def test_yolo_rejected_without_flag(srv):
    st, _, body = call(srv, "POST", "/api/run", {"prompt": "x", "mock": True, "yolo": True})
    assert st == 403 and "yolo" in body["error"]


def test_workdir_traversal_blocked(srv):
    for wd in ("../../etc", "/etc", "a/../../x"):
        st, _, body = call(srv, "POST", "/api/run", {"prompt": "x", "mock": True, "workdir": wd})
        assert st == 403, wd


def test_body_limit_and_bad_json(srv):
    big = json.dumps({"prompt": "x" * (srv.cfg["max_body_bytes"] + 10)}).encode()
    assert call(srv, "POST", "/api/run", raw=big)[0] == 413
    assert call(srv, "POST", "/api/run", raw=b"{bozuk")[0] == 400
    assert call(srv, "POST", "/api/run", {"prompt": " "})[0] == 400
    assert call(srv, "POST", "/api/run", {"prompt": "x", "workers": 99})[0] == 400


def test_full_mock_run_via_api_with_sse(srv):
    st, _, body = call(srv, "POST", "/api/run", {"prompt": "API ile todo", "mock": True, "workdir": "api-todo"})
    assert st == 200
    rid = body["run_id"]
    assert body["workdir"].startswith(str(srv.root))

    # SSE: olaylar akar ve 'end' ile kapanır
    c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=30)
    c.request("GET", f"/api/events?run={rid}&after=0&token={TOKEN}")
    r = c.getresponse()
    assert r.status == 200 and r.getheader("Content-Type").startswith("text/event-stream")
    raw = r.read().decode()
    c.close()
    assert "data: " in raw and "event: end" in raw
    ids = [int(line[4:]) for line in raw.splitlines() if line.startswith("id: ")]
    assert ids == sorted(ids) and len(ids) >= 5

    run = wait_run(rid)
    assert run["status"] == "finished"
    st, _, s = call(srv, "GET", f"/api/state?run={rid}")
    assert len(s["tasks"]) == 3 and all(t["status"] == "approved" for t in s["tasks"])
    assert "cost" in s["tasks"][0] and "depends_on" in s["tasks"][0]

    # after= ile yalnızca yeni olaylar
    c = http.client.HTTPConnection("127.0.0.1", srv.server_address[1], timeout=10)
    c.request("GET", f"/api/events?run={rid}&after={ids[-1]}", headers={"Authorization": f"Bearer {TOKEN}"})
    tail = c.getresponse().read().decode()
    c.close()
    assert "id: " not in tail and "event: end" in tail

    st, _, files = call(srv, "GET", f"/api/files?run={rid}")
    assert st == 200 and any(f["path"].startswith("gorev-") and "content" in f for f in files)
    st, _, one = call(srv, "GET", f"/api/files?run={rid}&path={files[0]['path']}")
    assert st == 200 and one["content"]
    st, h, md = call(srv, "GET", f"/api/runs/{rid}/report")
    assert st == 200 and "Kovan raporu" in md and h["Content-Type"].startswith("text/markdown")
    task = s["tasks"][0]
    if task.get("commit_sha"):
        st, _, diff = call(srv, "GET", f"/api/runs/{rid}/tasks/{task['id']}/diff")
        assert st == 200 and "commit" in diff


def test_files_path_traversal_blocked(srv, tmp_path):
    secret = tmp_path / "gizli.txt"
    secret.write_text("gizli")
    work = srv.root / "w"
    work.mkdir(parents=True)
    (work / "a.txt").write_text("a")
    rid = db.create_run("x", str(work), 1)
    for bad in ("../../gizli.txt", "/etc/passwd", "../" * 10 + "etc/passwd", "%2e%2e/%2e%2e/gizli.txt"):
        st, _, _ = call(srv, "GET", f"/api/files?run={rid}&path={bad}")
        assert st in (403, 404), bad
    st, _, body = call(srv, "GET", f"/api/files?run={rid}&path=a.txt")
    assert st == 200 and body["content"] == "a"
    # dışarı işaret eden sembolik bağ listelenmez
    (work / "kacis").symlink_to(secret)
    st, _, files = call(srv, "GET", f"/api/files?run={rid}")
    assert [f["path"] for f in files] == ["a.txt"]


def test_cancel_via_api(srv, monkeypatch):
    monkeypatch.setenv("KOVAN_MOCK_DELAY", "20")
    st, _, body = call(srv, "POST", "/api/run", {"prompt": "yavaş", "mock": True})
    rid = body["run_id"]
    time.sleep(1.0)
    st, _, body = call(srv, "POST", f"/api/runs/{rid}/cancel", {})
    assert st == 200 and body["status"] in ("cancelling", "cancelled")
    assert wait_run(rid, 15)["status"] == "cancelled"
    assert call(srv, "POST", "/api/runs/9999/cancel", {})[0] == 404
