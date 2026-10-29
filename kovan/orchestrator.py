"""Tek prompt -> plan (DAG) -> paralel ajanlar -> çapraz inceleme -> teslim."""
from __future__ import annotations

import json
import logging
import os
import re
import time
from collections.abc import Iterable
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from pathlib import Path

from . import agents, config, db, gitops

log = logging.getLogger("kovan.orchestrator")

AGENTS = ("claude", "codex")
MAX_TASKS = 8

PLANNER = """Sen Kovan PLANLAYICI ajanısın. Kullanıcının isteğini 2-6 somut alt göreve böl.
Her görevi en uygun ajana ata: "claude" (mimari, metin, arayüz, dokümantasyon)
veya "codex" (algoritma, test, betik, hata ayıklama).
"depends_on": bu görev başlamadan önce bitmesi gereken görevlerin bu listedeki sıra numaraları (0'dan başlar).
Bağımsız görevler için boş liste ver; mümkün olduğunca paralel çalışabilecek bir plan kur ve döngü oluşturma.
Sadece JSON dizi döndür, başka hiçbir şey yazma. Biçim:
[{{"title": "...", "detail": "ne yapılacak, hangi dosyalar", "agent": "claude", "depends_on": []}}]

İSTEK: {prompt}
"""

WORKER = """Sen Kovan ekibinde bir ajansın (çalışma #{run_id}, görev #{task_id}).
Ana istek: {prompt}
Senin görevin: {title}
Ayrıntı: {detail}
{deps}{feedback}
Kurallar:
- Çalışma klasörü: {workdir}. Dosyaları burada oluştur/düzenle.
- Başlarken `kovan_memory_search` ile ortak hafızaya bak; önemli kararları `kovan_memory_set` ile yaz.
- Diğer görevler: `kovan_task_list`. Kendi kapsamının dışına taşma.
- Bitirince `kovan_task_update(task_id={task_id}, status="done", result="özet")` çağır.
- Son mesajında ne yaptığını 3-5 satırda özetle.
"""

REVIEWER = """Sen Kovan İNCELEYİCİ ajanısın. Başka bir ajanın işini kontrol et.
Ana istek: {prompt}
Görev #{task_id}: {title}
Ajanın raporu:
{result}
Çalışma klasörü: {workdir}. İlgili dosyaları oku, gerekirse testleri çalıştır. Dosya DEĞİŞTİRME.
İlk satıra sadece APPROVE ya da CHANGES: <kısa ve net düzeltme listesi> yaz.
"""


class CycleError(ValueError):
    pass


def parse_plan(text: str):
    m = re.search(r"\[.*\]", text or "", re.S)
    if not m:
        return None
    try:
        items = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(items, list):
        return None
    return [i for i in items if isinstance(i, dict) and i.get("title")]


_parse_plan = parse_plan  # 0.1 uyumluluğu


def find_cycle(graph: dict) -> list | None:
    """Yönlü grafikte (düğüm -> bağımlılıkları) döngü arar; varsa döngüdeki düğümleri döner."""
    WHITE, GREY, BLACK = 0, 1, 2
    color = {n: WHITE for n in graph}
    for start in graph:
        if color[start] != WHITE:
            continue
        stack = [(start, iter(graph.get(start, ())))]
        path = [start]
        color[start] = GREY
        while stack:
            node, it = stack[-1]
            nxt = next(it, None)
            if nxt is None:
                stack.pop()
                path.pop()
                color[node] = BLACK
                continue
            if nxt not in color:
                continue
            if color[nxt] == GREY:
                return path[path.index(nxt):] + [nxt]
            if color[nxt] == WHITE:
                color[nxt] = GREY
                path.append(nxt)
                stack.append((nxt, iter(graph.get(nxt, ()))))
    return None


def normalize_plan(items: list) -> tuple[list, list | None]:
    """Plan öğelerini temizler: geçersiz bağımlılıkları atar, döngü varsa döngüdeki bağımlılıkları kaldırır."""
    items = items[:MAX_TASKS]
    n = len(items)
    graph = {}
    for i, it in enumerate(items):
        deps = it.get("depends_on") or []
        if not isinstance(deps, list):
            deps = [deps]
        clean = []
        for d in deps:
            try:
                d = int(d)
            except (TypeError, ValueError):
                continue
            if 0 <= d < n and d != i and d not in clean:
                clean.append(d)
        graph[i] = clean
    cycle = find_cycle(graph)
    if cycle:
        for node in set(cycle):
            graph[node] = [d for d in graph[node] if d not in cycle]
    out = []
    for i, it in enumerate(items):
        ag = it.get("agent", "claude")
        out.append({"title": str(it["title"])[:200], "detail": str(it.get("detail", ""))[:4000],
                    "agent": ag if ag in AGENTS else "claude", "depends_on": graph[i]})
    return out, cycle


def _pid_alive(pid) -> bool:
    if not pid:
        return False
    try:
        os.kill(int(pid), 0)
    except (OSError, ValueError):
        return False
    return True


def cancel_run(run_id) -> str:
    """Çalışmayı iptal eder. Çalışan orkestratör (aynı veya başka süreçte) bunu ~0.5 sn içinde görür
    ve ajan süreç gruplarını sonlandırır. Orkestratör süreci yoksa çalışma doğrudan iptal edilir."""
    r = db.get_run(run_id)
    if not r:
        raise KeyError(run_id)
    if r["status"] in db.TERMINAL_RUN:
        return r["status"]
    db.update_run(run_id, status="cancelling")
    db.log(run_id, "kovan", "cancel", "İptal istendi")
    if not _pid_alive(r.get("pid")) and r.get("pid") != os.getpid():
        for t in db.list_tasks(run_id):
            if t["status"] in ("pending", "in_progress"):
                db.update_task(t["id"], status="cancelled")
        db.update_run(run_id, status="cancelled", summary="İptal edildi", finished=time.time())
        db.log(run_id, "kovan", "cancelled", "Çalışma iptal edildi")
        return "cancelled"
    return "cancelling"


class Orchestrator:
    def __init__(self, prompt="", workdir=".", budget=None, workers=None, mock=False, yolo=False,
                 planner=None, review=None, max_fix_rounds=None, on_event=None, *, timeout=None,
                 retries=None, retry_backoff=None, git=None, run_id=None, cfg=None):
        cfg = cfg or config.load()

        def pick(v, k):
            return cfg[k] if v is None else v

        self.cfg = cfg
        self.budget = float(pick(budget, "budget") or 0)
        self.workers = max(1, min(int(pick(workers, "workers")), 16))
        self.mock, self.yolo = bool(mock), bool(yolo)
        self.planner = pick(planner, "planner") if pick(planner, "planner") in AGENTS else "claude"
        self.review = bool(pick(review, "review"))
        self.max_fix_rounds = int(pick(max_fix_rounds, "max_fix_rounds"))
        self.timeout = float(pick(timeout, "task_timeout"))
        self.retries = max(0, int(pick(retries, "retries")))
        self.retry_backoff = float(pick(retry_backoff, "retry_backoff"))
        self.git = bool(pick(git, "git_checkpoints"))
        self.prices = cfg["prices"]
        self.on_event = on_event or (lambda *a: None)
        self.budget_hit = False
        if run_id:
            r = db.get_run(run_id)
            if not r:
                raise KeyError(f"Çalışma #{run_id} bulunamadı")
            self.run_id, self.prompt, self.workdir = run_id, r["prompt"], r["workdir"]
        else:
            self.prompt = prompt
            self.workdir = str(Path(workdir).expanduser().resolve())
            self.run_id = db.create_run(prompt, self.workdir, self.budget, self.options())
        Path(self.workdir).mkdir(parents=True, exist_ok=True)

    def options(self) -> dict:
        return {"budget": self.budget, "workers": self.workers, "mock": self.mock, "yolo": self.yolo,
                "planner": self.planner, "review": self.review, "max_fix_rounds": self.max_fix_rounds,
                "timeout": self.timeout, "retries": self.retries, "retry_backoff": self.retry_backoff,
                "git": self.git}

    @classmethod
    def resume(cls, run_id, on_event=None, cfg=None, **overrides):
        """Bitmemiş görevleri (pending/failed/skipped/cancelled) yeniden çalıştırmak için hazırlar."""
        r = db.get_run(run_id)
        if not r:
            raise KeyError(f"Çalışma #{run_id} bulunamadı")
        if r["status"] in db.ACTIVE_RUN and _pid_alive(r.get("pid")):
            raise RuntimeError(f"Çalışma #{run_id} hâlâ çalışıyor")
        opts = {**db.run_options(r), **{k: v for k, v in overrides.items() if v is not None}}
        n = db.reset_unfinished(run_id)
        db.update_run(run_id, status="running", summary=None, finished=None)
        db.log(run_id, "kovan", "resume", f"Devam ediliyor: {n} görev yeniden kuyrukta")
        allowed = {"budget", "workers", "mock", "yolo", "planner", "review", "max_fix_rounds", "timeout",
                   "retries", "retry_backoff", "git"}
        return cls(run_id=run_id, on_event=on_event, cfg=cfg, **{k: v for k, v in opts.items() if k in allowed})

    # ---- yardımcılar
    def _log(self, agent, kind, msg):
        db.log(self.run_id, agent, kind, msg)
        self.on_event(agent, kind, msg)
        log.info(kind, extra={"data": {"run": self.run_id, "agent": agent, "msg": str(msg)[:500]}})

    def cancelled(self) -> bool:
        return db.cancel_requested(self.run_id)

    def _over_budget(self) -> bool:
        if not self.budget:
            return False
        if db.get_run(self.run_id)["cost"] >= self.budget:
            self.budget_hit = True
        return self.budget_hit

    def _sleep(self, seconds):
        end = time.monotonic() + seconds
        while time.monotonic() < end and not self.cancelled():
            time.sleep(min(0.2, max(0.0, end - time.monotonic())))

    def _call(self, agent, prompt, task_id=None) -> agents.AgentResult:
        """Ajanı çağırır: bütçe kontrolü, maliyet kaydı, geçici hatalarda üstel geri çekilmeyle yeniden deneme."""
        res = agents.AgentResult(False, "çağrılmadı", agent=agent)
        for attempt in range(self.retries + 1):
            if self._over_budget():
                return agents.AgentResult(False, "Bütçe tavanı aşıldı", budget=True, agent=agent)
            res = agents.run(agent, prompt, self.workdir, mock=self.mock, yolo=self.yolo, timeout=self.timeout,
                             run_id=self.run_id, cancel_check=self.cancelled, prices=self.prices)
            db.add_cost(self.run_id, res.cost, task_id)
            if res.ok or not agents.is_transient(res) or attempt >= self.retries or self.cancelled():
                return res
            delay = self.retry_backoff * (2 ** attempt)
            self._log("kovan", "retry", f"#{task_id or '-'} geçici hata ({res.text[:120]}); "
                                        f"{delay:.1f} sn sonra yeniden denenecek ({attempt + 1}/{self.retries})")
            self._sleep(delay)
        return res

    # ---- plan
    def plan(self):
        self._log(self.planner, "plan", "İstek görevlere bölünüyor...")
        res = self._call(self.planner, PLANNER.format(prompt=self.prompt))
        if res.cancelled or self.cancelled():
            return
        items = parse_plan(res.text) if res.ok else None
        if not items:
            self._log("kovan", "plan", "Plan çıkarılamadı, tek görev olarak devam.")
            items = [{"title": "İsteği uygula", "detail": self.prompt, "agent": "claude"}]
        items, cycle = normalize_plan(items)
        if cycle:
            self._log("kovan", "plan", "Planda döngüsel bağımlılık bulundu ("
                      + " → ".join(str(c) for c in cycle) + "); döngüdeki bağımlılıklar kaldırıldı.")
        ids: list[int] = []
        for it in items:
            ids.append(db.add_task(self.run_id, it["title"], it["detail"], it["agent"],
                                   [ids[d] for d in it["depends_on"]]))
        self._log("kovan", "plan", f"{len(items)} görev oluşturuldu.")

    # ---- iş ve inceleme
    def _work(self, task_id, feedback="") -> bool:
        t = db.get_task(task_id)
        if self.cancelled():
            db.update_task(task_id, status="cancelled")
            return False
        if self._over_budget():
            db.update_task(task_id, status="skipped", result="Bütçe tavanı aşıldı")
            self._log("kovan", "budget", f"#{task_id} bütçe nedeniyle atlandı")
            return False
        db.update_task(task_id, status="in_progress", attempts=(t["attempts"] or 0) + 1,
                       started=t["started"] or time.time())
        self._log(t["agent"], "start", f"#{task_id} {t['title']}")
        deps = db.list_tasks(self.run_id)
        dep_txt = "".join(f"Önce biten görev #{d['id']} ({d['title']}): {(d['result'] or '')[:300]}\n"
                          for d in deps if d["id"] in t["depends_on"])
        res = self._call(t["agent"], WORKER.format(
            run_id=self.run_id, task_id=task_id, prompt=self.prompt, title=t["title"],
            detail=t["detail"], workdir=self.workdir, deps=dep_txt,
            feedback=f"İNCELEME GERİ BİLDİRİMİ (düzelt): {feedback}\n" if feedback else ""), task_id)
        if res.cancelled or self.cancelled():
            db.update_task(task_id, status="cancelled", result="İptal edildi")
            self._log(t["agent"], "cancelled", f"#{task_id} iptal edildi")
            return False
        if res.budget:
            db.update_task(task_id, status="skipped", result="Bütçe tavanı aşıldı")
            self._log("kovan", "budget", f"#{task_id} bütçe nedeniyle atlandı")
            return False
        cur = db.get_task(task_id)
        reported = cur["result"] if cur["result"] and cur["result"] != t["result"] else None
        db.update_task(task_id, status="done" if res.ok else "failed",
                       result=(reported if reported and not feedback else res.text[-4000:]))
        self._log(t["agent"], "done" if res.ok else "failed", f"#{task_id} {res.text[:300]}")
        return res.ok

    def _review(self, task_id):
        t = db.get_task(task_id)
        reviewer = "codex" if t["agent"] == "claude" else "claude"
        for rnd in range(self.max_fix_rounds + 1):
            t = db.get_task(task_id)
            if t["status"] != "done" or self.cancelled():
                return
            if self._over_budget():
                self._log("kovan", "budget", f"#{task_id} incelemesi bütçe nedeniyle atlandı")
                return
            res = self._call(reviewer, REVIEWER.format(prompt=self.prompt, task_id=task_id, title=t["title"],
                                                       result=t["result"] or "", workdir=self.workdir), task_id)
            if res.cancelled or self.cancelled():
                return
            if not res.ok:
                db.update_task(task_id, reviewer=reviewer, review=f"İnceleme çalışmadı: {res.text[:500]}")
                self._log(reviewer, "review", f"#{task_id} inceleme çalışmadı; görev incelenmeden 'done' kaldı")
                return
            verdict = (res.text.strip().splitlines() or ["APPROVE"])[0]
            approved = verdict.upper().lstrip("*# ").startswith("APPROVE")
            db.update_task(task_id, review=res.text[:2000], reviewer=reviewer)
            self._log(reviewer, "review", f"#{task_id} {verdict[:200]}")
            if approved:
                db.update_task(task_id, status="approved")
                return
            if rnd == self.max_fix_rounds:
                return  # düzeltme turları bitti: 'done' olarak kalır
            if not self._work(task_id, feedback=res.text[:2000]):
                return

    def _checkpoint(self, task_id):
        if not self.git:
            return
        t = db.get_task(task_id)
        try:
            sha = gitops.commit(self.workdir, f"kovan: #{task_id} {t['title']}")
        except gitops.GitError as e:
            self._log("kovan", "git", f"#{task_id} commit atılamadı: {e}")
            return
        if sha:
            db.update_task(task_id, commit_sha=sha)
            self._log("kovan", "git", f"#{task_id} kontrol noktası {sha[:8]}")

    def _pipeline(self, task_id):
        try:
            if self._work(task_id) and self.review:
                self._review(task_id)
            if db.get_task(task_id)["status"] in db.OK_TASK:
                self._checkpoint(task_id)
        except Exception as e:  # bir görevin hatası tüm çalışmayı düşürmesin
            log.exception("task crashed")
            db.update_task(task_id, status="failed", result=f"Beklenmeyen hata: {e!r}")
            self._log("kovan", "failed", f"#{task_id} beklenmeyen hata: {e!r}")
        finally:
            db.update_task(task_id, finished=time.time())

    # ---- zamanlayıcı (DAG)
    def _skip(self, t, reason):
        db.update_task(t["id"], status="skipped", result=reason, finished=time.time())
        self._log("kovan", "skipped", f"#{t['id']} atlandı: {reason}")

    def _schedule(self):
        running: dict = {}
        with ThreadPoolExecutor(max_workers=self.workers, thread_name_prefix=f"kovan-{self.run_id}") as ex:
            while True:
                tasks = db.list_tasks(self.run_id)
                by_id = {t["id"]: t for t in tasks}
                busy = set(running.values())
                pending = [t for t in tasks if t["status"] == "pending" and t["id"] not in busy]
                stop = self.cancelled()
                if not stop and pending and self._over_budget():
                    for t in pending:
                        self._skip(t, "Bütçe tavanı aşıldı")
                    pending = []
                ready = []
                for t in pending if not stop else []:
                    deps = [by_id[d] for d in t["depends_on"] if d in by_id]
                    bad = [d for d in deps if d["status"] in db.BAD_TASK and d["id"] not in busy]
                    if bad:
                        self._skip(t, "Bağımlı olduğu görev tamamlanamadı: "
                                   + ", ".join(f"#{d['id']}" for d in bad))
                    elif all(d["status"] in db.OK_TASK and d["id"] not in busy for d in deps):
                        # 'done' inceleme sürerken ara durumdur; bağımlılığın hattı tamamen bitmeli
                        ready.append(t)
                for t in ready[: max(0, self.workers - len(running))]:
                    db.update_task(t["id"], status="in_progress")
                    running[ex.submit(self._pipeline, t["id"])] = t["id"]
                if not running:
                    left = [t for t in db.list_tasks(self.run_id) if t["status"] == "pending"]
                    if stop or not left:
                        break
                    if not ready:  # çalışan yok, hazır görev yok: çözülemeyen bağımlılık / döngü
                        graph = {t["id"]: t["depends_on"] for t in left}
                        cyc = find_cycle(graph)
                        why = ("Döngüsel bağımlılık: " + " → ".join(f"#{c}" for c in cyc)) if cyc \
                            else "Çözülemeyen bağımlılık"
                        for t in left:
                            self._skip(t, why)
                        break
                    continue
                done, _ = wait(list(running), timeout=0.5, return_when=FIRST_COMPLETED)
                for f in done:
                    running.pop(f, None)

    def _finalize(self):
        tasks = db.list_tasks(self.run_id)
        if self.cancelled() and not (tasks and all(t["status"] in db.OK_TASK for t in tasks)):
            for t in tasks:
                if t["status"] in ("pending", "in_progress"):
                    db.update_task(t["id"], status="cancelled")
            status = "cancelled"
        elif self.budget_hit and any(t["status"] not in db.OK_TASK for t in tasks):
            status = "budget"
        elif tasks and all(t["status"] in db.OK_TASK for t in tasks):
            status = "finished"
        else:
            status = "partial"
        tasks = db.list_tasks(self.run_id)
        ok = sum(t["status"] in db.OK_TASK for t in tasks)
        cost = db.get_run(self.run_id)["cost"] or 0
        reason = {"cancelled": " · iptal edildi", "budget": " · bütçe tavanında durdu"}.get(status, "")
        summary = f"{ok}/{len(tasks)} görev tamamlandı{reason} · ${cost:.3f} · Klasör: {self.workdir}"
        db.update_run(self.run_id, status=status, summary=summary, finished=time.time())
        self._log("kovan", status, summary)

    def run(self):
        db.update_run(self.run_id, pid=os.getpid())
        try:
            if self.git and not self.cancelled():
                try:
                    if not gitops.ensure_repo(self.workdir):
                        self._log("kovan", "git", "git bulunamadı; kontrol noktaları kapalı")
                        self.git = False
                except gitops.GitError as e:
                    self._log("kovan", "git", f"git başlatılamadı ({e}); kontrol noktaları kapalı")
                    self.git = False
            if not db.list_tasks(self.run_id) and not self.cancelled():
                db.update_run(self.run_id, status="planning")
                self.plan()
            if not self.cancelled():
                db.update_run(self.run_id, status="running")
                self._schedule()
            self._finalize()
        except Exception as e:
            log.exception("run crashed")
            db.update_run(self.run_id, status="error", summary=str(e), finished=time.time())
            self._log("kovan", "error", repr(e))
            raise
        return self.run_id


def task_graph(tasks: Iterable[dict]) -> dict:
    return {t["id"]: list(t.get("depends_on") or []) for t in tasks}
