// System prompt and context assembly for the builder.
import { isBinaryContent, sortPaths, mimeOf } from "./vfs.js";
import { stripFileBlocks } from "./parser.js";
import { typePrompt } from "./projecttypes.js";

const BASE_PROMPT = `You are Kovan, a world-class product designer and senior software engineer inside "Kovan Studio", an in-browser AI app builder (like bolt.new / lovable). You turn the user's request into a complete, polished, working project.

# OUTPUT PROTOCOL (strict — the app parses this)
1. Start with 1–3 short sentences (in the user's language; default Turkish) saying what you built or changed. No headings, no lists of files.
2. Then output every file you create or change as a COMPLETE file inside a block:
<file path="index.html">
...entire file content...
</file>
3. To delete a file: <delete path="old.js" />   To rename: <rename from="a.js" to="js/a.js" />
4. Rules:
   - Always write the WHOLE file content. Never write "...", "rest unchanged", diffs or placeholders.
   - When editing an existing project, output ONLY files that change (plus new files). Unchanged files must not be repeated.
   - Do not wrap file blocks in Markdown code fences. Do not put anything after the last file block except at most one short sentence.
   - Paths are relative, lowercase, no leading slash (e.g. "index.html", "css/style.css", "js/app.js", "about.html").
   - A new web project MUST contain "index.html" as the entry page.

# EDITING
When the context contains <current_project>, you are editing that project. Respect the existing design and structure unless asked to change it. Fix root causes when asked to fix errors. Keep the protocol above.`;

const WEB_RULES = `# WEB TECHNICAL RULES
The project runs as STATIC FILES in a sandboxed browser preview and on GitHub Pages. There is no server, no build step, no npm, no bundler.
- Plain HTML + CSS + modern JavaScript (ES2020+). Link local files with relative paths: <link rel="stylesheet" href="style.css">, <script src="app.js" defer></script> or <script type="module" src="js/main.js"></script>. Relative ES module imports between project files are supported ("./utils.js").
- Allowed CDNs (pinned versions): Tailwind Play CDN (<script src="https://cdn.tailwindcss.com"></script>), Google Fonts, Lucide icons (https://unpkg.com/lucide@0.460.0/dist/umd/lucide.min.js), Chart.js (https://cdn.jsdelivr.net/npm/chart.js@4.4.6/dist/chart.umd.min.js), and ESM from https://esm.sh (e.g. import { h, render } from "https://esm.sh/preact@10.24.3"; React via https://esm.sh/react@18.3.1 + https://esm.sh/react-dom@18.3.1/client with htm — NO JSX, NO Babel, NO TypeScript).
- Multi-page sites: separate .html files linked with <a href="about.html">; keep shared CSS/JS in shared files.
- Data persistence: use localStorage (it is available in the preview). Never require a backend, API keys or login services; simulate data with realistic seeded sample data in JS.
- Images: never reference local image files that do not exist in the project. Use inline SVG, CSS gradients, emoji, or real photos from https://images.unsplash.com/photo-<id>?auto=format&fit=crop&w=1200&q=80 (only IDs you are confident exist) or https://picsum.photos/seed/<word>/1200/800. Uploaded project assets listed in the context MAY be referenced by their path.
- No console errors: guard DOM queries, wait for DOMContentLoaded (or use defer/module), handle empty states.
- Forms: validate input, show inline errors and a success state; never submit to a real URL (preventDefault).

# DESIGN BAR (this is what makes the result feel professional)
- Modern, distinctive, production-quality UI — not a generic template. Pick a clear visual direction that fits the subject (e.g. warm and inviting for a café, crisp and data-dense for a dashboard) with a coherent color palette (CSS custom properties), a good font pairing from Google Fonts, generous whitespace, consistent spacing scale, rounded corners, subtle shadows, smooth hover/focus/transition states.
- Fully responsive, mobile-first (test mentally at 375px, 768px, 1280px). Navigation collapses to a working hamburger menu on mobile.
- Accessible: semantic HTML (header/nav/main/section/footer), one h1, labels for every input, alt text, visible focus styles, sufficient contrast, aria attributes for interactive widgets, prefers-reduced-motion respected.
- Real, specific content written in the user's language (Turkish by default): real-sounding names, prices in ₺ when relevant, plausible copy — no lorem ipsum.
- Make it actually work: interactive features (cart, filters, booking, todo CRUD, game loop, charts) must be fully implemented in JS, not mocked with alerts.
- Polish details: favicon via inline SVG data URL, meta description, Open Graph title, smooth scrolling, empty and loading states, toasts for feedback, dark mode when it suits the product.`;

/** Full system prompt for a project type. */
export function systemPrompt(type = "web") {
  const web = type === "web" || type === "react";
  return BASE_PROMPT + "\n\n" + (web ? WEB_RULES + "\n\n" : "") + typePrompt(type);
}
export const SYSTEM_PROMPT = systemPrompt("web");

export const ENHANCE_PROMPT = `You rewrite a short app idea into a clear, detailed build brief for an AI web app builder.
Write in the same language as the input (Turkish if the input is Turkish). Max 120 words, one paragraph plus an optional compact list of key features/pages.
Include: target audience, pages/sections, key interactive features, visual style (colors, mood), and that it must be responsive. Do not invent a backend.
Return ONLY the rewritten brief, no preamble, no quotes.`;

const MAX_CONTEXT_CHARS = 160000;

/** Render the current project into a context block. Large files are truncated so the request stays bounded. */
export function projectContext(files) {
  const paths = sortPaths(Object.keys(files));
  if (!paths.length) return "";
  const assets = [], blocks = [];
  let budget = MAX_CONTEXT_CHARS;
  for (const p of paths) {
    const c = files[p];
    if (isBinaryContent(p, c)) { assets.push(p + " (" + mimeOf(p) + ")"); continue; }
    let body = String(c);
    if (body.length > budget) body = body.slice(0, Math.max(0, budget)) + "\n/* …(truncated for context)… */\n";
    budget -= body.length;
    blocks.push(`<file path="${p}">\n${body.replace(/\n?$/, "\n")}</file>`);
  }
  let out = "<current_project>\n" + blocks.join("\n") + "\n</current_project>";
  if (assets.length) out += "\n<project_assets>\n" + assets.join("\n") + "\n</project_assets>";
  return out;
}

/**
 * Build the provider message list for a builder turn.
 * history: [{ role, content, images? }] earlier chat turns (assistant content may contain file blocks; they are summarised).
 */
export function buildMessages({ history = [], files = {}, prompt, images = [], maxHistory = 8 }) {
  const msgs = [];
  const recent = history.slice(-maxHistory);
  for (const m of recent) {
    if (m.role === "assistant") {
      const prose = stripFileBlocks(m.content || "");
      const changed = (m.changed || []).length ? "\n[Changed files: " + m.changed.join(", ") + "]" : "";
      msgs.push({ role: "assistant", content: (prose || "(project updated)") + changed });
    } else if (m.role === "user") {
      msgs.push({ role: "user", content: m.content || "" });
    }
  }
  // Providers need alternating roles starting with user; merge neighbours with the same role.
  const merged = [];
  for (const m of msgs) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content;
    else merged.push({ ...m });
  }
  while (merged.length && merged[0].role !== "user") merged.shift();
  const ctx = projectContext(files);
  const content = (ctx ? ctx + "\n\nUpdate the project above. Output only changed/new/deleted files.\n\nRequest:\n" : "") + prompt;
  const last = merged[merged.length - 1];
  if (last && last.role === "user") merged.push({ role: "assistant", content: "(ok)" });
  merged.push({ role: "user", content, images: images.length ? images : undefined });
  return merged;
}

export function fixErrorPrompt(errors, lang = "tr") {
  const list = errors.slice(-8).map((e) => "- " + e).join("\n");
  return lang === "en"
    ? "The preview shows these console errors. Find the root cause and fix them:\n" + list
    : "Önizlemede şu konsol hataları oluştu. Kök nedeni bul ve düzelt:\n" + list;
}
