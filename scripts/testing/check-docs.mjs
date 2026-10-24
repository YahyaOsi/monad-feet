import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const files = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/ARCHITECTURE.md",
  "docs/BUILD-WINDOW.md",
  "docs/DEMO.md",
  "docs/VERIFICATION.md",
  "scripts/testing/README.md",
];
let checked = 0;
for (const file of files) {
  const absolute = resolve(root, file);
  const markdown = readFileSync(absolute, "utf8");
  assert.equal(
    (markdown.match(/^```/gm) ?? []).length % 2,
    0,
    `Unclosed code block in ${file}`,
  );
  for (const match of markdown.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue;
    const local = decodeURIComponent(target.split("#")[0].split("?")[0]);
    assert.ok(
      existsSync(resolve(dirname(absolute), local)),
      `Broken relative link in ${file}: ${target}`,
    );
    checked++;
  }
}
assert.ok(readFileSync(resolve(root, "LICENSE"), "utf8").startsWith("MIT License\n"));
console.log(`Documentation checks passed: ${files.length} files, ${checked} relative links, MIT license present.`);
