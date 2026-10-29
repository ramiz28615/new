// Motor: the local Kovan engine (Python, `kovan dashboard`) — Bearer token + SSE. Ported from Studio 0.2 and kept as its own view.
const TERMINAL = ["finished", "partial", "budget", "cancelled", "error"];
const ST_TR = { pending: "bekliyor", in_progress: "çalışıyor", done: "bitti", approved: "onaylandı", failed: "başarısız", skipped: "atlandı", cancelled: "iptal", rolled_back: "geri alındı" };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function initMotor({ onFiles, toast }) {
  const $ = (id) => document.getElementById(id);
  const K = { engine: "", token: "" };

  // ----- setup commands copy -----
  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", () => {
      const t = b.previousElementSibling.textContent;
      const ok = () => { b.textContent = "Kopyalandı ✓"; setTimeout(() => { b.textContent = "Kopyala"; }, 1500); };
      const fb = () => {
        const ta = document.createElement("textarea"); ta.value = t; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); ok(); } catch (e) { /* ignore */ } ta.remove();
      };
      if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(t).then(ok, fb); else fb();
    });
  });

  // ----- connection -----
  const setChip = (id, name, on) => { $(id).textContent = name + (on == null ? " –" : on ? " ✓" : " ✗"); $(id).classList.toggle("chip--on", !!on); };
  const setMode = (url) => {
    K.engine = url;
    $("en-state").textContent = url ? "Motor bağlı" : "Bağlı değil";
    $("en-state").classList.toggle("chip--on", !!url);
    $("mr-run").disabled = !url;
  };
  const saveToken = (t) => { K.token = t; try { if (t) localStorage.setItem("kovan_token", t); else localStorage.removeItem("kovan_token"); } catch (e) { /* blocked */ } };
  try { K.token = localStorage.getItem("kovan_token") || ""; } catch (e) { K.token = ""; }
  if (K.token) $("en-token").value = K.token;

  $("en-go").addEventListener("click", () => {
    const url = $("en-url").value.trim().replace(/\/+$/, ""), tok = $("en-token").value.trim();
    const ac = new AbortController(), to = setTimeout(() => ac.abort(), 4000);
    $("en-go").disabled = true; $("en-msg").textContent = "Bağlanılıyor…";
    let health = null;
    fetch(url + "/api/health", { signal: ac.signal }).then((r) => {
      if (r.status === 403) throw new Error("origin");
      if (!r.ok) throw new Error("net");
      return r.json();
    }).catch((e) => { throw e && e.message === "origin" ? e : new Error("net"); }).then((h) => {
      if (!h || !h.ok) throw new Error("net");
      health = h;
      if (!tok) throw new Error("notoken");
      return fetch(url + "/api/state?run=0", { headers: { Authorization: "Bearer " + tok }, signal: ac.signal }).catch(() => { throw new Error("net"); });
    }).then((r) => {
      if (r.status === 401) throw new Error("token");
      if (r.status === 403) throw new Error("origin");
      if (!r.ok) throw new Error("net");
      saveToken(tok);
      setChip("en-claude", "Claude", !!health.claude); setChip("en-codex", "Codex", !!health.codex); setMode(url);
      $("en-msg").textContent = "Bağlandı" + (health.version ? " (Kovan " + health.version + ")" : "") + ". Aşağıdan gerçek ajanlarla çalıştırabilirsin.";
    }).catch((e) => {
      const why = e && e.message;
      setMode("");
      if (health) { setChip("en-claude", "Claude", !!health.claude); setChip("en-codex", "Codex", !!health.codex); } else { setChip("en-claude", "Claude"); setChip("en-codex", "Codex"); }
      $("en-msg").textContent = why === "notoken" ? "Motor çalışıyor ama token girilmedi. “kovan dashboard” çıktısındaki token'ı yukarıya yapıştır."
        : why === "token" ? "Token hatalı. “kovan dashboard” çıktısındaki güncel token'ı yapıştır (ya da “kovan token” komutunu çalıştır)."
          : why === "origin" ? "Motor bu sayfanın adresine izin vermiyor. KOVAN_ALLOWED_ORIGINS ayarını kontrol et."
            : "Motora ulaşılamadı. Bilgisayarında “kovan dashboard” açık mı, adres doğru mu? (Başka bir siteden bağlanıyorsan adresini KOVAN_ALLOWED_ORIGINS'e ekle.)";
    }).finally(() => { clearTimeout(to); $("en-go").disabled = false; });
  });

  $("mcp").innerHTML = [["kovan_status", "Görev durumu"], ["kovan_task_list", "Görevleri listele"], ["kovan_task_add", "Görev ekle"], ["kovan_task_update", "Görev güncelle"],
    ["kovan_memory_set", "Hafızaya yaz"], ["kovan_memory_get", "Hafızadan oku"], ["kovan_memory_search", "Hafızada ara"], ["kovan_review_submit", "İnceleme gönder"], ["kovan_log", "Panoya not"]]
    .map((r) => '<tr><th scope="row"><code>' + r[0] + "</code></th><td>" + r[1] + "</td></tr>").join("");

  // ----- run on the engine -----
  function log(agent, text) {
    const cls = /claude/i.test(agent) ? "c" : /codex/i.test(agent) ? "x" : "k";
    $("mr-log").insertAdjacentHTML("beforeend", '<span class="' + cls + '">[' + esc(agent) + "]</span> " + esc(text) + "\n");
    $("mr-log").scrollTop = $("mr-log").scrollHeight;
  }
  function engineFetch(path, opt = {}) {
    const h = { Authorization: "Bearer " + (K.token || "") };
    if (opt.body) h["Content-Type"] = "application/json";
    return fetch(K.engine + path, { method: opt.method || "GET", headers: h, body: opt.body ? JSON.stringify(opt.body) : undefined })
      .catch(() => { throw new Error("Motora ulaşılamadı. Bilgisayarında “kovan dashboard” açık mı?"); })
      .then((r) => r.json().catch(() => ({})).then((d) => {
        if (r.status === 401) throw new Error("Token hatalı ya da eksik. “kovan dashboard” çıktısındaki token'ı yapıştır.");
        if (r.status === 403) throw new Error((d && d.error) || "Motor bu isteği reddetti (izin yok).");
        if (!r.ok) throw new Error((d && d.error) || ("Motor hatası: HTTP " + r.status));
        return d;
      }));
  }

  $("mr-run").addEventListener("click", () => {
    const prompt = $("mr-prompt").value.trim();
    if (!prompt) { $("mr-prompt").focus(); return; }
    let runId = null, es = null, closed = false, refreshT = null, seen = 0;
    $("mr-run").disabled = true; $("mr-log").innerHTML = ""; $("mr-cost").textContent = "$0.00";
    $("mr-tasks").innerHTML = '<li class="muted">Plan bekleniyor…</li>';
    const done = () => {
      closed = true; if (es) { es.close(); es = null; }
      $("mr-run").disabled = !K.engine; $("mr-cancel").hidden = true; $("mr-cancel").onclick = null;
    };
    const renderState = (s) => {
      const run = s.run || {}, tasks = s.tasks || [];
      $("mr-cost").textContent = "$" + (+run.cost || 0).toFixed(2);
      if (tasks.length) $("mr-tasks").innerHTML = tasks.map((t) => {
        const st = String(t.status || "");
        const deps = (t.depends_on || []).length ? " ↳ #" + t.depends_on.join(", #") : "";
        return '<li class="task" data-s="' + esc(st) + '"><b>#' + esc(t.id) + " " + esc(t.title || "") + '</b><span class="chip">' + esc(t.agent || "") + '</span><span class="muted">' + esc((ST_TR[st] || st) + (t.cost ? " · $" + (+t.cost).toFixed(3) : "") + deps) + "</span></li>";
      }).join("");
      return run;
    };
    const refresh = () => engineFetch("/api/state?run=" + encodeURIComponent(runId)).then(renderState);
    const loadFiles = (id) => engineFetch("/api/files?run=" + encodeURIComponent(id)).then((list) => {
      if (list && list.length) {
        const files = {};
        list.forEach((f) => { files[f.path] = f.content; });
        onFiles(files, prompt);
        log("kovan", list.length + " dosya yeni bir Studio projesine aktarıldı");
      }
      done();
    }).catch((e) => { log("kovan", "Dosyalar alınamadı: " + e.message); done(); });
    const finishRun = () => refresh().then((run) => {
      log("kovan", (run.status === "finished" ? "bitti: " : (run.status || "durdu") + ": ") + (run.summary || ""));
      loadFiles(runId);
    }).catch((e) => { log("kovan", e.message); done(); });
    const poll = () => {
      if (closed) return;
      engineFetch("/api/state?run=" + encodeURIComponent(runId)).then((s) => {
        const run = renderState(s);
        (s.events || []).forEach((e) => { if (e.id > seen) { log(String(e.agent || "kovan"), (e.kind ? e.kind + ": " : "") + (e.message || "")); seen = e.id; } });
        if (TERMINAL.indexOf(run.status) >= 0) return finishRun();
        setTimeout(poll, 2000);
      }).catch((e) => { log("kovan", e.message + " 2 sn sonra yeniden denenecek."); setTimeout(poll, 2000); });
    };
    const stream = () => {
      if (!window.EventSource) return poll();
      es = new EventSource(K.engine + "/api/events?run=" + encodeURIComponent(runId) + "&after=" + seen + "&token=" + encodeURIComponent(K.token || ""));
      es.onmessage = (m) => {
        try { const e = JSON.parse(m.data); seen = Math.max(seen, e.id || 0); log(String(e.agent || "kovan"), (e.kind ? e.kind + ": " : "") + (e.message || "")); } catch (x) { /* ignore */ }
        clearTimeout(refreshT); refreshT = setTimeout(() => refresh().catch(() => {}), 250);
      };
      es.addEventListener("end", () => { if (es) { es.close(); es = null; } finishRun(); });
      es.onerror = () => {
        if (!es || closed) return;
        if (es.readyState === 2) { es = null; log("kovan", "Canlı akış kesildi, yoklamaya geçiliyor."); poll(); }
      };
    };
    engineFetch("/api/run", { method: "POST", body: { prompt, workdir: "studio-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-"), budget: +$("mr-budget").value || 5, workers: 3, mock: false } })
      .then((d) => {
        runId = d.run_id; log("kovan", "çalıştırma başladı: #" + runId);
        $("mr-cancel").hidden = false; $("mr-cancel").disabled = false;
        $("mr-cancel").onclick = () => {
          $("mr-cancel").disabled = true;
          engineFetch("/api/runs/" + runId + "/cancel", { method: "POST", body: {} })
            .then(() => log("kovan", "iptal istendi"))
            .catch((e) => { log("kovan", "İptal edilemedi: " + e.message); $("mr-cancel").disabled = false; });
        };
        stream();
      })
      .catch((e) => { log("kovan", e.message); if (toast) toast(e.message, "error"); done(); });
  });
  setMode("");
}
