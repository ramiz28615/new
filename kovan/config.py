"""Kovan yapılandırması ve günlükleme.

Öncelik sırası: varsayılanlar < ~/.kovan/config.toml < ortam değişkenleri < komut satırı.
Kovan'ın ev klasörü KOVAN_HOME ile değiştirilebilir (varsayılan ~/.kovan).
"""
from __future__ import annotations

import copy
import json
import logging
import os
import time
from pathlib import Path
from typing import Any

DEFAULTS: dict[str, Any] = {
    "budget": 5.0,  # USD; 0 = sınırsız
    "workers": 3,
    "planner": "claude",
    "review": True,
    "max_fix_rounds": 1,
    "task_timeout": 900,  # saniye, her ajan çağrısı için
    "retries": 1,  # geçici hatalarda yeniden deneme sayısı
    "retry_backoff": 2.0,  # saniye; her denemede iki katına çıkar
    "git_checkpoints": True,
    "projects_root": "~/kovan-projects",  # web API'nin çalışma klasörü kökü
    "max_body_bytes": 1_048_576,
    "allowed_origins": [
        "http://127.0.0.1:*",
        "http://localhost:*",
        "https://ramiz28615.github.io",
    ],
    # USD / 1 milyon token. Claude kendi maliyetini bildirir; tablo yalnızca yedek tahmindir.
    "prices": {
        "claude": {"input": 3.0, "output": 15.0, "blended": 6.0},
        "codex": {"input": 1.25, "output": 10.0, "blended": 3.0},
    },
}

log = logging.getLogger("kovan")


def home() -> Path:
    p = Path(os.environ.get("KOVAN_HOME") or Path.home() / ".kovan").expanduser()
    p.mkdir(parents=True, exist_ok=True)
    return p


def config_path() -> Path:
    return home() / "config.toml"


def _mini_toml(text: str) -> dict:
    """tomllib olmayan Python 3.10 için küçük TOML okuyucu (düz anahtarlar, tablolar, diziler)."""
    out: dict = {}
    cur = out
    for raw in text.splitlines():
        line = raw.split(" #", 1)[0].strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            cur = out
            for part in line[1:-1].strip().split("."):
                cur = cur.setdefault(part.strip().strip('"'), {})
            continue
        if "=" not in line:
            raise ValueError(f"Geçersiz satır: {raw!r}")
        key, val = (s.strip() for s in line.split("=", 1))
        if val.startswith("'") and val.endswith("'"):
            cur[key] = val[1:-1]
        else:
            cur[key] = json.loads(val.replace("'", '"'))
    return out


def parse_toml(text: str) -> dict:
    try:
        import tomllib  # Python 3.11+
    except ImportError:  # pragma: no cover - 3.10
        try:
            import tomli as tomllib  # type: ignore[no-redef]
        except ImportError:
            return _mini_toml(text)
    return tomllib.loads(text)


def _merge(base: dict, extra: dict) -> dict:
    for k, v in extra.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _merge(base[k], v)
        else:
            base[k] = v
    return base


def load() -> dict:
    """Geçerli (etkin) yapılandırmayı döner."""
    cfg = copy.deepcopy(DEFAULTS)
    path = config_path()
    cfg["_source"] = "varsayılanlar"
    if path.exists():
        try:
            _merge(cfg, parse_toml(path.read_text(encoding="utf-8")))
            cfg["_source"] = str(path)
        except Exception as e:  # bozuk dosya Kovan'ı durdurmasın
            log.warning("config okunamadı", extra={"data": {"path": str(path), "error": str(e)}})
            cfg["_source"] = f"varsayılanlar ({path} okunamadı: {e})"
    if os.environ.get("KOVAN_ALLOWED_ORIGINS"):
        cfg["allowed_origins"] = [o.strip() for o in os.environ["KOVAN_ALLOWED_ORIGINS"].split(",") if o.strip()]
    if os.environ.get("KOVAN_PROJECTS_ROOT"):
        cfg["projects_root"] = os.environ["KOVAN_PROJECTS_ROOT"]
    return cfg


def projects_root(cfg: dict | None = None) -> Path:
    cfg = cfg or load()
    p = Path(cfg["projects_root"]).expanduser().resolve()
    p.mkdir(parents=True, exist_ok=True)
    return p


class _JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        data = getattr(record, "data", None)
        if data:
            entry["data"] = data
        if record.exc_info:
            entry["exc"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False, default=str)


def setup_logging() -> Path:
    """~/.kovan/kovan.log dosyasına JSON satırları yazan günlükleyiciyi kurar (tekrar çağrılabilir)."""
    path = home() / "kovan.log"
    for h in log.handlers:
        if getattr(h, "_kovan_path", None) == str(path):
            return path
    for h in list(log.handlers):
        if getattr(h, "_kovan_path", None):
            log.removeHandler(h)
            h.close()
    handler = logging.FileHandler(path, encoding="utf-8")
    handler._kovan_path = str(path)  # type: ignore[attr-defined]
    handler.setFormatter(_JsonFormatter())
    log.addHandler(handler)
    log.setLevel(os.environ.get("KOVAN_LOG_LEVEL", "INFO").upper())
    log.propagate = False
    return path


def show(cfg: dict) -> str:
    """`kovan config` çıktısı: etkin değerleri TOML biçiminde."""
    lines = [f"# Kaynak: {cfg.get('_source')}", f"# Dosya: {config_path()}", ""]
    tables = []
    for k, v in cfg.items():
        if k.startswith("_"):
            continue
        if isinstance(v, dict):
            tables.append((k, v))
        else:
            lines.append(f"{k} = {json.dumps(v, ensure_ascii=False)}")
    for name, tbl in tables:
        for sub, vals in tbl.items():
            if isinstance(vals, dict):
                lines += ["", f"[{name}.{sub}]"] + [f"{a} = {json.dumps(b)}" for a, b in vals.items()]
            else:
                lines += ["", f"[{name}]", f"{sub} = {json.dumps(vals)}"]
    return "\n".join(lines)
