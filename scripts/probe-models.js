#!/usr/bin/env node
// Standalone model probe — run with API keys set:
//   ANTHROPIC_API_KEY=sk-... OPENAI_API_KEY=sk-... GEMINI_API_KEY=AI... node scripts/probe-models.js

const https = require("https");

const MODELS = [
  // Anthropic
  { provider: "anthropic", id: "claude-sonnet-4-6",       label: "Claude Sonnet 4.6" },
  { provider: "anthropic", id: "claude-haiku-4-5",        label: "Claude Haiku 4.5"  },
  { provider: "anthropic", id: "claude-3-haiku-20240307", label: "Claude Haiku 3"    },
  // OpenAI
  { provider: "openai",    id: "gpt-5.4",                 label: "GPT-5.4"           },
  { provider: "openai",    id: "gpt-5.4-mini",            label: "GPT-5.4 Mini"      },
  { provider: "openai",    id: "gpt-5.4-nano",            label: "GPT-5.4 Nano"      },
  // Google
  { provider: "google",    id: "gemini-3.1-pro-preview",          label: "Gemini 3.1 Pro Preview"         },
  { provider: "google",    id: "gemini-3.1-flash-lite-preview",   label: "Gemini 3.1 Flash Lite Preview"  },
  { provider: "google",    id: "gemini-3.1-flash-image-preview",  label: "Gemini 3.1 Flash Image Preview" },
  { provider: "google",    id: "gemini-3-flash-preview",          label: "Gemini 3 Flash Preview"         },
];

const ENDPOINTS = {
  anthropic: { host: "api.anthropic.com",                   path: "/v1/messages" },
  openai:    { host: "api.openai.com",                      path: "/v1/chat/completions" },
  google:    { host: "generativelanguage.googleapis.com",   path: null }, // path is per-model
};

function request(hostname, path, headers, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname, path, method: "POST",
      headers: { ...headers, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      timeout: 15000,
    }, res => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on("error", e => resolve({ status: 0, error: e.message }));
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, error: "timeout" }); });
    req.write(data); req.end();
  });
}

async function probe({ provider, id, label }) {
  const key = { anthropic: process.env.ANTHROPIC_API_KEY, openai: process.env.OPENAI_API_KEY, google: process.env.GEMINI_API_KEY }[provider];
  if (!key) return { ok: null, note: "no api key" };

  let hostname, path, headers, body;

  if (provider === "anthropic") {
    hostname = ENDPOINTS.anthropic.host;
    path     = ENDPOINTS.anthropic.path;
    headers  = { "x-api-key": key, "anthropic-version": "2023-06-01" };
    body     = { model: id, max_tokens: 1, messages: [{ role: "user", content: "." }] };
  } else if (provider === "openai") {
    const isReasoning = id.startsWith("o1") || id.startsWith("o3") || id.startsWith("o4") || id.includes("gpt-5");
    hostname = ENDPOINTS.openai.host;
    path     = ENDPOINTS.openai.path;
    headers  = { Authorization: `Bearer ${key}` };
    body     = { model: id, messages: [{ role: "user", content: "." }] };
    if (isReasoning) body.max_completion_tokens = 1;
    else body.max_tokens = 1;
  } else if (provider === "google") {
    hostname = ENDPOINTS.google.host;
    path     = `/v1beta/models/${id}:generateContent?key=${key}`;
    headers  = {};
    body     = { contents: [{ parts: [{ text: "." }] }], generationConfig: { maxOutputTokens: 1 } };
  }

  const res = await request(hostname, path, headers, body);
  const ok = res.status > 0 && res.status < 400;
  const errType = res.body?.error?.type || res.body?.error?.message || res.body?.error?.status || "";
  // A 400 that proves the model exists (e.g. token-limit complaint) counts as OK
  const existsButBadParam = res.status === 400 && errType &&
    (errType.includes("invalid_request") || errType.includes("INVALID_ARGUMENT") || errType.includes("max_token"));
  return { ok: ok || existsButBadParam, status: res.status, errType, error: res.error };
}

(async () => {
  console.log("Model probe —", new Date().toISOString());
  console.log("─".repeat(72));

  const pad = (s, n) => s.padEnd(n);
  let pass = 0, fail = 0, skip = 0;

  for (const m of MODELS) {
    const r = await probe(m);
    if (r.ok === null) {
      console.log(`  SKIP  ${pad(m.provider + "/" + m.id, 46)}  (${r.note})`);
      skip++;
    } else if (r.ok) {
      console.log(`  OK    ${pad(m.provider + "/" + m.id, 46)}  [${m.label}]`);
      pass++;
    } else {
      console.log(`  FAIL  ${pad(m.provider + "/" + m.id, 46)}  HTTP ${r.status} — ${r.errType || r.error || "unknown"}`);
      fail++;
    }
  }

  console.log("─".repeat(72));
  console.log(`  ${pass} ok  |  ${fail} failed  |  ${skip} skipped (no key)`);
  process.exit(fail > 0 ? 1 : 0);
})();
