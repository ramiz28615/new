import json
import logging

from kovan import config

SAMPLE = """
# yorum
budget = 2.5
workers = 4
planner = 'codex'
git_checkpoints = false
allowed_origins = ["http://localhost:*", "https://ornek.dev"]

[prices.codex]
input = 1.0  # satır sonu yorumu
output = 8.0
"""


def test_mini_toml_matches_tomllib():
    mini = config._mini_toml(SAMPLE)
    assert mini == config.parse_toml(SAMPLE)
    assert mini["prices"]["codex"] == {"input": 1.0, "output": 8.0}


def test_load_merges_file_and_env(kovan_home, monkeypatch):
    (kovan_home / "config.toml").write_text(SAMPLE, encoding="utf-8")
    monkeypatch.setenv("KOVAN_ALLOWED_ORIGINS", "https://a.dev, https://b.dev")
    cfg = config.load()
    assert cfg["budget"] == 2.5 and cfg["workers"] == 4 and cfg["planner"] == "codex"
    assert cfg["git_checkpoints"] is False
    assert cfg["prices"]["codex"]["input"] == 1.0 and cfg["prices"]["claude"]["input"] == 3.0  # derin birleştirme
    assert cfg["allowed_origins"] == ["https://a.dev", "https://b.dev"]
    assert "[prices.codex]" in config.show(cfg)


def test_broken_config_falls_back(kovan_home):
    (kovan_home / "config.toml").write_text("budget = = bozuk", encoding="utf-8")
    cfg = config.load()
    assert cfg["budget"] == config.DEFAULTS["budget"] and "okunamadı" in cfg["_source"]


def test_structured_logging(kovan_home):
    path = config.setup_logging()
    logging.getLogger("kovan.test").info("merhaba", extra={"data": {"x": 1}})
    for h in logging.getLogger("kovan").handlers:
        h.flush()
    line = json.loads(path.read_text(encoding="utf-8").strip().splitlines()[-1])
    assert line["msg"] == "merhaba" and line["data"] == {"x": 1} and line["level"] == "INFO"
