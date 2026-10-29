import os

import pytest


@pytest.fixture(autouse=True)
def kovan_home(tmp_path, monkeypatch):
    """Her test kendi yalıtılmış Kovan ev klasörünü, veritabanını ve proje kökünü kullanır."""
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.toml").write_text("retry_backoff = 0.0\ntask_timeout = 30\n", encoding="utf-8")
    monkeypatch.setenv("KOVAN_HOME", str(home))
    monkeypatch.setenv("KOVAN_DB", str(home / "kovan.db"))
    monkeypatch.setenv("KOVAN_PROJECTS_ROOT", str(tmp_path / "projects"))
    monkeypatch.setenv("KOVAN_MOCK_DELAY", "0.05")
    for k in ("KOVAN_RUN", "KOVAN_MOCK_PLAN", "KOVAN_MOCK_FAIL", "KOVAN_MOCK_FLAKY", "KOVAN_MOCK_COST",
              "KOVAN_MOCK_TOKENS", "KOVAN_ALLOWED_ORIGINS"):
        monkeypatch.delenv(k, raising=False)
    os.environ.pop("KOVAN_RUN", None)
    return home
