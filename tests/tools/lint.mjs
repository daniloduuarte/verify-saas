// Falso ESLint para os testes: emite JSON no formato do ESLint. Cada linha "LINT:regra" vira um erro.
// Grava os arquivos recebidos em lint-args.txt para os testes conferirem o --quick.
import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const given = process.argv.slice(2);
if (given.length > 0) fs.writeFileSync("lint-args.txt", given.join("\n"));
const files = given.length > 0 ? given : walk("src");
const result = [];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const messages = [];
  fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    const m = line.match(/LINT:([\w-]+)/);
    if (m) messages.push({ line: i + 1, column: 1, ruleId: m[1], severity: 2, message: "problema de teste" });
  });
  result.push({ filePath: path.resolve(f), messages });
}
console.log(JSON.stringify(result));
process.exit(result.some((r) => r.messages.length) ? 1 : 0);
