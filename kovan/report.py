"""Çalışma raporu (REPORT.md): plan, görevler, incelemeler, maliyetler, süreler."""
from __future__ import annotations

import time
from pathlib import Path

from . import db

STATUS_TR = {
    "pending": "bekliyor", "in_progress": "çalışıyor", "done": "bitti (incelenmedi)", "approved": "onaylandı",
    "failed": "başarısız", "skipped": "atlandı", "cancelled": "iptal", "rolled_back": "geri alındı",
    "planning": "planlanıyor", "running": "çalışıyor", "cancelling": "iptal ediliyor", "finished": "tamamlandı",
    "partial": "kısmen tamamlandı", "budget": "bütçe tavanında durdu", "error": "hata",
}


def _ts(t):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t)) if t else "–"


def _dur(a, b):
    if not a or not b:
        return "–"
    s = max(0, int(b - a))
    return f"{s // 60} dk {s % 60} sn" if s >= 60 else f"{s} sn"


def _cell(s, n=120):
    return " ".join(str(s or "").split()).replace("|", "\\|")[:n]


def build(run_id) -> str:
    r = db.get_run(run_id)
    if not r:
        raise KeyError(run_id)
    tasks = db.list_tasks(run_id)
    opts = db.run_options(r)
    total_task_cost = sum(t["cost"] or 0 for t in tasks)
    lines = [
        f"# Kovan raporu — çalışma #{r['id']}",
        "",
        f"**İstek:** {r['prompt']}",
        "",
        f"- Durum: **{STATUS_TR.get(r['status'], r['status'])}**",
        f"- Klasör: `{r['workdir']}`",
        f"- Başlangıç: {_ts(r['created'])} · Bitiş: {_ts(r.get('finished'))} · "
        f"Süre: {_dur(r['created'], r.get('finished') or r['updated'])}",
        f"- Maliyet: **${(r['cost'] or 0):.4f}**" + (f" / bütçe ${r['budget']:.2f}" if r["budget"] else " (bütçe yok)"),
        f"- Ayarlar: {', '.join(f'{k}={v}' for k, v in opts.items()) or '–'}",
    ]
    if r.get("summary"):
        lines.append(f"- Özet: {r['summary']}")
    lines += ["", "## Plan", "", "```mermaid", "graph TD"]
    for t in tasks:
        lines.append(f'  T{t["id"]}["#{t["id"]} {_cell(t["title"], 50).replace(chr(34), "")}"]')
        for d in t["depends_on"]:
            lines.append(f"  T{d} --> T{t['id']}")
    lines += ["```", "", "## Görevler", "",
              "| # | Görev | Ajan | Durum | Bağımlılık | Deneme | Maliyet | Süre | Commit |",
              "|---|---|---|---|---|---|---|---|---|"]
    for t in tasks:
        deps = ", ".join(f"#{d}" for d in t["depends_on"]) or "–"
        lines.append(f"| {t['id']} | {_cell(t['title'], 60)} | {t['agent']} | "
                     f"{STATUS_TR.get(t['status'], t['status'])} | {deps} | {t['attempts'] or 0} | "
                     f"${(t['cost'] or 0):.4f} | {_dur(t.get('started'), t.get('finished'))} | "
                     f"{(t.get('commit_sha') or '–')[:8]} |")
    lines += ["", "## Sonuçlar ve incelemeler", ""]
    for t in tasks:
        lines += [f"### #{t['id']} {t['title']}", "", (t["result"] or "_sonuç yok_").strip()[:3000], ""]
        if t["review"]:
            lines += [f"**İnceleme ({t['reviewer']}):**", "", "> " + t["review"].strip()[:1500].replace("\n", "\n> "), ""]
    lines += ["## Maliyet", "",
              f"- Görevler (iş + inceleme): ${total_task_cost:.4f}",
              f"- Planlama ve diğer: ${max(0.0, (r['cost'] or 0) - total_task_cost):.4f}",
              f"- Toplam: ${(r['cost'] or 0):.4f}", "",
              f"_Oluşturulma: {_ts(time.time())} · Kovan_", ""]
    return "\n".join(lines)


def write(run_id) -> Path:
    r = db.get_run(run_id)
    if not r:
        raise KeyError(run_id)
    path = Path(r["workdir"]) / "REPORT.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(build(run_id), encoding="utf-8")
    return path
