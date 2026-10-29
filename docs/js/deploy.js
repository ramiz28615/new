// Real deploy to GitHub (repo + one commit via the Git Data API) and GitHub Pages, straight from the browser.
import { isDataUrl, dataUrlToBytes, bytesToBase64, slugify } from "./vfs.js";

const API = "https://api.github.com";

export class DeployError extends Error {
  constructor(code, message, status = 0) { super(message); this.name = "DeployError"; this.code = code; this.status = status; }
}

function gh(token, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  return async function call(method, path, body, okStatuses = []) {
    let res;
    try {
      res = await doFetch(API + path, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new DeployError("network", "GitHub'a ulaşılamadı: " + (e && e.message || e));
    }
    const text = await res.text().catch(() => "");
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
    if (!res.ok && !okStatuses.includes(res.status)) {
      const msg = (data && data.message) || "HTTP " + res.status;
      const code = res.status === 401 ? "auth" : res.status === 403 ? (/rate limit/i.test(msg) ? "rate" : "scope") : res.status === 404 ? "notfound" : res.status === 422 ? "invalid" : "http";
      throw new DeployError(code, msg, res.status);
    }
    return { status: res.status, data };
  };
}

export function sanitizeRepoName(name) { return slugify(name, "kovan-site").replace(/\.git$/, "").slice(0, 100); }

export function pagesUrl(owner, repo) {
  const o = String(owner).toLowerCase();
  return repo.toLowerCase() === o + ".github.io" ? `https://${o}.github.io/` : `https://${o}.github.io/${repo}/`;
}

/**
 * Push the project to GitHub and (for web projects) enable Pages.
 * @param {{token:string, repo:string, files:Record<string,string>, message?:string, pages?:boolean, private?:boolean,
 *          fetchImpl?:Function, onLog?:(s:string)=>void, sleep?:(ms:number)=>Promise<void>, pollMs?:number, maxPolls?:number}} o
 * @returns {Promise<{owner:string, repo:string, url:string|null, repoUrl:string, commit:string, pagesStatus:string, actionsUrl:string|null, runUrl:string|null}>}
 */
export async function deployToGitHub(o) {
  const log = o.onLog || (() => {});
  const sleep = o.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const pollMs = o.pollMs ?? 4000, maxPolls = o.maxPolls ?? 45;
  const call = gh(o.token, o.fetchImpl);
  const repo = sanitizeRepoName(o.repo);
  if (!o.token) throw new DeployError("auth", "GitHub token girilmedi.");
  if (!Object.keys(o.files || {}).length) throw new DeployError("empty", "Yayınlanacak dosya yok.");

  log("GitHub hesabı doğrulanıyor…");
  const me = (await call("GET", "/user")).data;
  const owner = me.login;
  log("Hesap: " + owner);

  let info = await call("GET", `/repos/${owner}/${repo}`, null, [404]);
  if (info.status === 404) {
    log(`“${repo}” deposu oluşturuluyor…`);
    info = await call("POST", "/user/repos", {
      name: repo, description: "Kovan Studio ile oluşturuldu", private: !!o.private, auto_init: true,
      homepage: o.pages ? pagesUrl(owner, repo) : undefined, has_wiki: false,
    });
    log("Depo oluşturuldu.");
  } else {
    log("Depo bulundu: " + owner + "/" + repo);
  }
  const branch = (info.data && info.data.default_branch) || "main";

  // Wait for the initial commit of a freshly created repo.
  let head = null;
  for (let i = 0; i < 10; i++) {
    const r = await call("GET", `/repos/${owner}/${repo}/git/ref/heads/${branch}`, null, [404, 409]);
    if (r.status === 200) { head = r.data.object.sha; break; }
    if (i === 0 && r.status === 409) {
      // Empty repository: create the first commit through the contents API so the Git Data API works.
      log("Boş depo; ilk commit hazırlanıyor…");
      await call("PUT", `/repos/${owner}/${repo}/contents/.nojekyll`, { message: "Kovan: ilk commit", content: "", branch });
      continue;
    }
    await sleep(Math.min(pollMs, 1500));
  }
  if (!head) throw new DeployError("http", "Depo dalı hazır değil, birazdan tekrar dene.");

  log(Object.keys(o.files).length + " dosya yükleniyor…");
  const tree = [];
  const all = { ...o.files };
  if (o.pages && all[".nojekyll"] == null) all[".nojekyll"] = "";
  for (const [path, content] of Object.entries(all)) {
    if (isDataUrl(content)) {
      const blob = await call("POST", `/repos/${owner}/${repo}/git/blobs`, { content: bytesToBase64(dataUrlToBytes(content)), encoding: "base64" });
      tree.push({ path, mode: "100644", type: "blob", sha: blob.data.sha });
    } else {
      tree.push({ path, mode: "100644", type: "blob", content: String(content) });
    }
  }
  const t = await call("POST", `/repos/${owner}/${repo}/git/trees`, { tree });
  const c = await call("POST", `/repos/${owner}/${repo}/git/commits`, { message: o.message || "Kovan Studio ile güncellendi", tree: t.data.sha, parents: [head] });
  await call("PATCH", `/repos/${owner}/${repo}/git/refs/heads/${branch}`, { sha: c.data.sha, force: false });
  const commit = c.data.sha;
  log("Commit gönderildi: " + commit.slice(0, 7));

  const repoUrl = `https://github.com/${owner}/${repo}`;
  const hasWorkflow = Object.keys(o.files).some((p) => p.startsWith(".github/workflows/"));
  const result = { owner, repo, url: null, repoUrl, commit, pagesStatus: "none", actionsUrl: hasWorkflow ? repoUrl + "/actions" : null, runUrl: null };

  if (o.pages) {
    const pg = await call("GET", `/repos/${owner}/${repo}/pages`, null, [404]);
    if (pg.status === 404) {
      log("GitHub Pages etkinleştiriliyor…");
      await call("POST", `/repos/${owner}/${repo}/pages`, { build_type: "legacy", source: { branch, path: "/" } }, [409]);
    } else if (pg.data && pg.data.source && (pg.data.source.branch !== branch || pg.data.source.path !== "/")) {
      await call("PUT", `/repos/${owner}/${repo}/pages`, { build_type: "legacy", source: { branch, path: "/" } }, [400, 409]);
    }
    result.url = pagesUrl(owner, repo);
    log("Pages derlemesi bekleniyor…");
    for (let i = 0; i < maxPolls; i++) {
      const b = await call("GET", `/repos/${owner}/${repo}/pages/builds/latest`, null, [404]);
      const st = b.status === 200 && b.data ? b.data.status : "queued";
      const sameCommit = !b.data || !b.data.commit || b.data.commit === commit;
      if (st === "built" && sameCommit) { result.pagesStatus = "built"; break; }
      if (st === "errored" && sameCommit) { result.pagesStatus = "errored"; log("Pages derlemesi hata verdi: " + ((b.data.error && b.data.error.message) || "")); break; }
      result.pagesStatus = st;
      await sleep(pollMs);
    }
    if (result.pagesStatus === "built") log("Yayında: " + result.url);
    else if (result.pagesStatus !== "errored") log("Derleme sürüyor; birkaç dakika içinde yayında olur: " + result.url);
  }

  if (hasWorkflow) {
    log("GitHub Actions çalıştırması aranıyor…");
    for (let i = 0; i < 6; i++) {
      const runs = await call("GET", `/repos/${owner}/${repo}/actions/runs?per_page=5&head_sha=${commit}`, null, [404]);
      const run = runs.data && runs.data.workflow_runs && runs.data.workflow_runs[0];
      if (run) { result.runUrl = run.html_url; log("Actions çalışıyor: " + run.html_url); break; }
      await sleep(Math.min(pollMs, 3000));
    }
    if (!result.runUrl) log("Actions sayfası: " + result.actionsUrl);
  }
  return result;
}

/** Turkish explanation for a deploy error. */
export function deployErrorMessage(e) {
  if (!(e instanceof DeployError)) return "Yayın başarısız: " + (e && e.message || e);
  switch (e.code) {
    case "auth": return "GitHub token geçersiz ya da süresi dolmuş. Yeni bir token oluşturup tekrar kaydet.";
    case "scope": return "Token'ın izinleri yetersiz: klasik token için “repo” (iş akışı dosyaları için “workflow”), ince ayarlı token için Administration, Contents, Pages (ve Workflows) yazma izni gerekir. (" + e.message + ")";
    case "rate": return "GitHub istek sınırına ulaşıldı. Biraz bekleyip tekrar dene.";
    case "invalid": return "GitHub isteği reddetti: " + e.message + " (Depo adı geçerli mi, Pages bu depo için kullanılabilir mi?)";
    case "network": return e.message + " İnternet bağlantını kontrol et.";
    case "notfound": return "GitHub kaynağı bulunamadı: " + e.message + " (Token bu depoya erişebiliyor mu?)";
    default: return "Yayın başarısız: " + e.message;
  }
}
