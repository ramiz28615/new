"""Git kontrol noktaları: onaylanan her görevden sonra commit, görev başına diff ve geri alma."""
from __future__ import annotations

import shutil
import subprocess
import threading
from pathlib import Path

_LOCK = threading.Lock()
IDENTITY = ["-c", "user.name=Kovan", "-c", "user.email=kovan@localhost", "-c", "commit.gpgsign=false"]


class GitError(RuntimeError):
    pass


def available() -> bool:
    return shutil.which("git") is not None


def _git(workdir, *args, check=True) -> subprocess.CompletedProcess:
    p = subprocess.run(["git", *IDENTITY, *args], cwd=workdir, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if check and p.returncode != 0:
        raise GitError((p.stderr or p.stdout).strip() or f"git {' '.join(args)} başarısız")
    return p


def is_repo(workdir) -> bool:
    return available() and _git(workdir, "rev-parse", "--is-inside-work-tree", check=False).returncode == 0


def toplevel(workdir) -> Path:
    return Path(_git(workdir, "rev-parse", "--show-toplevel").stdout.strip()).resolve()


def ensure_repo(workdir) -> bool:
    """Klasör bir git deposu değilse başlatır. Git yoksa False döner."""
    if not available():
        return False
    with _LOCK:
        if not is_repo(workdir):
            _git(workdir, "init", "-q")
            _git(workdir, "commit", "-q", "--allow-empty", "-m", "kovan: başlangıç")
        elif _git(workdir, "rev-parse", "--verify", "HEAD", check=False).returncode != 0:
            _git(workdir, "commit", "-q", "--allow-empty", "-m", "kovan: başlangıç")
    return True


def commit(workdir, message) -> str | None:
    """Çalışma klasöründeki değişiklikleri commit eder; değişiklik yoksa None döner.

    Klasör daha büyük bir deponun alt klasörüyse yalnızca bu klasörün yolları commit'e girer.
    """
    with _LOCK:
        _git(workdir, "add", "-A", "--", ".")
        if _git(workdir, "diff", "--cached", "--quiet", "--", ".", check=False).returncode == 0:
            return None
        nested = toplevel(workdir) != Path(workdir).resolve()
        _git(workdir, "commit", "-q", "-m", message, *(["--", "."] if nested else []))
        return _git(workdir, "rev-parse", "HEAD").stdout.strip()


def show(workdir, sha) -> str:
    return _git(workdir, "show", "--stat", "--patch", "--format=commit %H%n%s%n", sha).stdout


def revert(workdir, sha) -> str:
    """Görevin commit'ini `git revert` ile geri alır (geçmiş korunur). Yeni commit sha'sını döner."""
    with _LOCK:
        p = _git(workdir, "revert", "--no-edit", sha, check=False)
        if p.returncode != 0:
            _git(workdir, "revert", "--abort", check=False)
            raise GitError("Geri alma çakıştı; sonraki görevler aynı dosyaları değiştirmiş olabilir. "
                           + (p.stderr or p.stdout).strip()[:300])
        return _git(workdir, "rev-parse", "HEAD").stdout.strip()
