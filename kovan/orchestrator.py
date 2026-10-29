"""Tek prompt -> plan -> paralel ajanlar -> çapraz inceleme -> teslim."""
import json, re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from . import db, agents

PLANNER = """Sen Kovan PLANLAYICI ajanısın. Kullanıcının isteğini 2-6 bağımsız, somut alt göreve böl.
Her görevi en uygun ajana ata: "claude" (mimari, metin, arayüz, dokümantasyon) veya "codex" (algoritma, test, betik, hata ayıklama).
Sadece JSON dizi döndür, başka hiçbir şey yazma. Biçim:
[{{"title": "...", "detail": "ne yapılacak, hangi dosyalar", "agent": "claude"}}]

İSTEK: {prompt}
"""

WORKER = """Sen Kovan ekibinde bir ajansın (çalışma #{run_id}, görev #{task_id}).
Ana istek: {prompt}
Senin görevin: {title}
Ayrıntı: {detail}
{feedback}
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

def _parse_plan(text):
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        return None
    try:
        items = json.loads(m.group(0))
        return [i for i in items if isinstance(i, dict) and i.get("title")]
    except json.JSONDecodeError:
        return None

class Orchestrator:
    def __init__(self, prompt, workdir=".", budget=5.0, workers=3, mock=False, yolo=False,
                 planner="claude", review=True, max_fix_rounds=1, on_event=None):
        self.prompt = prompt
        self.workdir = str(Path(workdir).resolve())
        Path(self.workdir).mkdir(parents=True, exist_ok=True)
        self.budget, self.workers, self.mock, self.yolo = budget, workers, mock, yolo
        self.planner, self.review, self.max_fix_rounds = planner, review, max_fix_rounds
        self.on_event = on_event or (lambda *a: None)
        self.run_id = db.create_run(prompt, self.workdir, budget)

    def _log(self, agent, kind, msg):
        db.log(self.run_id, agent, kind, msg)
        self.on_event(agent, kind, msg)

    def _call(self, agent, prompt):
        res = agents.run(agent, prompt, self.workdir, mock=self.mock, yolo=self.yolo)
        db.add_cost(self.run_id, res.cost)
        return res

    def _over_budget(self):
        r = db.get_run(self.run_id)
        return self.budget and r["cost"] >= self.budget

    def plan(self):
        self._log(self.planner, "plan", "İstek görevlere bölünüyor...")
        res = self._call(self.planner, PLANNER.format(prompt=self.prompt))
        items = _parse_plan(res.text) if res.ok else None
        if not items:
            self._log("kovan", "plan", "Plan çıkarılamadı, tek görev olarak devam.")
            items = [{"title": "İsteği uygula", "detail": self.prompt, "agent": "claude"}]
        for it in items[:8]:
            ag = it.get("agent", "claude")
            db.add_task(self.run_id, it["title"], it.get("detail", ""), ag if ag in ("claude", "codex") else "claude")
        self._log("kovan", "plan", f"{len(items[:8])} görev oluşturuldu.")

    def _work(self, task, feedback=""):
        if self._over_budget():
            db.update_task(task["id"], status="skipped", result="Bütçe tavanı aşıldı")
            self._log("kovan", "budget", f"#{task['id']} bütçe nedeniyle atlandı")
            return
        db.update_task(task["id"], status="in_progress", attempts=task["attempts"] + 1)
        self._log(task["agent"], "start", f"#{task['id']} {task['title']}")
        res = self._call(task["agent"], WORKER.format(
            run_id=self.run_id, task_id=task["id"], prompt=self.prompt, title=task["title"],
            detail=task["detail"], workdir=self.workdir,
            feedback=f"İNCELEME GERİ BİLDİRİMİ (düzelt): {feedback}" if feedback else ""))
        t = db.get_task(task["id"])
        db.update_task(task["id"], status="done" if res.ok else "failed",
                       result=(t["result"] or "") if t["result"] and not feedback else res.text[-4000:])
        self._log(task["agent"], "done" if res.ok else "failed", f"#{task['id']} {res.text[:300]}")

    def _review(self, task):
        reviewer = "codex" if task["agent"] == "claude" else "claude"
        for rnd in range(self.max_fix_rounds + 1):
            t = db.get_task(task["id"])
            if t["status"] != "done" or self._over_budget():
                return
            res = self._call(reviewer, REVIEWER.format(prompt=self.prompt, task_id=t["id"],
                             title=t["title"], result=t["result"] or "", workdir=self.workdir))
            verdict = (res.text.strip().splitlines() or ["APPROVE"])[0] if res.ok else "APPROVE (inceleme çalışmadı)"
            db.update_task(t["id"], review=res.text[:2000], reviewer=reviewer)
            self._log(reviewer, "review", f"#{t['id']} {verdict[:200]}")
            if verdict.upper().startswith("APPROVE") or rnd == self.max_fix_rounds:
                db.update_task(t["id"], status="approved" if verdict.upper().startswith("APPROVE") else "done")
                return
            self._work(t, feedback=res.text[:2000])

    def _pipeline(self, task):
        self._work(task)
        if self.review:
            self._review(task)

    def run(self):
        try:
            self.plan()
            db.update_run(self.run_id, status="running")
            tasks = db.list_tasks(self.run_id)
            with ThreadPoolExecutor(max_workers=self.workers) as ex:
                list(ex.map(self._pipeline, tasks))
            tasks = db.list_tasks(self.run_id)
            ok = sum(t["status"] in ("approved", "done") for t in tasks)
            summary = f"{ok}/{len(tasks)} görev tamamlandı. Klasör: {self.workdir}"
            db.update_run(self.run_id, status="finished", summary=summary)
            self._log("kovan", "finished", summary)
        except Exception as e:
            db.update_run(self.run_id, status="error", summary=str(e))
            self._log("kovan", "error", repr(e))
            raise
        return self.run_id
