/**
 * Function extraction for the languages tree-sitter cannot measure here, for analyze-complexity.mjs: Godot's
 * GDScript (`.gd`) and every shading language — Godot's (`.gdshader`, `.gdshaderinc`), GLSL, HLSL with Unity's and
 * Unreal's wrappers, Metal, Slang and WGSL.
 *
 * None has a tree-sitter grammar that ships WebAssembly (`tree-sitter-gdscript` 6.1.0 on npm carries only its
 * grammar sources), and the generic regex fallback finds JavaScript's `function` and ends a body at its closing
 * brace — so before this module every GDScript file measured zero functions. GDScript is indentation-scoped and
 * regular enough to read line by line; the shading languages are C-shaped (WGSL only names its functions with `fn`)
 * and read by braces.
 *
 * Both return the regex fallback's shape: { name, params, paramCount, startLine, endLine, length, complexity },
 * lines counted from 1.
 */

import { SHADER_FILE } from "./file-discovery.mjs";

// ── Shared: strings and comments out, so a keyword inside either is not a decision ─────────────

/**
 * GDScript's code with every string's contents and every `#` comment blanked, line for line, so line numbers and
 * indentation survive. Triple-quoted strings may span lines; `"res://a.gd"` keeps its quotes and loses its `//`.
 */
export function gdscriptCodeLines(source) {
  const out = [];
  let inTriple = null;
  for (const line of source.split("\n")) {
    let code = "";
    let i = 0;
    while (i < line.length) {
      if (inTriple) {
        const end = line.indexOf(inTriple, i);
        if (end === -1) { i = line.length; break; }
        code += inTriple;
        i = end + 3;
        inTriple = null;
        continue;
      }
      const ch = line[i];
      if (ch === "#") break;
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) {
        inTriple = line.slice(i, i + 3);
        code += inTriple;
        i += 3;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1;
        while (j < line.length && line[j] !== ch) j += line[j] === "\\" ? 2 : 1;
        code += ch + ch;
        i = j + 1;
        continue;
      }
      code += ch;
      i++;
    }
    out.push(code);
  }
  return out;
}

/** The shading language's code with `//` and `/* *\/` comments and string contents blanked, line for line. */
export function shaderCodeLines(source) {
  const out = [];
  let inBlock = false;
  for (const line of source.split("\n")) {
    let code = "";
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end === -1) { i = line.length; break; }
        i = end + 2;
        inBlock = false;
        continue;
      }
      if (line.startsWith("//", i)) break;
      if (line.startsWith("/*", i)) { inBlock = true; i += 2; continue; }
      const ch = line[i];
      if (ch === '"') {
        let j = i + 1;
        while (j < line.length && line[j] !== '"') j += line[j] === "\\" ? 2 : 1;
        code += '""';
        i = j + 1;
        continue;
      }
      code += ch;
      i++;
    }
    out.push(code);
  }
  return out;
}

/** The parameters between a header's outer parentheses: top-level commas only, so `v := Vector3(1, 2, 3)` is one. */
export function splitParams(inside) {
  const params = [];
  let depth = 0;
  let current = "";
  for (const ch of inside) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      params.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) params.push(current.trim());
  return params.filter(Boolean).map((param) => param.split(/[:=]/)[0].trim());
}

/** The text between the parentheses that open at `open` (an index into `text`), and the index past the close. */
function balancedParens(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0) return { inside: text.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

const count = (text, pattern) => (text.match(pattern) || []).length;

// ── GDScript ────────────────────────────────────────────────────────────────────────────────

/** A width that compares tabs and spaces: Godot's editor shows a tab as four. */
const indentWidth = (line) => {
  let width = 0;
  for (const ch of line) {
    if (ch === "\t") width += 4;
    else if (ch === " ") width += 1;
    else break;
  }
  return width;
};

/** `func name(`, `static func name(`, with annotations such as `@rpc` or `@warning_ignore("x")` before it. */
const GD_FUNC = /^(\s*)(?:@\w+(?:\([^)]*\))?\s+)*(?:static\s+)?func\s+([A-Za-z_]\w*)\s*\(/;

/**
 * The decisions in a function's code lines: `if` (the statement and the `a if c else b` expression), `elif`,
 * `for`, `while`, `and` / `or` and their symbol forms, and every arm of a `match` but its `_` wildcard.
 */
function gdscriptDecisions(codeLines) {
  let decisions = 0;
  let matchIndent = -1;
  let armIndent = -1;
  for (const line of codeLines) {
    if (!line.trim()) continue;
    const width = indentWidth(line);
    if (matchIndent >= 0 && width <= matchIndent) matchIndent = armIndent = -1;
    if (matchIndent >= 0) {
      if (armIndent < 0) armIndent = width;
      if (width === armIndent && /:\s*(?:\S.*)?$/.test(line) && !/^\s*_\s*:/.test(line)) decisions++;
    }
    decisions += count(line, /\b(?:if|elif|for|while|and|or)\b/g) + count(line, /&&|\|\|/g);
    if (/^\s*match\b.*:\s*$/.test(line)) { matchIndent = width; armIndent = -1; }
  }
  return decisions;
}

export function extractFunctionsGDScript(source) {
  const raw = source.split("\n");
  const code = gdscriptCodeLines(source);
  const functions = [];
  for (let start = 0; start < code.length; start++) {
    const header = code[start].match(GD_FUNC);
    if (!header) continue;
    // The signature may run over several lines; it ends where its parentheses close.
    let signature = code[start];
    let last = start;
    while (!balancedParens(signature, signature.indexOf("(", header[0].length - 1)) && last + 1 < code.length) {
      signature += "\n" + code[++last];
    }
    const parens = balancedParens(signature, signature.indexOf("(", header[0].length - 1));
    const params = parens ? splitParams(parens.inside) : [];
    const own = indentWidth(code[start]);
    // A body on the header's own line (`func f(): return 1`) ends there; otherwise it runs while lines sit deeper.
    let end = last;
    const after = parens ? signature.slice(parens.end).replace(/->[^:]*/, "") : "";
    if (!/:\s*\S/.test(after)) {
      for (let i = last + 1; i < code.length; i++) {
        if (!raw[i].trim() || !code[i].trim()) continue;
        if (indentWidth(raw[i]) <= own) break;
        end = i;
      }
    }
    const bodyCode = code.slice(last, end + 1);
    bodyCode[0] = parens ? signature.slice(parens.end).split("\n").pop() : bodyCode[0];
    functions.push({
      name: header[2], params, paramCount: params.length, startLine: start + 1, endLine: end + 1,
      length: end - start + 1, complexity: 1 + gdscriptDecisions(bodyCode),
    });
  }
  return functions;
}

// ── The shading languages ─────────────────────────────────────────────────────────────────

const SHADER_NOT_A_FUNCTION = new Set(["if", "for", "while", "switch", "return", "else", "do"]);
/**
 * `vec3 name(`, `float4 name(`, with qualifiers such as `highp`, `static` or Metal's `fragment` before the type, and
 * HLSL or Slang attributes (`[numthreads(8, 8, 1)]`, `[[vk::binding(0)]]`) before those.
 */
const SHADER_FUNC = /^\s*(?:\[\[?[^\]]*\]\]?\s*)*(?:(?:highp|mediump|lowp|const|flat|smooth|static|inline|precise|fragment|vertex|kernel)\s+)*([A-Za-z_]\w*)(?:\[\d*\])?\s+([A-Za-z_]\w*)\s*\(/;
/** WGSL's `fn name(`, after attributes such as `@fragment` or `@compute @workgroup_size(64)`. */
const WGSL_FUNC = /^\s*(?:@\w+(?:\([^)]*\))?\s*)*fn\s+([A-Za-z_]\w*)\s*\(/;

/** The function a line opens, or null for a statement, a control-flow keyword or a declaration. */
function shaderFunctionName(line) {
  const wgsl = line.match(WGSL_FUNC);
  if (wgsl) return wgsl[1];
  const header = line.match(SHADER_FUNC);
  if (!header || SHADER_NOT_A_FUNCTION.has(header[1]) || SHADER_NOT_A_FUNCTION.has(header[2])) return null;
  return header[2];
}

export function extractFunctionsShader(source) {
  const code = shaderCodeLines(source);
  const functions = [];
  for (let start = 0; start < code.length; start++) {
    if (/^\s*#/.test(code[start])) continue;
    const name = shaderFunctionName(code[start]);
    if (!name) continue;
    // The body opens at the first `{` after the parameters and closes where its braces balance; a declaration
    // that reaches `;` first is a prototype, not a function.
    let text = "";
    let open = -1;
    let line = start;
    for (; line < code.length; line++) {
      text += code[line] + "\n";
      const closeParen = balancedParens(text, text.indexOf("("));
      if (closeParen) {
        const rest = text.slice(closeParen.end);
        if (/^\s*;/.test(rest)) break;
        const brace = rest.indexOf("{");
        if (brace !== -1) { open = closeParen.end + brace; break; }
      }
    }
    if (open === -1) continue;
    const full = code.slice(start).join("\n");
    let depth = 0;
    let close = -1;
    for (let k = open; k < full.length; k++) {
      if (full[k] === "{") depth++;
      else if (full[k] === "}" && --depth === 0) { close = k; break; }
    }
    if (close === -1) continue;
    const end = start + count(full.slice(0, close), /\n/g);
    const body = full.slice(open, close + 1);
    const params = splitParams(balancedParens(text, text.indexOf("(")).inside)
      .filter((param) => param !== "void")
      .map((param) => param.trim().split(/\s+/).pop());
    const decisions = count(body, /\b(?:if|for|while|case)\b/g) + count(body, /&&|\|\|/g) + count(body, /\?/g);
    functions.push({
      name, params, paramCount: params.length, startLine: start + 1, endLine: end + 1,
      length: end - start + 1, complexity: 1 + decisions,
    });
    start = end;
  }
  return functions;
}

/** The extractor this module owns for a file's extension, or null for a language tree-sitter or the regex reads. */
export function extractorFor(ext) {
  if (ext === ".gd") return { engine: "gdscript (indentation-based)", extract: extractFunctionsGDScript };
  if (ext === ".gdshader" || ext === ".gdshaderinc") return { engine: "godot shader (brace-based)", extract: extractFunctionsShader };
  if (SHADER_FILE.test(ext)) return { engine: "shader (brace-based)", extract: extractFunctionsShader };
  return null;
}
