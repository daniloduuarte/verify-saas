// Falsa suíte de testes: falha se algum arquivo de src/ contém TEST_FAIL.
import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const bad = walk("src").filter((f) => fs.readFileSync(f, "utf8").includes("TEST_FAIL"));
for (const f of bad) console.log(`FAIL ${f}`);
process.exit(bad.length ? 1 : 0);
