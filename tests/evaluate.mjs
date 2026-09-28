// Evaluation + monitoring harness for the Warden agent.
//
// Runs every file in tests/samples through a deployed (or local) /api/analyze
// endpoint, then computes precision/recall against tests/ground_truth.json and
// writes four artifacts to tests/results/:
//   run.json            raw request/response traces (machine-readable)
//   transcript.md       human-readable sample run transcript
//   eval_report.md      precision / recall / per-file breakdown
//   monitoring_report.md latency, success rate, token usage, error counts
//
// Usage:
//   node tests/evaluate.mjs --url https://your-app.vercel.app
//   node tests/evaluate.mjs                       (defaults to http://localhost:3000)
//
// Nothing in this file fabricates results: every number comes from the live calls.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const BASE = (argVal("--url", "http://localhost:3000")).replace(/\/$/, "");
const CONCURRENCY = Number(argVal("--concurrency", "2"));
const LINE_TOL = 2;

const samplesDir = path.join(__dirname, "samples");
const resultsDir = path.join(__dirname, "results");
fs.mkdirSync(resultsDir, { recursive: true });
const truth = JSON.parse(fs.readFileSync(path.join(__dirname, "ground_truth.json"), "utf8"));

const LANGS = { py: "Python", php: "PHP", js: "JavaScript" };
const langOf = (f) => LANGS[f.split(".").pop()] || "Unknown";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const calls = []; // monitoring log: one entry per HTTP attempt

async function api(payload, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const t0 = Date.now();
    let status = 0, body = null, err = null;
    try {
      const r = await fetch(`${BASE}/api/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      status = r.status;
      body = await r.json().catch(() => null);
    } catch (e) { err = String(e.message || e); }
    const latency = Date.now() - t0;
    const ok = status === 200 && body && !body.error;
    calls.push({
      label, action: payload.action, attempt, status, ok, latency_ms: latency,
      error: ok ? null : (err || (body && body.error) || `HTTP ${status}`),
      usage: body && body._meta ? body._meta.usage || null : null,
      model: body && body._meta ? body._meta.model || null : null
    });
    if (ok) return body;
    const retryable = status === 429 || status >= 500 || status === 0;
    if (!retryable || attempt === 4) throw new Error(calls[calls.length - 1].error);
    await sleep(2000 * attempt);
  }
}

function syntaxCheck(fileName, code) {
  const ext = fileName.split(".").pop();
  const tmp = path.join(os.tmpdir(), `warden_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
  fs.writeFileSync(tmp, code);
  try {
    let r;
    if (ext === "py") r = spawnSync("python3", ["-m", "py_compile", tmp], { encoding: "utf8" });
    else if (ext === "js") r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    else if (ext === "php") r = spawnSync("php", ["-l", tmp], { encoding: "utf8" });
    else return "skipped";
    if (r.error) return "skipped";
    return r.status === 0 ? "valid" : "invalid";
  } finally { fs.rmSync(tmp, { force: true }); }
}

function parseLines(s) {
  const m = String(s || "").match(/(\d+)\s*(?:[-–]\s*(\d+))?/);
  if (!m) return null;
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
  return [Math.min(a, b), Math.max(a, b)];
}
const cweNum = (c) => (String(c || "").match(/\d+/) || [null])[0];

async function scanOne(file) {
  const content = fs.readFileSync(path.join(samplesDir, file), "utf8");
  const lang = langOf(file);
  const rec = { file, lang, lines: content.split("\n").length };
  const t0 = Date.now();
  try {
    const scan = await api({ action: "scanChunk", name: file, lang, content, offset: 0, isChunk: false, totalChunks: 1, chunkIdx: 0 }, file);
    const vulns = (scan.vulnerabilities || []).map((v, i) => ({ ...v, id: "V" + (i + 1) }));
    rec.scan = { vulnerabilities: vulns, patched_code: scan.patched_code || "", fix_summary: scan.fix_summary || "" };
    rec.patch_syntax = rec.scan.patched_code ? syntaxCheck(file, rec.scan.patched_code) : "no_patch";
    if (vulns.length) {
      try {
        rec.verification = await api({ action: "verify", name: file, lang, vulnerabilities: vulns, patchedCode: rec.scan.patched_code }, file + " (verify)");
      } catch (e) { rec.verification_error = e.message; }
    }
  } catch (e) { rec.error = e.message; }
  rec.total_ms = Date.now() - t0;
  return rec;
}

async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

function score(records) {
  let tp = 0, fp = 0, dup = 0;
  const perFile = [];
  const labelResults = [];
  for (const rec of records) {
    const fileLabels = truth.labels.filter((l) => l.file === rec.file);
    const matched = new Set();
    const preds = rec.scan ? rec.scan.vulnerabilities : [];
    const detail = [];
    for (const p of preds) {
      const pr = parseLines(p.lines);
      let hit = -1;
      fileLabels.forEach((l, idx) => {
        if (hit >= 0) return;
        const cweEq = cweNum(p.cwe) && cweNum(p.cwe) === cweNum(l.cwe);
        const lineOv = pr && pr[0] <= l.line_end + LINE_TOL && pr[1] >= l.line_start - LINE_TOL;
        if (!matched.has(idx) && (cweEq || lineOv)) hit = idx;
      });
      if (hit >= 0) { matched.add(hit); tp++; detail.push({ id: p.id, title: p.title, result: "TP", label: fileLabels[hit].cwe }); }
      else {
        const overlapsMatched = fileLabels.some((l, idx) => matched.has(idx) && pr && pr[0] <= l.line_end + LINE_TOL && pr[1] >= l.line_start - LINE_TOL);
        if (overlapsMatched) { dup++; detail.push({ id: p.id, title: p.title, result: "duplicate" }); }
        else { fp++; detail.push({ id: p.id, title: p.title, result: "FP" }); }
      }
    }
    fileLabels.forEach((l, idx) => labelResults.push({ file: rec.file, cwe: l.cwe, name: l.name, found: matched.has(idx) }));
    perFile.push({ file: rec.file, expected: fileLabels.length, found: matched.size, predicted: preds.length, detail, error: rec.error || null });
  }
  const fn = labelResults.filter((l) => !l.found).length;
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { tp, fp, fn, dup, precision, recall, f1, perFile, labelResults };
}

const pct = (x) => (x * 100).toFixed(1) + "%";
const q = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };

async function main() {
  const files = fs.readdirSync(samplesDir).filter((f) => !f.startsWith(".")).sort();
  console.log(`Warden evaluation: ${files.length} files -> ${BASE}/api/analyze (concurrency ${CONCURRENCY})`);
  const started = new Date();
  const records = await pool(files, CONCURRENCY, async (f) => { const r = await scanOne(f); console.log(`  ${r.error ? "FAIL" : "ok  "} ${f} (${r.total_ms} ms)`); return r; });
  const finished = new Date();
  const s = score(records);

  const cleanFP = records.filter((r) => truth.clean_files.includes(r.file)).reduce((n, r) => n + (r.scan ? r.scan.vulnerabilities.length : 0), 0);
  const verified = records.filter((r) => r.verification && r.verification.results);
  const vTotal = verified.reduce((n, r) => n + r.verification.results.length, 0);
  const vFixed = verified.reduce((n, r) => n + r.verification.results.filter((x) => x.fixed).length, 0);
  const syn = records.reduce((a, r) => { a[r.patch_syntax || "n/a"] = (a[r.patch_syntax || "n/a"] || 0) + 1; return a; }, {});

  fs.writeFileSync(path.join(resultsDir, "run.json"), JSON.stringify({ base: BASE, started, finished, records, calls }, null, 2));

  // transcript.md
  let t = `# Sample Run Transcript\n\nEndpoint: ${BASE}/api/analyze  \nStarted: ${started.toISOString()}  \nFinished: ${finished.toISOString()}\n\n`;
  for (const r of records) {
    t += `---\n\n## ${r.file}  (${r.lang}, ${r.lines} lines, ${r.total_ms} ms)\n\n`;
    if (r.error) { t += `**Scan failed:** ${r.error}\n\n`; continue; }
    if (!r.scan.vulnerabilities.length) t += `Agent reported no vulnerabilities.\n\n`;
    r.scan.vulnerabilities.forEach((v) => {
      const ver = r.verification && r.verification.results ? r.verification.results.find((x) => x.id === v.id) : null;
      t += `### ${v.id}: ${v.title} ${v.cwe ? "(" + v.cwe + ")" : ""}\n- Severity: ${v.severity}\n- Line(s): ${v.lines}\n- Vulnerable code: \`${(v.code_snippet || "").replace(/\n/g, " ⏎ ")}\`\n- Vulnerability: ${v.description}\n- Risk & impact: ${v.risk_impact}\n${ver ? `- Verification: ${ver.fixed ? "FIXED" : "NOT FIXED"} — ${ver.explanation}\n` : ""}\n`;
    });
    t += `**Fix summary:** ${r.scan.fix_summary}\n\n**Patch syntax check:** ${r.patch_syntax}\n\n`;
    if (r.verification) t += `**Functionality note:** ${r.verification.functionality_note}\n\n`;
    t += "<details><summary>Patched code</summary>\n\n```\n" + r.scan.patched_code + "\n```\n</details>\n\n";
  }
  fs.writeFileSync(path.join(resultsDir, "transcript.md"), t);

  // eval_report.md
  let e = `# Evaluation Report — Precision / Recall\n\nRun: ${started.toISOString()} against ${BASE}\n\n## Method\n- Test set: ${files.length} hand-written files (${truth.labels.length} planted vulnerabilities across 8 files + 1 clean negative control). Labels: \`tests/ground_truth.json\`.\n- A predicted finding counts as a **true positive** if it targets the same file and either (a) its CWE id equals a label's CWE, or (b) its line range overlaps a label's range (±${LINE_TOL} lines). Each label can be matched once.\n- Extra findings that land on an already-matched label are **duplicates** (ignored). Findings matching no label are **false positives**.\n- Recall = TP / (TP + FN). Precision = TP / (TP + FP). F1 = harmonic mean.\n\n## Results\n| Metric | Value |\n|---|---|\n| True positives | ${s.tp} |\n| False positives | ${s.fp} |\n| False negatives | ${s.fn} |\n| Duplicates (ignored) | ${s.dup} |\n| **Precision** | **${pct(s.precision)}** |\n| **Recall** | **${pct(s.recall)}** |\n| **F1** | **${pct(s.f1)}** |\n| Findings on clean control | ${cleanFP} (0 is ideal) |\n| Fixes confirmed by verifier | ${vFixed}/${vTotal} |\n| Patches passing syntax check | ${syn.valid || 0} valid, ${syn.invalid || 0} invalid, ${syn.skipped || 0} skipped |\n\n## Per-file breakdown\n| File | Expected | Found | Predicted | Notes |\n|---|---|---|---|---|\n`;
  s.perFile.forEach((p) => { e += `| ${p.file} | ${p.expected} | ${p.found} | ${p.predicted} | ${p.error ? "ERROR: " + p.error : p.detail.map((d) => d.result).join(", ") || "-"} |\n`; });
  e += `\n## Missed vulnerabilities\n`;
  const missed = s.labelResults.filter((l) => !l.found);
  e += missed.length ? missed.map((m) => `- ${m.file}: ${m.name} (${m.cwe})`).join("\n") : "None.";
  e += `\n\n## Caveats\nSmall synthetic set; numbers indicate behavior on textbook-style bugs, not real-world codebases. Verification and syntax checks are proxies for "patch works" — they do not run the app's test suite.\n`;
  fs.writeFileSync(path.join(resultsDir, "eval_report.md"), e);

  // monitoring_report.md
  const okCalls = calls.filter((c) => c.ok);
  const lat = okCalls.map((c) => c.latency_ms);
  const errs = calls.filter((c) => !c.ok).reduce((a, c) => { const k = c.status || "network"; a[k] = (a[k] || 0) + 1; return a; }, {});
  const tokIn = okCalls.reduce((n, c) => n + (c.usage?.prompt_tokens || 0), 0);
  const tokOut = okCalls.reduce((n, c) => n + (c.usage?.completion_tokens || 0), 0);
  const models = [...new Set(okCalls.map((c) => c.model).filter(Boolean))];
  let m = `# Monitoring Report\n\nWindow: ${started.toISOString()} → ${finished.toISOString()} (${((finished - started) / 1000).toFixed(1)} s wall clock)  \nEndpoint: ${BASE}/api/analyze  \nModel(s) observed: ${models.join(", ") || "n/a"}\n\n## Reliability\n| Signal | Value |\n|---|---|\n| HTTP attempts | ${calls.length} |\n| Successful attempts | ${okCalls.length} (${pct(calls.length ? okCalls.length / calls.length : 0)}) |\n| Retries triggered | ${calls.filter((c) => c.attempt > 1).length} |\n| Files fully scanned | ${records.filter((r) => !r.error).length}/${records.length} |\n| Error breakdown (by HTTP status) | ${Object.keys(errs).length ? Object.entries(errs).map(([k, v]) => `${k}: ${v}`).join(", ") : "none"} |\n\n## Latency (successful calls)\n| Percentile | ms |\n|---|---|\n| p50 | ${q(lat, 50)} |\n| p95 | ${q(lat, 95)} |\n| max | ${lat.length ? Math.max(...lat) : 0} |\n| mean | ${lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0} |\n\n## Token usage\n| | Tokens |\n|---|---|\n| Prompt | ${tokIn} |\n| Completion | ${tokOut} |\n\n## Quality signals\n- Precision ${pct(s.precision)}, recall ${pct(s.recall)} (see eval_report.md)\n- Patch fix-confirmation rate: ${vFixed}/${vTotal}\n- Patch syntax validity: ${JSON.stringify(syn)}\n\n## Slowest files\n${[...records].sort((a, b) => b.total_ms - a.total_ms).slice(0, 3).map((r) => `- ${r.file}: ${r.total_ms} ms`).join("\n")}\n\n## Live monitoring in production\nEvery /api/analyze call also emits one structured JSON log line (event, action, model, latency_ms, status, token usage). On Vercel these appear under Project → Logs and can be filtered with \`event:llm_call\`.\n`;
  fs.writeFileSync(path.join(resultsDir, "monitoring_report.md"), m);

  console.log(`\nPrecision ${pct(s.precision)} | Recall ${pct(s.recall)} | F1 ${pct(s.f1)} | TP ${s.tp} FP ${s.fp} FN ${s.fn}`);
  console.log(`Artifacts written to ${resultsDir}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
