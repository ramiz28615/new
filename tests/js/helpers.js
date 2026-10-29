// Shared helpers for the Studio tests: SSE responses split into arbitrary chunks, a recording fetch stub.
export function chunkString(s, sizes) {
  const out = [];
  let i = 0, k = 0;
  while (i < s.length) {
    const n = sizes[k++ % sizes.length];
    out.push(s.slice(i, i + n));
    i += n;
  }
  return out;
}

export function streamResponse(chunks, { status = 200, headers = { "content-type": "text/event-stream" } } = {}) {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  });
  return new Response(body, { status, headers });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

/** SSE text for OpenAI / OpenRouter chat completions. */
export function openaiSSE(text, { usage = { prompt_tokens: 100, completion_tokens: 50 }, pieces = 7 } = {}) {
  let s = ": OPENROUTER PROCESSING\n\n";
  for (const p of chunkString(text, [pieces, 3, 11, 1, 5])) s += "data: " + JSON.stringify({ choices: [{ index: 0, delta: { content: p } }] }) + "\n\n";
  s += "data: " + JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "\n\n";
  if (usage) s += "data: " + JSON.stringify({ choices: [], usage }) + "\n\n";
  return s + "data: [DONE]\n\n";
}

/** SSE text with Anthropic Messages event types. */
export function anthropicSSE(text) {
  const ev = (name, data) => `event: ${name}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
  let s = ev("message_start", { type: "message_start", message: { id: "msg_1", usage: { input_tokens: 120, output_tokens: 1 } } });
  s += ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  s += ev("ping", { type: "ping" });
  for (const p of chunkString(text, [4, 9, 2, 13])) s += ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: p } });
  s += ev("content_block_stop", { type: "content_block_stop", index: 0 });
  s += ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 77 } });
  s += ev("message_stop", { type: "message_stop" });
  return s;
}

/** SSE text for Gemini streamGenerateContent?alt=sse. */
export function geminiSSE(text) {
  let s = "";
  const parts = chunkString(text, [17, 6, 30]);
  parts.forEach((p, i) => {
    const last = i === parts.length - 1;
    s += "data: " + JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: p }] }, ...(last ? { finishReason: "STOP" } : {}) }], ...(last ? { usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 40 } } : {}) }) + "\r\n\r\n";
  });
  return s;
}

export function recordingFetch(handler) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: (init.method || "GET").toUpperCase(), headers: init.headers || {}, body: init.body ? safeJson(init.body) : null });
    return handler(String(url), init, calls);
  };
  f.calls = calls;
  return f;
}
function safeJson(b) { try { return JSON.parse(b); } catch (e) { return b; } }
