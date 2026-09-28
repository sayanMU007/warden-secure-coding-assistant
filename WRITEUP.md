# Warden — Secure Coding Assistant: Write-up

## Which domain/goal did you choose for your agent?
Application security. Warden is an autonomous agent that takes vulnerable source code (any language), identifies each vulnerability with its exact line(s), explains the risk and impact, generates a patched file that preserves behavior, and then independently verifies whether the patch actually fixes each finding. Bonus features implemented: Markdown report and print-to-PDF, parallel scanning of multiple files, chunked analysis of large files, and automatic patch verification.

## Design decisions
- **LLM does all the reasoning.** There are no regexes, signatures or rule lists in the code. The prompts (`lib/prompts.mjs`) describe the task and the JSON output schema; the model decides what is vulnerable, why, and how to fix it.
- **Two independent passes.** Pass A analyzes and patches; Pass B is a separate call that receives the findings plus the patched code and judges whether each finding is resolved and whether behavior appears preserved. Separating them reduces the "model grades its own homework in the same breath" problem.
- **Line-numbered input.** Source is sent with explicit line numbers, and the model reports against them. This is more reliable than asking the model to count lines.
- **Chunking for scale.** Files longer than ~300 lines are split into ~220-line chunks analyzed in parallel, then merged with absolute line numbers. Multiple files are also scanned in parallel.
- **Serverless backend.** The browser never sees the API key. `/api/analyze` runs on Vercel (a Netlify equivalent is included).
- **Provider-agnostic client.** Uses an OpenAI-compatible chat API (Groq free tier). If the configured model disappears, the client lists the models available to the key and picks one.
- **Observability built in.** Each API call emits a structured log line (latency, status, model, tokens) and the response carries `_meta` for the evaluation harness.

## Any assumptions or mock data used?
- The test set (`tests/samples`) is synthetic: 8 files with deliberately planted, textbook vulnerabilities (SQLi, command injection, unrestricted upload/path traversal, reflected XSS, hardcoded secrets + weak hash, insecure deserialization, SSRF, eval injection) plus 1 clean negative control. No production data is used.
- Ground-truth labels were written by the author when planting the bugs (`tests/ground_truth.json`), not derived from model output.
- Assumes the input is source text that fits in a browser tab and a free-tier rate limit.
- Assumes an LLM-based verifier is an acceptable proxy for "the patch works".

## Limitations
- Verification is an LLM judgment, not a proof. The harness additionally checks that patched Python/JavaScript parses (and PHP if `php` is installed), but nothing runs an application's real test suite, so behavior preservation is not guaranteed.
- Cross-file reasoning is limited: each file or chunk is analyzed on its own, so vulnerabilities whose cause spans files (for example taint flowing through several modules) can be missed.
- Chunk boundaries can split a function, so a chunk sees incomplete context; overlapping chunks would help.
- Free-tier open models are less thorough than frontier models and are rate limited (HTTP 429 handled by retry in the harness only; the UI asks the user to rescan).
- Findings are non-deterministic across runs. Temperature is set low but not zero-guaranteed.
- "Millions of lines" needs a queue/worker architecture, not a browser-driven loop.

## How did you generate/label your test traces?
I wrote each sample file by hand around one or two known bug patterns and recorded, at creation time, the CWE and line range of every planted vulnerability in `tests/ground_truth.json`. `09_clean_control.py` is a corrected version of the login file (parameterized query plus password-hash check) and is labeled as having zero vulnerabilities, to measure false positives. A predicted finding is a true positive if it is in the right file and either its CWE matches a label or its line range overlaps a label's range (±2 lines); each label is matched once.

## Approach, precision/recall, production-readiness
**Approach:** `node tests/evaluate.mjs --url <deployed-url>` runs every sample through the live API, computes TP/FP/FN, precision, recall and F1, checks that patches parse, records verifier results, and writes `tests/results/eval_report.md`, `transcript.md` and `monitoring_report.md`.

**Results (fill in from your run of `eval_report.md`):**
| Metric | Value |
|---|---|
| Precision | ___ |
| Recall | ___ |
| F1 | ___ |
| False positives on clean control | ___ |
| Patch fixes confirmed by verifier | ___ / ___ |

**Interpretation caveat:** with 10 labeled bugs, one miss moves recall by 10 points. These numbers describe behavior on simple synthetic cases, not real-world code.

**Production-readiness — what exists:** server-side secret handling, structured per-call logging, retry/backoff and error surfacing, parallel execution, chunking, an automated evaluation harness that can be rerun after every prompt or model change.

**What is still needed:** authentication and rate limiting on `/api/analyze`; a job queue and workers for large repositories; overlapping chunks and cross-file context (call graph or repository index); running the project's own tests against each patch in a sandbox; a persistent metrics store and alerting instead of log lines; a larger, real-world labeled benchmark; prompt-injection hardening, since the scanned code is untrusted input to the model; and human review before merging any generated patch.

## Total time spent (hours)
_Enter your own figure — this is not something I can know._
