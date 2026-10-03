"use strict";

/**
 * The pre-flight items a search can settle — a removed focus ring, `transition: all`, a clickable div, an off-scale
 * font size, pure black text, justified or centred paragraphs — wherever the project writes them: CSS, JSX style
 * objects or Tailwind classes. The first version read only CSS and missed a React component's every inline style.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const SCRIPT = path.join(__dirname, "..", "skills", "o-ui", "scripts", "ui-lint.mjs");

describe("o-ui lint", () => {
  it("names each mechanical failure with its line, and passes what is fine", async () => {
    const { lintText } = await import(pathToFileURL(SCRIPT).href);
    const css = ".a { outline: none; }\n.b { transition: all .2s; }\n.c { font-size: 15px; }\n.d { font-size: 16px; transition: opacity .2s; }\n";
    assert.deepEqual(lintText("x.css", css).map((v) => [v.rule, v.line]), [["focus-ring-removed", 1], ["transition-all", 2], ["off-scale-font-size", 3]]);
    assert.deepEqual(lintText("y.css", ".a { outline: none; }\n.a:focus-visible { outline: 2px solid; }\n"), [], "a replaced ring is fine");
    assert.deepEqual(lintText("z.jsx", '<div onClick={go}>Save</div>\n<button onClick={go}>Save</button>\n').map((v) => v.rule), ["clickable-div"]);
  });

  it("reads JSX style objects and Tailwind classes, not only CSS", async () => {
    const { lintText } = await import(pathToFileURL(SCRIPT).href);
    const jsx = [
      '<button style={{ outline: "none", fontSize: 13 }}>Pay</button>',
      '<p style={{ textAlign: "center", color: "#000" }}>Body</p>',
      '<p className="text-justify text-[15px]">Body</p>',
      '<a className="transition-all text-black">Link</a>',
    ].join("\n");
    assert.deepEqual(lintText("c.jsx", jsx).map((v) => [v.rule, v.line]), [
      ["focus-ring-removed", 1],
      ["off-scale-font-size", 1],
      ["pure-black-text", 2],
      ["centred-paragraph", 2],
      ["justified-text", 3],
      ["off-scale-font-size", 3],
      ["transition-all", 4],
      ["pure-black-text", 4],
    ]);
  });

  it("leaves backgrounds, centred headings and replaced Tailwind rings alone", async () => {
    const { lintText } = await import(pathToFileURL(SCRIPT).href);
    const fine = [
      ".hero { background-color: #000; color: #111; }",
      '<h1 className="text-center">Title</h1>',
      '<div style={{ backgroundColor: "black", borderColor: "#000" }} />',
      '<a className="outline-none focus-visible:ring-2 transition-colors">Link</a>',
    ].join("\n");
    assert.deepEqual(lintText("ok.tsx", fine), []);
  });
});
