"use strict";

/**
 * A plain rewrite of technical prose failed B2 on the subject's own words ("infrastructure", "deployment"), which
 * pushed the agent to swap precise terms for vague ones. Domain terms now score as ordinary words, and a failed
 * check says what failed rather than printing the passing sentence.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const VERIFY = path.join(__dirname, "..", "skills", "o-humanize", "scripts", "verify.mjs");
const METRICS = path.join(__dirname, "..", "skills", "o-humanize", "scripts", "metrics.mjs");

const ORIGINAL =
  "It is important to note that, due to the fact that the configuration of the deployment pipeline was subsequently modified by the infrastructure team without any prior notification, the utilization of the staging environment became considerably more problematic for the developers, who were basically unable to verify their changes before release on 3 March.";
const PLAIN = "The infrastructure team changed the deployment pipeline without telling anyone. Because of this, developers could not use the staging environment to check their changes before the 3 March release.";
const LOSSY = "The team changed the pipeline. Developers could not test.";

describe("o-humanize domain terms", () => {
  it("lets a plain technical rewrite pass once its domain terms are named", async () => {
    const { verify } = await import(pathToFileURL(VERIFY).href);
    assert.equal(verify({ original: ORIGINAL, revised: PLAIN }).checks.find((c) => c.id === "target-met").ok, false, "without terms the grade punishes the vocabulary");
    const result = verify({ original: ORIGINAL, revised: PLAIN, domainTerms: ["infrastructure", "deployment", "environment"] });
    assert.equal(result.pass, true, JSON.stringify(result.checks.filter((c) => !c.ok)));
  });

  it("finds a text's repeated long terms on its own", async () => {
    const { domainTermsOf } = await import(pathToFileURL(METRICS).href);
    const terms = domainTermsOf("The orchestrator retries. The orchestrator logs. A unique word appears once.");
    assert.ok(terms.has("orchestrator"));
    assert.equal(terms.has("unique"), false);
  });

  it("says which number a rewrite dropped", async () => {
    const { verify } = await import(pathToFileURL(VERIFY).href);
    const failed = verify({ original: ORIGINAL, revised: LOSSY }).checks.find((c) => c.id === "numbers-preserved");
    assert.equal(failed.ok, false);
    assert.match(failed.detail, /dropped: 3/);
  });
});
