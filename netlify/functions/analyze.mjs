import { analysisPrompt, verifyPrompt } from "../../lib/prompts.mjs";
import { callLLMJSON } from "../../lib/claude.mjs";

// Netlify Functions v2 (ESM, Web-standard Request/Response).
// Exposed at /.netlify/functions/analyze — also aliased to /api/analyze
// by the redirect in netlify.toml so the frontend code is identical
// whether deployed on Vercel or Netlify.
export default async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST." }), { status: 405, headers: cors });
  }

  let body = {};
  try { body = await req.json(); } catch { /* empty body */ }

  const t0 = Date.now();
  try {
    let result;
    if (body.action === "scanChunk") {
      result = await callLLMJSON(analysisPrompt(body), { maxTokens: 4096 });
    } else if (body.action === "verify") {
      result = await callLLMJSON(verifyPrompt(body), { maxTokens: 2048 });
    } else {
      return new Response(JSON.stringify({ error: "Unknown action. Expected 'scanChunk' or 'verify'." }), { status: 400, headers: cors });
    }
    const latency_ms = Date.now() - t0;
    result._meta = { ...(result._meta || {}), latency_ms };
    console.log(JSON.stringify({ event: "llm_call", action: body.action, file: body.name, status: 200, latency_ms, model: result._meta.model, usage: result._meta.usage }));
    return new Response(JSON.stringify(result), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || String(e) }), { status: 500, headers: cors });
  }
};

export const config = { path: "/api/analyze" };
