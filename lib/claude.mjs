// Thin wrapper around Groq's OpenAI-compatible Chat Completions API.
// Free key, no credit card: https://console.groq.com/keys
//
// Model names on free tiers change often, so if the configured model is
// missing (404 model_not_found), we ask the provider which models this key
// can use and pick a suitable chat model automatically.

const BASE_URL = process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1";
let resolvedModel = process.env.LLM_MODEL || "openai/gpt-oss-120b";

async function pickAvailableModel(apiKey) {
  const r = await fetch(`${BASE_URL}/models`, { headers: { authorization: `Bearer ${apiKey}` } });
  if (!r.ok) throw new Error(`Could not list models (${r.status}). Set LLM_MODEL manually.`);
  const ids = ((await r.json()).data || []).map(m => m.id);
  const usable = ids.filter(id => !/whisper|tts|guard|embed|orpheus|playai|distil/i.test(id));
  const prefs = [/gpt-oss-120b/, /70b/, /gpt-oss-20b/, /qwen/, /llama/];
  for (const p of prefs) {
    const hit = usable.find(id => p.test(id));
    if (hit) return hit;
  }
  if (usable.length) return usable[0];
  throw new Error("No chat models available for this API key.");
}

async function chat(apiKey, model, prompt, maxTokens) {
  return fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }]
    })
  });
}

export async function callLLMJSON(prompt, { maxTokens = 4096, model } = {}) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured on the server. Get a free key at console.groq.com/keys.");

  let usedModel = model || resolvedModel;
  let resp = await chat(apiKey, usedModel, prompt, maxTokens);

  if (resp.status === 404 || resp.status === 400) {
    const body = await resp.clone().text();
    if (/model_not_found|does not exist|decommissioned/i.test(body)) {
      resolvedModel = await pickAvailableModel(apiKey);
      usedModel = resolvedModel;
      resp = await chat(apiKey, usedModel, prompt, maxTokens);
    }
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`LLM API error ${resp.status}: ${errText.slice(0, 400)}`);
  }

  const data = await resp.json();
  let text = data?.choices?.[0]?.message?.content || "";
  text = text.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "");
  try {
    const parsed = JSON.parse(text);
    // Monitoring metadata; the frontend ignores unknown keys.
    parsed._meta = { model: usedModel, usage: data.usage || null };
    return parsed;
  } catch (e) {
    throw new Error("Model did not return valid JSON: " + text.slice(0, 300));
  }
}
