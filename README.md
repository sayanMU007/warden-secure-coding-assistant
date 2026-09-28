# Warden — Secure Coding Assistant

An autonomous agent that reads source code, finds real security vulnerabilities,
explains the risk in plain English, and generates a verified, drop-in patch —
with no hardcoded rule lists. All reasoning is delegated to an LLM (Claude);
this codebase only handles orchestration, chunking, parallelism, the UI, and
report generation.

**Live demo (no setup, works right now):**
`https://claude.ai/artifact/4P6nx5AiKxYqgg6LFLB4UV`
This is the same agent running as a Claude Artifact, calling Claude directly
through Anthropic's in-browser "sample" capability — no API key required, no
deployment needed. Open it, drop in a file, and scan.

This folder is the **self-hosted version** of the same agent, for anyone who
wants their own independently deployed live link on Vercel or Netlify with
their own Anthropic API key.

---

## How it maps to the assignment

| Requirement | Where it's handled |
|---|---|
| Accept a vulnerable source file (any language) | `public/index.html` — drag/drop or paste, any extension |
| Identify vulnerability, LOC, risk & impact | LLM call in `lib/prompts.mjs` → `analysisPrompt()`, rendered in the **Findings** tab |
| Generate a patched version | Same call returns `patched_code`; **Patched code** tab |
| Preserve original functionality | Enforced via prompt instructions + a second, independent **verification** pass that explicitly checks behavior preservation |
| No hardcoded rules / static outputs | Every judgment (what's vulnerable, why, how to fix it, whether the fix worked) comes from the model. The code contains zero vulnerability signatures or regex rule lists — only prompt templates and orchestration |
| **Bonus:** Markdown/PDF report | "Save report (.md)" button (`buildMarkdownReport()`); "Print / PDF" uses the browser's native print-to-PDF with a dedicated print stylesheet |
| **Bonus:** Scan multiple files in parallel | `scanAll()` runs `Promise.all` across every loaded file simultaneously |
| **Bonus:** Efficient analysis of large files | Files over ~300 lines are automatically split into line-numbered chunks (`splitChunks()`) and analyzed **in parallel**, then merged with corrected absolute line numbers — the same pattern scales to very large files without ever sending "the whole repo" in one prompt |
| **Bonus:** Automatic patch verification | After a patch is generated, a second independent LLM call (`verifyPrompt()`) re-examines the patched code against each specific finding and reports whether it's actually resolved, plus a functionality-preservation check — shown in the **Verification** tab and folded into the report |

---

## Architecture

```
public/index.html        Single-page frontend (vanilla JS, no build step)
                          — file intake, chunking, diff view, report export
api/analyze.mjs           Vercel serverless function (the agent's "brain")
netlify/functions/analyze.mjs   Same logic, Netlify Functions v2 flavor
lib/prompts.mjs           Prompt templates (analysis + verification)
lib/claude.mjs            Thin fetch() wrapper around Groq's free OpenAI-compatible API
```

The frontend never talks to Anthropic directly — it calls `POST /api/analyze`
with `{ action: "scanChunk" | "verify", ... }`, and the serverless function
holds the API key server-side and forwards the request to the LLM. This keeps
your key out of the browser and works identically whether the function runs
on Vercel or Netlify.

**Agent loop, per file:**
1. Split into chunks if large (`splitChunks`, ~220 lines/chunk).
2. Fire one analysis call per chunk **in parallel** → each returns vulnerabilities
   (with absolute line numbers), a patched version of that chunk, and a fix summary.
3. Merge chunk results into one file-level result.
4. Fire a **verification** call: give the model the findings + the full patch and
   ask it to confirm each one is actually resolved and that behavior is preserved.
5. Render findings, patched code, a line-level diff, and verification — and let
   the user export all of it as a Markdown report or print it to PDF.

---

## Run it locally

```bash
npm install -g vercel        # one-time
cd warden-app
cp .env.example .env         # then edit .env and add your GROQ_API_KEY
vercel dev
```

Open the printed local URL (typically `http://localhost:3000`).

---

## Deploy to Vercel (get your own live link)

1. Push this folder to a GitHub repo (or run `vercel` directly from the folder — it can deploy without git).
2. Go to [vercel.com/new](https://vercel.com/new) and import the repo, **or** from inside the folder run:
   ```bash
   vercel
   ```
3. When prompted, accept the defaults (no build command needed — it's static + serverless functions).
4. In the Vercel project's **Settings → Environment Variables**, add:
   - `GROQ_API_KEY` = your key from [console.groq.com/keys](https://console.groq.com/keys)
   - (optional) `LLM_MODEL` = a specific model string, if you don't want the default
5. Redeploy (`vercel --prod`). Your live link is the URL Vercel gives you.

## Deploy to Netlify

1. Push this folder to a GitHub repo.
2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**, and point it at the repo. Netlify will read `netlify.toml` automatically (publish dir `public`, functions dir `netlify/functions`).
3. In **Site configuration → Environment variables**, add `GROQ_API_KEY` (and optionally `LLM_MODEL`).
4. Deploy. The frontend calls `/api/analyze`, which `netlify.toml` redirects to the function — no frontend code changes needed between the two hosts.

---

## Notes, limits, and honest caveats

- **Model access:** you need your own free Groq API key (no credit card); this repo does not ship one. Because the client uses the OpenAI-compatible chat format, you can swap to another free provider (OpenRouter, Gemini via its OpenAI-compatible endpoint) by changing `GROQ_BASE_URL`, the key, and `LLM_MODEL`. Smaller free models are less thorough than frontier models, so review findings.
- **"Millions of lines":** the chunking + parallel-analysis pattern is the right architecture for very large codebases, but a browser tab realistically handles a practical batch (dozens of files / tens of thousands of lines) well within request limits and cost. For a true enterprise-scale scan, the same `lib/prompts.mjs` + `lib/claude.mjs` functions would be called from a queue/worker (e.g. a background job per file) instead of directly from the browser — the prompt design doesn't change, only the orchestration layer.
- **Verification is itself an LLM judgment**, not a formal proof — for critical systems, findings and patches should still be reviewed by an engineer before merging, exactly as the generated report says.
- **Line numbers**: the model is given explicitly line-numbered source and asked to report back against those numbers; this is far more reliable than asking it to count lines itself, but always double-check against the **Diff** tab.
- Nothing in this project is copied from public vulnerability-scanner repos — the prompts, chunking strategy, and UI are original to this submission.

---

## Evaluation and monitoring

```bash
# after deploying (or with `vercel dev` running locally)
node tests/evaluate.mjs --url https://YOUR-APP.vercel.app
```

This scans the 9 labeled files in `tests/samples` (10 planted vulnerabilities + 1 clean control, labels in `tests/ground_truth.json`) and writes, to `tests/results/`:

- `eval_report.md` — precision, recall, F1, per-file breakdown, misses
- `transcript.md` — readable sample run transcript with findings, patches, verification
- `monitoring_report.md` — latency p50/p95, success rate, retries, token usage
- `run.json` — raw traces

Use a small `--concurrency` (default 2) to stay under free-tier rate limits. See `WRITEUP.md` for design decisions and limitations, and `docs/architecture.png` for the architecture diagram.
