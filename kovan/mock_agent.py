"""API anahtarı olmadan Kovan'ı denemek için sahte ajan.

Gerçek CLI'lar gibi ayrı bir süreç olarak çalışır (iptal/zaman aşımı yolları da sınanır).
Prompt stdin'den okunur. Davranış ortam değişkenleriyle ayarlanır:
  KOVAN_MOCK_DELAY   her çağrının süresi (sn, varsayılan 0.1-0.4 arası rastgele)
  KOVAN_MOCK_COST    claude çağrısı başına USD (varsayılan 0)
  KOVAN_MOCK_TOKENS  codex çağrısı başına bildirilen token (varsayılan 0)
  KOVAN_MOCK_PLAN    planlayıcının döneceği JSON plan
  KOVAN_MOCK_FAIL    başlığında bu metin geçen görevler başarısız olur
  KOVAN_MOCK_FLAKY   başlığında bu metin geçen görevler ilk denemede geçici hata verir
"""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import sys
import time
from pathlib import Path

DEFAULT_PLAN = [
    {"title": "Proje iskeletini oluştur", "agent": "claude", "depends_on": []},
    {"title": "Ana özelliği yaz", "agent": "codex", "depends_on": [0]},
    {"title": "Testleri ve README'yi yaz", "agent": "claude", "depends_on": [0]},
]


def reply(agent: str, text: str, ok: bool = True) -> None:
    cost = float(os.environ.get("KOVAN_MOCK_COST") or 0)
    tokens = int(os.environ.get("KOVAN_MOCK_TOKENS") or 0)
    if agent == "claude":
        print(json.dumps({"type": "result", "is_error": not ok, "result": text, "total_cost_usd": cost},
                         ensure_ascii=False))
    else:
        print(text)
        if tokens:
            print(f"tokens used\n{tokens:,}")
    sys.exit(0 if ok else 1)


def main() -> None:
    agent = sys.argv[1] if len(sys.argv) > 1 else "claude"
    prompt = sys.stdin.read()
    delay = os.environ.get("KOVAN_MOCK_DELAY")
    time.sleep(float(delay) if delay else random.uniform(0.1, 0.4))

    if "PLANLAYICI" in prompt:
        plan = os.environ.get("KOVAN_MOCK_PLAN")
        if plan:
            return reply(agent, plan)
        req = prompt.split("İSTEK:", 1)[-1].strip().splitlines()[0][:80] if "İSTEK:" in prompt else ""
        return reply(agent, json.dumps([{**t, "detail": req} for t in DEFAULT_PLAN], ensure_ascii=False))

    if "İNCELEYİCİ" in prompt:
        return reply(agent, "APPROVE\nTemiz görünüyor.")

    m = re.search(r"görev #(\d+)", prompt)
    tid = m.group(1) if m else "0"
    tm = re.search(r"Senin görevin: (.*)", prompt)
    title = tm.group(1).strip() if tm else ""

    fail = os.environ.get("KOVAN_MOCK_FAIL")
    if fail and fail in title:
        return reply(agent, f"Hata: '{title}' başarısız oldu (mock).", ok=False)
    flaky = os.environ.get("KOVAN_MOCK_FLAKY")
    if flaky and flaky in title:
        home = Path(os.environ.get("KOVAN_HOME") or ".")
        marker = home / f"mock-flaky-{hashlib.sha1(title.encode()).hexdigest()[:10]}"
        if not marker.exists():
            marker.write_text("1")
            return reply(agent, "Error: rate limit exceeded (429). Please try again.", ok=False)

    Path(f"gorev-{tid}.md").write_text(f"# {title}\n\n{agent} tarafından yazıldı (mock).\n", encoding="utf-8")
    return reply(agent, f"[{agent} mock] Görev tamamlandı: gorev-{tid}.md")


if __name__ == "__main__":
    main()
