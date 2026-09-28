// Prompt templates shared by the analyze endpoint.
// No hardcoded vulnerability rules live here — these are instructions to the LLM,
// which does the actual reasoning about the code it's given.

export const SCHEMA_NOTE = `Respond with ONLY raw JSON (no markdown fences, no commentary, no leading/trailing text). If a field doesn't apply, use an empty array or empty string — never omit a key.`;

export function analysisPrompt({ name, lang, content, offset = 0, isChunk = false, totalChunks = 1, chunkIdx = 0 }) {
  const chunkNote = isChunk
    ? `This is chunk ${chunkIdx + 1} of ${totalChunks} of a larger file "${name}". Line numbers below start at ${offset + 1} (this chunk's first line is absolute line ${offset + 1}). Only report vulnerabilities whose root cause is visible within this chunk. Rewrite ONLY this chunk in "patched_code", preserving it as a drop-in replacement for these exact lines — do not add lines outside this excerpt's scope.`
    : `This is the complete file "${name}".`;

  return `You are an application security engineer performing a manual secure-code review. ${chunkNote}

Language: ${lang}

Analyze the source below for real, exploitable security vulnerabilities (e.g. injection, broken auth, insecure deserialization, SSRF, path traversal, hardcoded secrets, weak crypto, XSS, unsafe eval, missing input validation, race conditions, insecure defaults). Do not invent issues that aren't present. Ignore pure style or performance nits unless they are also security-relevant.

For each vulnerability found, give the exact line number(s) as they appear in the numbered source below.

Then produce a fully patched version of the source that fixes every vulnerability you found while preserving the original functionality, inputs, outputs, and public interfaces exactly — a developer should be able to drop it in as a replacement with no other changes needed.

Return ONLY this JSON shape:
{
  "vulnerabilities": [
    {
      "id": "V1",
      "title": "short vulnerability name",
      "cwe": "CWE-XXX or empty string",
      "severity": "critical|high|medium|low",
      "lines": "e.g. 42 or 42-47",
      "code_snippet": "the vulnerable line(s), verbatim",
      "description": "what the vulnerability is, in plain terms",
      "risk_impact": "what an attacker could actually do, and the business/technical impact"
    }
  ],
  "patched_code": "the full corrected source for this ${isChunk ? "chunk" : "file"}, as a single string",
  "fix_summary": "2-4 sentences describing what changed and why functionality is unaffected"
}

${SCHEMA_NOTE}

Numbered source (line numbers for your reference only, do not include them in patched_code):
${content.split("\n").map((l, idx) => `${offset + idx + 1}: ${l}`).join("\n")}`;
}

export function verifyPrompt({ name, lang, vulnerabilities, patchedCode }) {
  return `You are auditing a proposed security patch. Original file: "${name}" (${lang}).

Here is the list of vulnerabilities previously found:
${JSON.stringify((vulnerabilities || []).map(v => ({ id: v.id, title: v.title, severity: v.severity, lines: v.lines, description: v.description })), null, 2)}

Here is the patched source that is supposed to fix all of them:
${patchedCode}

For each vulnerability id, determine whether the patched source actually resolves it. Also state briefly whether the patch appears to preserve the original functionality (same inputs/outputs/behavior), or whether it looks like it silently changed behavior.

Return ONLY this JSON shape:
{
  "results": [
    { "id": "V1", "fixed": true, "explanation": "one sentence on why it is or isn't resolved" }
  ],
  "functionality_note": "1-2 sentences on whether behavior appears preserved"
}

${SCHEMA_NOTE}`;
}
