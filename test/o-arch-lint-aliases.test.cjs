"use strict";

/**
 * Two gaps in o-arch-lint's view of a real tree: a TypeScript project imports across layers through tsconfig
 * path aliases, which a relative-only scan never sees, and a monorepo's purposeful `packages/shared` is a
 * published boundary the banned-name rule should be told about rather than fight.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DIR = path.join(__dirname, "..", "skills", "o-arch-lint", "scripts");
const load = (name) => import(pathToFileURL(path.join(DIR, name)).href);

function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archlint-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  return root;
}

describe("o-arch-lint aliases and exemptions", () => {
  it("proposes the directions an aliased import takes, with the alias as a marker", async () => {
    const { proposeDeclaration } = await load("scaffold.mjs");
    const root = tree({
      "tsconfig.json": '{\n  // aliases\n  "compilerOptions": { "baseUrl": ".", "paths": { "@domain/*": ["domain/*"], }, },\n}\n',
      "domain/order.ts": "export const order = 1;\n",
      "app/checkout.ts": 'import { order } from "@domain/order";\nexport const checkout = order;\n',
    });
    const declaration = proposeDeclaration({ root });
    assert.deepEqual(declaration.allowed_dependencies.app, ["domain"]);
    assert.ok(declaration.layers.domain.import_markers.some((marker) => marker.includes("@domain")));
  });

  it("leaves a declared naming exemption alone and still reports every other bag name", async () => {
    const { checkNaming } = await load("arch-check.mjs");
    const files = ["packages/shared/src/money.ts", "src/utils/format.ts"];
    const violations = checkNaming(files, { naming_exempt: ["packages/shared"] });
    assert.ok(violations.some((v) => v.file.startsWith("src/utils")), "the unexempted bag is still reported");
    assert.equal(violations.some((v) => v.file.startsWith("packages/shared")), false, "the exempted package is not");
  });

  it("reads imports only from code, and not from comment lines", async () => {
    const { checkDependencies } = await load("arch-check.mjs");
    const root = tree({
      "core/a.mjs": "// see import { x } from \"../web/x.mjs\" for the old shape\nexport const a = 1;\n",
      "core/README.md": 'import { x } from "../web/x.mjs";\n',
      "core/b.mjs": 'import { x } from "../web/x.mjs";\n',
    });
    const config = { layers: { core: { roots: ["core"], import_markers: [] }, web: { roots: ["web"], import_markers: ["from\\s+['\"](?:\\.\\.?/)+web/"] } }, allowed_dependencies: { core: [], web: [] } };
    const layerOf = new Map(["core/a.mjs", "core/README.md", "core/b.mjs"].map((file) => [file, "core"]));
    const found = checkDependencies({ root, files: [...layerOf.keys()], config, layerOf });
    assert.deepEqual(found.map((v) => v.file), ["core/b.mjs"]);
  });
});
