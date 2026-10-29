"""Pano API'si için güvenlik yardımcıları: token, CORS kaynak listesi, güvenli yol çözümü."""
from __future__ import annotations

import hmac
import os
import secrets
from pathlib import Path
from urllib.parse import urlsplit

from . import config


class PathError(ValueError):
    """İzin verilen kökün dışına çıkan yol."""


def token_path() -> Path:
    return config.home() / "token"


def _write_private(path: Path, text: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)
    try:
        os.chmod(path, 0o600)
    except OSError:  # pragma: no cover - Windows
        pass


def get_token(create: bool = True) -> str:
    """API token'ını döner; yoksa üretir ve ~/.kovan/token dosyasına (chmod 600) yazar."""
    p = token_path()
    if p.exists():
        tok = p.read_text(encoding="utf-8").strip()
        if tok:
            return tok
    if not create:
        return ""
    tok = secrets.token_urlsafe(32)
    _write_private(p, tok + "\n")
    return tok


def rotate_token() -> str:
    tok = secrets.token_urlsafe(32)
    _write_private(token_path(), tok + "\n")
    return tok


def token_ok(provided: str | None, expected: str) -> bool:
    if not provided or not expected:
        return False
    return hmac.compare_digest(provided.encode(), expected.encode())


def bearer(header: str | None) -> str | None:
    if header and header[:7].lower() == "bearer ":
        return header[7:].strip()
    return None


def origin_allowed(origin: str | None, patterns: list[str]) -> bool:
    """Origin izin listesinde mi? Desen sonunda ':*' herhangi bir port demektir."""
    if not origin or origin == "null":
        return False
    origin = origin.rstrip("/").lower()
    for pat in patterns:
        pat = pat.rstrip("/").lower()
        if pat == "*":
            return True
        if pat.endswith(":*"):
            base = pat[:-2]
            if origin == base:
                return True
            if origin.startswith(base + ":") and origin[len(base) + 1:].isdigit():
                return True
        elif origin == pat:
            return True
    return False


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1", "[::1]"}


def host_is_loopback(host_header: str | None) -> bool:
    """DNS rebinding'e karşı: Host başlığı yalnızca loopback olabilir."""
    if not host_header:
        return False
    host = urlsplit("//" + host_header).hostname or ""
    return host in LOOPBACK_HOSTS


def resolve_under(root: Path, requested: str | os.PathLike) -> Path:
    """`requested` yolunu `root` altında çözer; dışarı çıkarsa PathError fırlatır."""
    root = Path(root).expanduser().resolve()
    req = str(requested or "").strip()
    if "\x00" in req:
        raise PathError("Geçersiz yol")
    p = Path(req).expanduser()
    p = (p if p.is_absolute() else root / p).resolve()
    if p != root and root not in p.parents:
        raise PathError(f"Yol izin verilen kökün dışında: {root}")
    return p


def safe_join(base: Path, rel: str) -> Path:
    """Göreli bir dosya yolunu `base` altında güvenle birleştirir (mutlak yol ve '..' kaçışı yasak)."""
    if not rel or Path(rel).is_absolute() or rel.startswith(("/", "\\")):
        raise PathError("Göreli bir dosya yolu gerekli")
    return resolve_under(base, rel)
