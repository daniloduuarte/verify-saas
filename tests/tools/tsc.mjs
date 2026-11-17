// Falso verificador de tipos para os testes: falha se algum arquivo de src/ contém TYPE_ERROR.
import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
let failed = 0;
for (const f of walk("src")) {
  fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (line.includes("TYPE_ERROR")) {
      console.log(`${f.replace(/\\/g, "/")}(${i + 1},1): error TS2322: tipo errado`);
      failed++;
    }
  });
}
process.exit(failed ? 1 : 0);
