"""Claude Code ve Codex CLI'larını başsız (headless) çalıştıran sarmalayıcılar."""
import json, os, shutil, subprocess, sys, tempfile
from dataclasses import dataclass
from . import db

@dataclass
class AgentResult:
    ok: bool
    text: str
    cost: float = 0.0

def _mcp_env(agent):
    return {"KOVAN_DB": str(db.db_path()), "KOVAN_AGENT": agent}

def available(agent):
    return shutil.which(agent) is not None

def _claude_mcp_config():
    cfg = {"mcpServers": {"kovan": {"command": sys.executable, "args": ["-m", "kovan.server"],
                                    "env": _mcp_env("claude")}}}
    f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(cfg, f); f.close()
    return f.name

def run_claude(prompt, workdir, timeout=900, yolo=False):
    cmd = ["claude", "-p", prompt, "--output-format", "json",
           "--mcp-config", _claude_mcp_config(), "--allowedTools", "mcp__kovan"]
    cmd += ["--dangerously-skip-permissions"] if yolo else ["--permission-mode", "acceptEdits"]
    try:
        p = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return AgentResult(False, "Zaman aşımı")
    out = p.stdout.strip()
    try:
        data = json.loads(out)
        return AgentResult(not data.get("is_error", False) and p.returncode == 0,
                           data.get("result", out), float(data.get("total_cost_usd") or 0))
    except json.JSONDecodeError:
        return AgentResult(p.returncode == 0, out or p.stderr.strip())

def run_codex(prompt, workdir, timeout=900, yolo=False):
    env = _mcp_env("codex")
    env_toml = "{" + ",".join(f'{k}="{v}"' for k, v in env.items()) + "}"
    cmd = ["codex", "exec", "--skip-git-repo-check",
           "-c", f'mcp_servers.kovan.command="{sys.executable}"',
           "-c", 'mcp_servers.kovan.args=["-m","kovan.server"]',
           "-c", f"mcp_servers.kovan.env={env_toml}"]
    cmd += ["--dangerously-bypass-approvals-and-sandbox"] if yolo else ["--full-auto"]
    cmd.append(prompt)
    try:
        p = subprocess.run(cmd, cwd=workdir, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return AgentResult(False, "Zaman aşımı")
    return AgentResult(p.returncode == 0, (p.stdout.strip() or p.stderr.strip())[-6000:])

def run_mock(agent, prompt, workdir, **_):
    """API anahtarı olmadan sistemi denemek için sahte ajan."""
    import time, random
    time.sleep(random.uniform(0.3, 1.0))
    if "JSON" in prompt and "PLANLAYICI" in prompt:
        req = prompt.split("İSTEK:", 1)[-1].strip().splitlines()[0][:80]
        plan = [{"title": "Proje iskeletini oluştur", "detail": req, "agent": "claude"},
                {"title": "Ana özelliği yaz", "detail": req, "agent": "codex"},
                {"title": "Testleri ve README'yi yaz", "detail": req, "agent": "claude"}]
        return AgentResult(True, json.dumps(plan, ensure_ascii=False), 0.0)
    if "İNCELEYİCİ" in prompt:
        return AgentResult(True, "APPROVE\nTemiz görünüyor.", 0.0)
    return AgentResult(True, f"[{agent} mock] Görev tamamlandı.", 0.0)

def run(agent, prompt, workdir, mock=False, yolo=False, timeout=900):
    if mock:
        return run_mock(agent, prompt, workdir)
    if not available(agent):
        other = "codex" if agent == "claude" else "claude"
        if available(other):
            agent = other
        else:
            return AgentResult(False, "Ne `claude` ne `codex` bulundu. Kurup giriş yapın ya da --mock kullanın.")
    fn = run_claude if agent == "claude" else run_codex
    return fn(prompt, workdir, timeout=timeout, yolo=yolo)
