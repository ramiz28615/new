import os
import stat

import pytest

from kovan import security


def test_token_created_private_and_stable():
    tok = security.get_token()
    assert len(tok) >= 32
    assert security.get_token() == tok
    if os.name == "posix":
        assert stat.S_IMODE(security.token_path().stat().st_mode) == 0o600
    new = security.rotate_token()
    assert new != tok and security.get_token() == new


def test_token_compare():
    assert security.token_ok("abc", "abc")
    assert not security.token_ok("abd", "abc")
    assert not security.token_ok(None, "abc")
    assert not security.token_ok("", "")
    assert security.bearer("Bearer xyz") == "xyz"
    assert security.bearer("Basic xyz") is None


@pytest.mark.parametrize("origin,ok", [
    ("http://127.0.0.1:5173", True),
    ("http://localhost:3000", True),
    ("http://localhost", True),
    ("https://ramiz28615.github.io", True),
    ("https://ramiz28615.github.io/", True),
    ("https://evil.example", False),
    ("https://ramiz28615.github.io.evil.example", False),
    ("http://localhost.evil.example:80", False),
    ("http://127.0.0.1:80abc", False),
    ("null", False),
    (None, False),
])
def test_origin_allowlist(origin, ok):
    pats = ["http://127.0.0.1:*", "http://localhost:*", "https://ramiz28615.github.io"]
    assert security.origin_allowed(origin, pats) is ok


def test_host_loopback():
    assert security.host_is_loopback("127.0.0.1:7777")
    assert security.host_is_loopback("localhost")
    assert security.host_is_loopback("[::1]:7777")
    assert not security.host_is_loopback("evil.example:7777")
    assert not security.host_is_loopback(None)


def test_path_traversal_blocked(tmp_path):
    root = tmp_path / "root"
    root.mkdir()
    assert security.resolve_under(root, "proje") == (root / "proje").resolve()
    assert security.resolve_under(root, "a/../b") == (root / "b").resolve()
    for bad in ("../x", "../../etc", "/etc", "a/../../x", "x\x00y"):
        with pytest.raises(security.PathError):
            security.resolve_under(root, bad)
    with pytest.raises(security.PathError):
        security.safe_join(root, "/etc/passwd")
    with pytest.raises(security.PathError):
        security.safe_join(root, "../../etc/passwd")
    if os.name == "posix":
        (root / "link").symlink_to("/etc")
        with pytest.raises(security.PathError):
            security.safe_join(root, "link/passwd")
