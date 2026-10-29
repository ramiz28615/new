"""Claude Code ve Codex CLI'larını başsız (headless) çalıştıran sarmalayıcılar.

Her ajan kendi süreç grubunda başlatılır; böylece iptal ve zaman aşımında tüm alt süreçleriyle
birlikte sonlandırılabilir.
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from . import config, db

log = logging.getLogger("kovan.agents")


@dataclass
class AgentResult:
    ok: bool
    text: str
    cost: float = 0.0
    cancelled: bool = False
    timed_out: bool = False
    budget: bool = False
    agent: str = ""
    tokens: dict = field(default_factory=dict)


@dataclass
class ProcResult:
    returncode: int
    stdout: str
    stderr: str
    cancelled: bool = False
    timed_out: bool = False


def available(agent: str) -> bool:
    return shutil.which(agent) is not None


def _mcp_env(agent: str, run_id=None) -> dict:
    env = {"KOVAN_DB": str(db.db_path()), "KOVAN_AGENT": agent, "KOVAN_HOME": str(config.home())}
    if run_id:
        env["KOVAN_RUN"] = str(run_id)
    return env


# ---- süreç yönetimi
def _kill(p: subprocess.Popen) -> None:
    """Süreci ve tüm alt süreçlerini sonlandırır (önce TERM, sonra KILL)."""
    if p.poll() is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(p.pid, signal.SIGTERM)
        else:  # pragma: no cover - Windows
            p.send_signal(signal.CTRL_BREAK_EVENT)  # type: ignore[attr-defined]
    except (ProcessLookupError, PermissionError, OSError):
        pass
    try:
        p.wait(timeout=3)
    except subprocess.TimeoutExpired:
        try:
            if os.name == "posix":
                os.killpg(p.pid, signal.SIGKILL)
            else:  # pragma: no cover
                p.kill()
        except (ProcessLookupError, PermissionError, OSError):
            pass


def run_process(cmd, cwd, timeout=900.0, stdin_text=None, env=None,
                cancel_check: Callable[[], bool] | None = None) -> ProcResult:
    kw: dict = {}
    if os.name == "posix":
        kw["start_new_session"] = True
    else:  # pragma: no cover - Windows
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP  # type: ignore[attr-defined]
    try:
        p = subprocess.Popen(cmd, cwd=cwd, env=env, text=True, encoding="utf-8", errors="replace",
                             stdin=subprocess.PIPE if stdin_text is not None else subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kw)
    except OSError as e:
        return ProcResult(127, "", f"Başlatılamadı: {e}")
    deadline = time.monotonic() + (timeout or 1e9)
    data = stdin_text
    while True:
        try:
            out, err = p.communicate(input=data, timeout=0.5)
            return ProcResult(p.returncode, out or "", err or "")
        except subprocess.TimeoutExpired:
            data = None
            stop_cancel = bool(cancel_check and cancel_check())
            if stop_cancel or time.monotonic() > deadline:
                _kill(p)
                try:
                    out, err = p.communicate(timeout=5)
                except (subprocess.TimeoutExpired, ValueError):
                    out, err = "", ""
                return ProcResult(p.returncode if p.returncode is not None else -9, out or "", err or "",
                                  cancelled=stop_cancel, timed_out=not stop_cancel)


# ---- çıktı ayrıştırma ve maliyet
def _price(prices: dict, agent: str, kind: str) -> float:
    return float((prices.get(agent) or {}).get(kind, 0.0))


def estimate_cost(agent: str, tokens: dict, prices: dict) -> float:
    if not tokens:
        return 0.0
    if "input" in tokens or "output" in tokens:
        return (tokens.get("input", 0) * _price(prices, agent, "input")
                + tokens.get("output", 0) * _price(prices, agent, "output")) / 1_000_000
    return tokens.get("total", 0) * _price(prices, agent, "blended") / 1_000_000


_NUM = r"([\d][\d,._]*)"


def _int(s: str) -> int:
    return int(re.sub(r"[^\d]", "", s) or 0)


def parse_codex_usage(text: str) -> dict:
    """Codex çıktısından token kullanımını çıkarır.

    Desteklenen biçimler: `--json` olay satırları ({"usage": {"input_tokens": ..}}) ve
    düz metin sonundaki "tokens used: 12,345" / "tokens used\\n12,345".
    """
    tokens = {"input": 0, "output": 0}
    found = False
    for m in re.finditer(r'"input_tokens"\s*:\s*(\d+)', text):
        tokens["input"] += int(m.group(1))
        found = True
    for m in re.finditer(r'"output_tokens"\s*:\s*(\d+)', text):
        tokens["output"] += int(m.group(1))
        found = True
    if found:
        return tokens
    m = re.search(r"tokens used[:\s]*" + _NUM, text, re.I)
    if m:
        return {"total": _int(m.group(1))}
    return {}


def parse_claude(proc: ProcResult, prices: dict) -> AgentResult:
    out = proc.stdout.strip()
    try:
        data = json.loads(out)
        if not isinstance(data, dict):
            raise ValueError
    except ValueError:
        return AgentResult(proc.returncode == 0, (out or proc.stderr.strip())[-6000:], agent="claude")
    cost = data.get("total_cost_usd")
    usage = data.get("usage") or {}
    tokens = {"input": int(usage.get("input_tokens") or 0), "output": int(usage.get("output_tokens") or 0)}
    if cost is None:
        cost = estimate_cost("claude", tokens, prices)
    ok = proc.returncode == 0 and not data.get("is_error", False)
    return AgentResult(ok, str(data.get("result", out)), float(cost or 0), agent="claude", tokens=tokens)


def parse_codex(proc: ProcResult, prices: dict) -> AgentResult:
    text = (proc.stdout.strip() or proc.stderr.strip())
    tokens = parse_codex_usage(proc.stdout + "\n" + proc.stderr)
    return AgentResult(proc.returncode == 0, text[-6000:], estimate_cost("codex", tokens, prices),
                       agent="codex", tokens=tokens)


TRANSIENT = re.compile(r"rate.?limit|\b429\b|\b50[234]\b|overloaded|temporar|try again|ECONNRESET|"
                       r"ETIMEDOUT|connection (reset|refused|error)|network error|stream error", re.I)


def is_transient(res: AgentResult) -> bool:
    """Yeniden denemeye değer geçici bir hata mı? (zaman aşımı ve iptal değildir)"""
    if res.ok or res.cancelled or res.timed_out or res.budget:
        return False
    return bool(TRANSIENT.search(res.text or "")) or not (res.text or "").strip()


# ---- komutlar
def _claude_mcp_config(run_id) -> str:
    d = config.home() / "mcp"
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"claude-run-{run_id or 'global'}.json"
    cfg = {"mcpServers": {"kovan": {"command": sys.executable, "args": ["-m", "kovan.server"],
                                    "env": _mcp_env("claude", run_id)}}}
    path.write_text(json.dumps(cfg), encoding="utf-8")
    return str(path)


def claude_cmd(prompt, run_id=None, yolo=False):
    cmd = ["claude", "-p", prompt, "--output-format", "json",
           "--mcp-config", _claude_mcp_config(run_id), "--allowedTools", "mcp__kovan"]
    cmd += ["--dangerously-skip-permissions"] if yolo else ["--permission-mode", "acceptEdits"]
    return cmd


def codex_cmd(prompt, run_id=None, yolo=False):
    env = _mcp_env("codex", run_id)
    env_toml = "{" + ",".join(f"{k}={json.dumps(v)}" for k, v in env.items()) + "}"
    cmd = ["codex", "exec", "--skip-git-repo-check",
           "-c", f"mcp_servers.kovan.command={json.dumps(sys.executable)}",
           "-c", 'mcp_servers.kovan.args=["-m","kovan.server"]',
           "-c", f"mcp_servers.kovan.env={env_toml}"]
    cmd += ["--dangerously-bypass-approvals-and-sandbox"] if yolo else ["--full-auto"]
    cmd.append(prompt)
    return cmd


def run(agent, prompt, workdir, mock=False, yolo=False, timeout=900, run_id=None,
        cancel_check=None, prices=None) -> AgentResult:
    prices = prices if prices is not None else config.load()["prices"]
    env = None
    if mock:
        cmd = [sys.executable, "-m", "kovan.mock_agent", agent]
        env = {**os.environ, **_mcp_env(agent, run_id)}
        pkg_parent = str(Path(__file__).resolve().parent.parent)
        env["PYTHONPATH"] = os.pathsep.join(x for x in (pkg_parent, env.get("PYTHONPATH")) if x)
        proc = run_process(cmd, workdir, timeout, stdin_text=prompt, env=env, cancel_check=cancel_check)
    else:
        if not available(agent):
            other = "codex" if agent == "claude" else "claude"
            if not available(other):
                return AgentResult(False, "Ne `claude` ne `codex` bulundu. Kurup giriş yapın ya da --mock kullanın.",
                                   agent=agent)
            agent = other
        cmd = claude_cmd(prompt, run_id, yolo) if agent == "claude" else codex_cmd(prompt, run_id, yolo)
        proc = run_process(cmd, workdir, timeout, cancel_check=cancel_check)
    res = parse_claude(proc, prices) if agent == "claude" else parse_codex(proc, prices)
    res.agent = agent
    if proc.cancelled:
        res.ok, res.cancelled, res.text = False, True, "İptal edildi"
    elif proc.timed_out:
        res.ok, res.timed_out, res.text = False, True, f"Zaman aşımı ({timeout} sn)"
    log.info("agent call", extra={"data": {"agent": agent, "run": run_id, "ok": res.ok, "cost": res.cost,
                                           "rc": proc.returncode, "cancelled": proc.cancelled,
                                           "timed_out": proc.timed_out}})
    return res
