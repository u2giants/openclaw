#!/usr/bin/env node
// Standalone model probe — run with API keys set:
//   ANTHROPIC_API_KEY=sk-ant-... OPENAI_API_KEY=sk-... GEMINI_API_KEY=AI... node scripts/probe-models.js
//
// Uses curl so HTTPS_PROXY / proxy env vars are respected automatically.

const { execFileSync } = require("child_process");

const MODELS = [
  // Anthropic
  { provider: "anthropic", id: "claude-sonnet-4-6",  label: "Claude Sonnet 4.6" },
  { provider: "anthropic", id: "claude-haiku-4-5",   label: "Claude Haiku 4.5"  },
  // OpenAI
  { provider: "openai",    id: "gpt-5.4",                 label: "GPT-5.4"           },
  { provider: "openai",    id: "gpt-5.4-mini",            label: "GPT-5.4 Mini"      },
  { provider: "openai",    id: "gpt-5.4-nano",            label: "GPT-5.4 Nano"      },
  // Google
  { provider: "google",    id: "gemini-3.1-pro-preview",         label: "Gemini 3.1 Pro Preview"         },
  { provider: "google",    id: "gemini-3.1-flash-lite-preview",  label: "Gemini 3.1 Flash Lite Preview"  },
  { provider: "google",    id: "gemini-3.1-flash-image-preview", label: "Gemini 3.1 Flash Image Preview" },
  { provider: "google",    id: "gemini-3-flash-preview",         label: "Gemini 3 Flash Preview"         },
];

function curlPost(url, headers, body) {
  const args = ["-s", "-w", "\n__STATUS__:%{http_code}", "--max-time", "20", "-X", "POST", url];
  for (const [k, v] of Object.entries(headers)) args.push("-H", `${k}: ${v}`);
  args.push("-H", "Content-Type: application/json", "-d", JSON.stringify(body));
  try {
    const out = execFileSync("curl", args, { encoding: "utf8", timeout: 25000 });
    const [raw, statusLine] = out.split("\n__STATUS__:");
    const status = parseInt(statusLine, 10);
    let json = null;
    try { json = JSON.parse(raw); } catch {}
    return { status, json, raw };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

function probe({ provider, id }) {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const OPENAI_KEY    = process.env.OPENAI_API_KEY;
  const GEMINI_KEY    = process.env.GEMINI_API_KEY;

  if (provider === "anthropic") {
    if (!ANTHROPIC_KEY) return { ok: null, note: "no api key" };
    const r = curlPost(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      { model: id, max_tokens: 1, messages: [{ role: "user", content: "." }] }
    );
    const ok = r.status > 0 && r.status < 400;
    const errType = r.json?.error?.type || r.json?.error?.message || "";
    return { ok, status: r.status, errType, error: r.error };
  }

  if (provider === "openai") {
    if (!OPENAI_KEY) return { ok: null, note: "no api key" };
    const isReasoning = id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4") || id.includes("gpt-5");
    const body = { model: id, messages: [{ role: "user", content: "." }] };
    if (isReasoning) body.max_completion_tokens = 1;
    else body.max_tokens = 1;
    const r = curlPost(
      "https://api.openai.com/v1/chat/completions",
      { Authorization: `Bearer ${OPENAI_KEY}` },
      body
    );
    const ok = r.status > 0 && r.status < 400;
    const errType = r.json?.error?.type || r.json?.error?.message || r.json?.error?.code || "";
    // A 400 that mentions the model/param proves it exists
    const existsButBadParam = r.status === 400 && errType &&
      (errType.includes("invalid") || errType.includes("parameter") || errType.includes("model"));
    return { ok: ok || existsButBadParam, status: r.status, errType, error: r.error };
  }

  if (provider === "google") {
    if (!GEMINI_KEY) return { ok: null, note: "no api key" };
    const r = curlPost(
      `https://generativelanguage.googleapis.com/v1beta/models/${id}:generateContent?key=${GEMINI_KEY}`,
      {},
      { contents: [{ parts: [{ text: "." }] }], generationConfig: { maxOutputTokens: 1 } }
    );
    const ok = r.status > 0 && r.status < 400;
    const errType = r.json?.error?.message || r.json?.error?.status || "";
    // 400 INVALID_ARGUMENT can prove model exists
    const existsButBadParam = r.status === 400 && errType && errType.includes("INVALID_ARGUMENT");
    return { ok: ok || existsButBadParam, status: r.status, errType, error: r.error };
  }

  return { ok: null, note: "unknown provider" };
}

(async () => {
  console.log("Model probe —", new Date().toISOString());
  console.log("─".repeat(72));

  const pad = (s, n) => s.padEnd(n);
  let pass = 0, fail = 0, skip = 0;

  for (const m of MODELS) {
    const r = probe(m);
    const fullId = `${m.provider}/${m.id}`;
    if (r.ok === null) {
      console.log(`  SKIP  ${pad(fullId, 46)}  (${r.note})`);
      skip++;
    } else if (r.ok) {
      console.log(`  OK    ${pad(fullId, 46)}  [${m.label}]`);
      pass++;
    } else {
      const reason = r.errType || r.error || `http_${r.status}`;
      console.log(`  FAIL  ${pad(fullId, 46)}  HTTP ${r.status} — ${reason}`);
      fail++;
    }
  }

  console.log("─".repeat(72));
  console.log(`  ${pass} ok  |  ${fail} failed  |  ${skip} skipped (no key)`);
  process.exit(fail > 0 ? 1 : 0);
})();
