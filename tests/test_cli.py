import shutil

import pytest

from kovan import cli, db


def test_cli_end_to_end(tmp_path, capsys):
    work = tmp_path / "cli-out"
    cli.main(["run", "CLI ile todo", "--mock", "-d", str(work)])
    out = capsys.readouterr().out
    assert "3/3 görev tamamlandı" in out
    rid = db.latest_run_id()
    cli.main(["status", str(rid)])
    assert "approved" in capsys.readouterr().out
    cli.main(["report", str(rid)])
    assert (work / "REPORT.md").exists()
    cli.main(["config"])
    assert "budget" in capsys.readouterr().out
    cli.main(["token"])
    assert len(capsys.readouterr().out.strip()) >= 32
    with pytest.raises(SystemExit):
        cli.main(["cancel", "9999"])


@pytest.mark.skipif(not shutil.which("git"), reason="git yok")
def test_cli_diff_and_rollback(tmp_path, capsys):
    work = tmp_path / "w"
    cli.main(["run", "git", "--mock", "-w", "1", "-d", str(work)])
    rid = db.latest_run_id()
    t = db.list_tasks(rid)[0]
    capsys.readouterr()
    cli.main(["diff", str(rid), "--task", str(t["id"])])
    assert f"gorev-{t['id']}.md" in capsys.readouterr().out
    cli.main(["rollback", str(rid), "--task", str(t["id"])])
    assert db.get_task(t["id"])["status"] == "rolled_back"
    assert not (work / f"gorev-{t['id']}.md").exists()


def test_cli_cancel_finished_run(tmp_path, capsys):
    cli.main(["run", "x", "--mock", "--no-git", "-d", str(tmp_path / "x")])
    rid = db.latest_run_id()
    cli.main(["cancel", str(rid)])
    assert "zaten bitmiş" in capsys.readouterr().out
