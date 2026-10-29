// LLM providers called straight from the browser (BYOK). The key goes only to the provider's own API.
// Every adapter streams: OpenAI-style SSE (OpenRouter, OpenAI), Anthropic SSE event types, Gemini streamGenerateContent?alt=sse.

export const PROVIDERS = {
  openrouter: {
    label: "OpenRouter",
    defaultModel: "openrouter/free",
    keyUrl: "https://openrouter.ai/keys",
    keyHint: "sk-or-…",
    vision: "auto",
  },
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-sonnet-4-5",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keyHint: "sk-ant-…",
    vision: true,
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-5-mini",
    keyUrl: "https://platform.openai.com/api-keys",
    keyHint: "sk-…",
    vision: true,
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    keyUrl: "https://aistudio.google.com/apikey",
    keyHint: "AIza…",
    vision: true,
  },
};

export const ENDPOINTS = {
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  openrouterModels: "https://openrouter.ai/api/v1/models",
  openai: "https://api.openai.com/v1/chat/completions",
  openaiModels: "https://api.openai.com/v1/models",
  anthropic: "https://api.anthropic.com/v1/messages",
  anthropicModels: "https://api.anthropic.com/v1/models",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
};

export class ProviderError extends Error {
  /** code: auth | credit | rate | model | badreq | server | cors | network | abort | empty | unknown */
  constructor(code, message, status = 0, detail = "") {
    super(message || code);
    this.name = "ProviderError";
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

// ---------- SSE ----------

/** Parse a ReadableStream of SSE bytes into { event, data } records. Handles \r\n, multi-line data and comments. */
export async function* sseEvents(body, signal) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "", event = "", data = [];
  const flush = function* () {
    if (data.length) yield { event: event || "message", data: data.join("\n") };
    event = ""; data = [];
  };
  try {
    for (;;) {
      if (signal && signal.aborted) throw new ProviderError("abort", "aborted");
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.search(/\r\n|\n|\r/)) >= 0) {
        const nl = buf[i] === "\r" && buf[i + 1] === "\n" ? 2 : 1;
        if (buf[i] === "\r" && i === buf.length - 1) break; // wait: maybe "\r\n" split across chunks
        const line = buf.slice(0, i);
        buf = buf.slice(i + nl);
        if (line === "") { yield* flush(); continue; }
        if (line[0] === ":") continue; // comment / keep-alive
        const c = line.indexOf(":");
        const field = c < 0 ? line : line.slice(0, c);
        let val = c < 0 ? "" : line.slice(c + 1);
        if (val[0] === " ") val = val.slice(1);
        if (field === "data") data.push(val);
        else if (field === "event") event = val;
      }
    }
    buf += dec.decode();
    if (buf.trim()) {
      for (const line of buf.split(/\r?\n/)) {
        if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        else if (line.startsWith("event:")) event = line.slice(6).trim();
      }
    }
    yield* flush();
  } finally {
    try { reader.releaseLock(); } catch (e) { /* ignore */ }
  }
}

// ---------- request builders ----------

function oaContent(m, withImages) {
  if (!withImages || !m.images || !m.images.length) return m.content;
  return [
    { type: "text", text: m.content },
    ...m.images.map((im) => ({ type: "image_url", image_url: { url: im.dataUrl } })),
  ];
}

function splitDataUrl(u) {
  const m = /^data:([^;,]+)(?:;[^,]*)?,(.*)$/s.exec(u || "");
  return m ? { mime: m[1], data: m[2] } : { mime: "image/png", data: "" };
}

/** Build { url, init } for a streaming chat request. messages: [{ role: "user"|"assistant", content, images?: [{dataUrl}] }] */
export function buildRequest(cfg, system, messages, opts = {}) {
  const provider = cfg.provider || "openrouter";
  const model = (cfg.model || PROVIDERS[provider].defaultModel).trim();
  const maxTokens = Math.max(256, +cfg.maxTokens || 16000);
  const vision = opts.vision !== false;
  const temperature = cfg.temperature === "" || cfg.temperature == null ? null : +cfg.temperature;

  if (provider === "openrouter" || provider === "openai") {
    const body = {
      model,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages.map((m) => ({ role: m.role, content: oaContent(m, vision) }))],
    };
    const headers = { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey };
    let url = ENDPOINTS[provider];
    if (provider === "openrouter") {
      body.max_tokens = maxTokens;
      if (temperature != null && !Number.isNaN(temperature)) body.temperature = temperature;
      headers["HTTP-Referer"] = opts.referer || "https://ramiz28615.github.io/new/";
      headers["X-Title"] = "Kovan Studio";
    } else {
      body.max_completion_tokens = maxTokens;
      body.stream_options = { include_usage: true };
      if (cfg.baseUrl) url = cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    }
    return { url, init: { method: "POST", headers, body: JSON.stringify(body) } };
  }

  if (provider === "anthropic") {
    const body = {
      model,
      max_tokens: maxTokens,
      stream: true,
      system,
      messages: messages.map((m) => ({
        role: m.role,
        content: vision && m.images && m.images.length
          ? [...m.images.map((im) => { const d = splitDataUrl(im.dataUrl); return { type: "image", source: { type: "base64", media_type: d.mime, data: d.data } }; }),
            { type: "text", text: m.content }]
          : m.content,
      })),
    };
    if (temperature != null && !Number.isNaN(temperature)) body.temperature = temperature;
    return {
      url: ENDPOINTS.anthropic,
      init: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
      },
    };
  }

  if (provider === "gemini") {
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        ...(vision && m.images ? m.images.map((im) => { const d = splitDataUrl(im.dataUrl); return { inline_data: { mime_type: d.mime, data: d.data } }; }) : []),
        { text: m.content },
      ],
    }));
    const generationConfig = { maxOutputTokens: maxTokens };
    if (temperature != null && !Number.isNaN(temperature)) generationConfig.temperature = temperature;
    const name = model.replace(/^models\//, "");
    return {
      url: `${ENDPOINTS.gemini}/models/${encodeURIComponent(name)}:streamGenerateContent?alt=sse`,
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": cfg.apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig }),
      },
    };
  }
  throw new ProviderError("badreq", "Bilinmeyen sağlayıcı: " + provider);
}

// ---------- errors ----------

export function classifyHttpError(status, bodyText) {
  let msg = "";
  try {
    const j = JSON.parse(bodyText);
    const e = Array.isArray(j) ? j[0] && j[0].error : j.error;
    msg = (e && (e.message || e.metadata && e.metadata.raw)) || j.message || "";
    if (typeof e === "string") msg = e;
  } catch (x) { msg = String(bodyText || "").slice(0, 300); }
  const low = msg.toLowerCase();
  let code = "unknown";
  if (status === 401 || /invalid.*(api[ _-]?key|x-api-key|authentication)|api key not valid|incorrect api key|no auth credentials/.test(low)) code = "auth";
  else if (status === 402 || /insufficient|credit|quota exceeded.*billing|billing/.test(low)) code = "credit";
  else if (status === 429 || /rate.?limit|quota|resource.?exhausted|too many requests/.test(low)) code = "rate";
  else if (status === 404 || /model.*(not found|does not exist|not a valid|is not supported|unknown)|no endpoints found|not_found/.test(low)) code = "model";
  else if (status === 403) code = "auth";
  else if (status === 400 || status === 413 || status === 422) code = "badreq";
  else if (status >= 500) code = "server";
  return new ProviderError(code, msg || "HTTP " + status, status, bodyText);
}

// ---------- streaming ----------

/**
 * Stream a chat completion.
 * @returns {Promise<{text:string, usage:{input:number, output:number}|null, finish:string}>}
 */
export async function streamChat({ cfg, system, messages, signal, onDelta, fetchImpl, vision }) {
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  if (!cfg || !cfg.apiKey) throw new ProviderError("auth", "API anahtarı yok");
  const { url, init } = buildRequest(cfg, system, messages, { vision });
  let res;
  try {
    res = await doFetch(url, { ...init, signal });
  } catch (e) {
    if (signal && signal.aborted) throw new ProviderError("abort", "aborted");
    throw new ProviderError("network", String(e && e.message || e));
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw classifyHttpError(res.status, t);
  }
  if (!res.body) throw new ProviderError("network", "Yanıt gövdesi yok");

  const provider = cfg.provider || "openrouter";
  let text = "", usage = null, finish = "";
  const add = (t) => { if (t) { text += t; if (onDelta) onDelta(t, text); } };
  try {
    for await (const ev of sseEvents(res.body, signal)) {
      const d = ev.data;
      if (!d) continue;
      if (d === "[DONE]") break;
      let j;
      try { j = JSON.parse(d); } catch (e) { continue; }
      if (provider === "anthropic") {
        if (j.type === "error" || ev.event === "error") {
          const err = j.error || {};
          throw classifyHttpError(err.type === "overloaded_error" ? 529 : err.type === "rate_limit_error" ? 429 : 400, JSON.stringify({ error: err }));
        }
        if (j.type === "message_start" && j.message && j.message.usage) usage = { input: j.message.usage.input_tokens || 0, output: j.message.usage.output_tokens || 0 };
        else if (j.type === "content_block_delta" && j.delta && j.delta.type === "text_delta") add(j.delta.text);
        else if (j.type === "message_delta") {
          if (j.usage) usage = { input: (usage && usage.input) || j.usage.input_tokens || 0, output: j.usage.output_tokens || 0 };
          if (j.delta && j.delta.stop_reason) finish = j.delta.stop_reason;
        } else if (j.type === "message_stop") break;
      } else if (provider === "gemini") {
        if (j.error) throw classifyHttpError(j.error.code || 400, JSON.stringify(j));
        const c = j.candidates && j.candidates[0];
        if (c && c.content && c.content.parts) for (const p of c.content.parts) if (p.text && !p.thought) add(p.text);
        if (c && c.finishReason) finish = c.finishReason;
        if (j.usageMetadata) usage = { input: j.usageMetadata.promptTokenCount || 0, output: j.usageMetadata.candidatesTokenCount || 0 };
      } else {
        if (j.error) throw classifyHttpError(j.error.code && +j.error.code >= 400 ? +j.error.code : 400, JSON.stringify(j));
        const c = j.choices && j.choices[0];
        if (c && c.delta && typeof c.delta.content === "string") add(c.delta.content);
        if (c && c.finish_reason) finish = c.finish_reason;
        if (j.usage) usage = { input: j.usage.prompt_tokens || 0, output: j.usage.completion_tokens || 0, cost: j.usage.cost };
      }
    }
  } catch (e) {
    if (e instanceof ProviderError) throw e;
    if (signal && signal.aborted) throw new ProviderError("abort", "aborted");
    throw new ProviderError("network", String(e && e.message || e));
  }
  if (!text) throw new ProviderError("empty", "Model boş yanıt döndürdü" + (finish ? " (" + finish + ")" : ""));
  return { text, usage, finish: normalizeFinish(finish) };
}

function normalizeFinish(f) {
  const s = String(f || "").toLowerCase();
  if (/max_tokens|length|max_output/.test(s)) return "length";
  return s || "stop";
}

// ---------- model lists ----------

/** OpenRouter models (public endpoint). Returns [{ id, name, free, vision, context, pricing:{prompt, completion} }]. */
export async function listModels(cfg, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch.bind(globalThis);
  const p = cfg.provider || "openrouter";
  let res;
  try {
    if (p === "openrouter") res = await doFetch(ENDPOINTS.openrouterModels);
    else if (p === "openai") res = await doFetch((cfg.baseUrl ? cfg.baseUrl.replace(/\/+$/, "") + "/models" : ENDPOINTS.openaiModels), { headers: { Authorization: "Bearer " + cfg.apiKey } });
    else if (p === "anthropic") res = await doFetch(ENDPOINTS.anthropicModels + "?limit=100", { headers: { "x-api-key": cfg.apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } });
    else if (p === "gemini") res = await doFetch(ENDPOINTS.gemini + "/models?pageSize=200", { headers: { "x-goog-api-key": cfg.apiKey } });
  } catch (e) {
    throw new ProviderError("network", String(e && e.message || e));
  }
  if (!res.ok) throw classifyHttpError(res.status, await res.text().catch(() => ""));
  const j = await res.json();
  if (p === "openrouter") {
    return (j.data || [])
      .filter((m) => !m.architecture || !m.architecture.output_modalities || m.architecture.output_modalities.includes("text"))
      .filter((m) => !/:batch$/.test(m.id))
      .map((m) => {
        const pr = m.pricing || {};
        const free = /:free$/.test(m.id) || (pr.prompt === "0" && pr.completion === "0");
        const mods = (m.architecture && m.architecture.input_modalities) || [];
        return { id: m.id, name: m.name || m.id, free, vision: mods.includes("image"), context: m.context_length || 0, pricing: { prompt: +pr.prompt || 0, completion: +pr.completion || 0 } };
      });
  }
  if (p === "openai") {
    return (j.data || []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/audio|realtime|tts|transcribe|image|search|embedding/.test(id))
      .sort().reverse().map((id) => ({ id, name: id, free: false, vision: true }));
  }
  if (p === "anthropic") return (j.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id, free: false, vision: true }));
  return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => ({ id: m.name.replace(/^models\//, ""), name: m.displayName || m.name, free: false, vision: true, context: m.inputTokenLimit || 0 }));
}

/** Pick a sensible free OpenRouter model when the configured one is missing. */
export function pickFreeModel(models) {
  const free = models.filter((m) => m.free);
  if (free.find((m) => m.id === "openrouter/free")) return "openrouter/free";
  const score = (m) => (/coder|code/.test(m.id) ? 4 : 0) + (/qwen|deepseek|gemma|llama|nemotron|mistral|glm|kimi/.test(m.id) ? 2 : 0) + Math.min(3, (m.context || 0) / 100000);
  free.sort((a, b) => score(b) - score(a));
  return free[0] ? free[0].id : "";
}

/** Cost in USD from per-token pricing, or null when unknown. */
export function estimateCost(pricing, usage) {
  if (!pricing || !usage) return null;
  return (usage.input || 0) * (pricing.prompt || 0) + (usage.output || 0) * (pricing.completion || 0);
}
