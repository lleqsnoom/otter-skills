"use strict";

/**
 * Session text leaves the session through autoreflection: model prompts, the issue index and the reports written
 * to a run folder. Whatever the user pasted is in that text, so credentials are redacted before any of it is
 * written — and evidence a report needs (paths, SHAs, ordinary prose) survives.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPTS = path.join(__dirname, "..", "skills", "o-autoreflection", "scripts");
const load = (name) => import(pathToFileURL(path.join(SCRIPTS, name)).href);

describe("autoreflection redaction", () => {
  it("removes the credential shapes people paste", async () => {
    const { redact } = await load("redact.mjs");
    const samples = [
      "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
      "token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB",
      "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345",
      "OPENAI sk-proj-abcdefghijklmnopqrstuvwx1234",
      "DATABASE_PASSWORD=hunter2hunter2",
      '"apiKey": "9f8e7d6c5b4a3210zyxw"',
      "postgres://admin:s3cr3tpass@db.example.com:5432/app",
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----",
      "secret Zt9q2Lw8Xv4Rk7Pm1Nb6Hc3Jd5Fg0Sa9Qe2Wr",
    ];
    for (const sample of samples) {
      const out = redact(sample);
      assert.match(out, /\[REDACTED:/, `not redacted: ${sample}`);
      assert.doesNotMatch(out, /AKIAIOSFODNN7EXAMPLE|ghp_abc|sk-ant-api03|hunter2|s3cr3tpass|9f8e7d6c5b4a|MIIEowIBAAKCAQEA|Zt9q2Lw8Xv4R/);
    }
  });

  it("keeps the evidence a report needs", async () => {
    const { redact } = await load("redact.mjs");
    for (const text of [
      "the build failed in skills/o-review/scripts/analyze-complexity.mjs after commit 5a2471631c0e8f9e2b3a4d5c6e7f8091a2b3c4d5",
      "session 0d5e6f7a-1b2c-4d3e-8f9a-0b1c2d3e4f5a reran npm test",
      "you are stuck on one step for 20 minutes, add a timeout",
    ]) {
      assert.equal(redact(text), text);
    }
  });

  it("reaches the digest every prompt and index is built from", async () => {
    const { digest } = await load("hunt-issues.mjs");
    const session = {
      source: { host: "claude", id: "s1" },
      messages: [
        { index: 0, role: "user", parts: [{ type: "text", text: "set up the deploy for the staging cluster please" }] },
        { index: 1, role: "assistant", parts: [{ type: "text", text: "Which token should I use for the registry login?" }] },
        { index: 2, role: "user", parts: [{ type: "text", text: "use this one ghp_abcdefghijklmnopqrstuvwxyz0123456789AB and stop asking me" }] },
      ],
    };
    const text = JSON.stringify(digest(session));
    assert.doesNotMatch(text, /ghp_abcdefghijkl/);
    assert.match(text, /\[REDACTED:github-token\]/);
  });

  it("redacts a whole passphrase, keeps the quotes, and leaves author lines alone", async () => {
    const { redact } = await load("redact.mjs");
    assert.equal(redact("password: correct horse battery staple"), "password: [REDACTED:assignment]");
    assert.equal(redact('"api_key": "abc 123 def ghi", "user": "bob"'), '"api_key": "[REDACTED:assignment]", "user": "bob"');
    assert.equal(redact("Author: Tomasz Kwiatek <t@example.com>"), "Author: Tomasz Kwiatek <t@example.com>");
    assert.equal(redact("authToken: abcdef123456"), "authToken: [REDACTED:assignment]");
  });
});
