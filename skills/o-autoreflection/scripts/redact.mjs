/**
 * Redaction for transcript text that leaves the session: the prompts a model reads, the indexes and reports
 * written to a run folder. A session holds whatever the user pasted, so a key or a token in it would otherwise be
 * handed to whichever model the host picks, and written into a folder that may be committed.
 *
 * It errs toward removing: a false positive costs a word of context, a false negative leaks a credential. What it
 * keeps is the shape (`[REDACTED:aws-key]`), so a reader still sees that a secret was there.
 */

const RULES = [
  ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g],
  ["aws-key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ["anthropic-key", /\bsk-ant-[A-Za-z0-9_-]{20,}/g],
  ["openai-key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ["google-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["stripe-key", /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["url-credentials", /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi],
  ["bearer", /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/g],
];

/**
 * `NAME=value` and `"name": "value"` where the name says it holds a secret. A quoted value is redacted to its closing
 * quote and a bare one to the end of the line, so a passphrase of several words goes whole: cutting a little too
 * much from a transcript costs nothing, and leaving the second word of a password costs the password.
 */
const ASSIGNMENT = /\b([A-Za-z0-9_-]*(?:secret|token|passw(?:or)?d|passphrase|api[_-]?key|private[_-]?key|credential|auth(?!or))[A-Za-z0-9_-]*)(["']?\s*[:=]\s*)(?:(["'])((?:(?!\3)[^\n]){6,})\3|([^\s"',;][^\n;]{5,}))/gi;

/** A long run of base64/hex-looking characters with no word in it: what a generated secret looks like. */
const HIGH_ENTROPY = /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g;

function entropy(text) {
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** A path, a SHA or a UUID is long and random-looking too, and is evidence the report needs. */
const looksLikeEvidence = (token) => token.includes("/") || /^[0-9a-f]{7,64}$/i.test(token) || /^[0-9a-f-]{36}$/i.test(token);

export function redact(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const [kind, pattern] of RULES) {
    out = out.replace(pattern, (match, prefix) => (kind === "url-credentials" ? `${prefix}[REDACTED:credentials]@` : kind === "bearer" ? `${prefix} [REDACTED:${kind}]` : `[REDACTED:${kind}]`));
  }
  out = out.replace(ASSIGNMENT, (match, name, sep, quote, quoted, bare) => {
    const value = (quoted ?? bare).trim();
    if (value.startsWith("[REDACTED")) return match;
    return quote ? `${name}${sep}${quote}[REDACTED:assignment]${quote}` : `${name}${sep}[REDACTED:assignment]`;
  });
  out = out.replace(HIGH_ENTROPY, (token) => (looksLikeEvidence(token) || entropy(token) < 4 ? token : "[REDACTED:high-entropy]"));
  return out;
}
