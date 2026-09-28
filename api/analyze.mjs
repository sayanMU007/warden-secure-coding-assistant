import { analysisPrompt, verifyPrompt } from "../lib/prompts.mjs";
import { callLLMJSON } from "../lib/claude.mjs";

// One structured JSON log line per call -> visible in Vercel Project > Logs.
function logCall(fields) {
  console.log(JSON.stringify({ event: "llm_call", ts: new Date().toISOString(), ...fields }));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  const t0 = Date.now();
  try {
    let result;
    if (body.action === "scanChunk") {
      result = await callLLMJSON(analysisPrompt(body), { maxTokens: 4096 });
    } else if (body.action === "verify") {
      result = await callLLMJSON(verifyPrompt(body), { maxTokens: 2048 });
    } else {
      res.status(400).json({ error: "Unknown action. Expected 'scanChunk' or 'verify'." });
      return;
    }
    const latency_ms = Date.now() - t0;
    result._meta = { ...(result._meta || {}), latency_ms };
    logCall({ action: body.action, file: body.name, status: 200, latency_ms, model: result._meta.model, usage: result._meta.usage });
    res.status(200).json(result);
  } catch (e) {
    logCall({ action: body.action, file: body.name, status: 500, latency_ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) });
    res.status(500).json({ error: e.message || String(e) });
  }
}
