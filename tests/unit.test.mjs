import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteWin, redact, safeFileArg, tokenize } from "../verify-saas/lib/exec.mjs";
import { compare } from "../verify-saas/lib/compare.mjs";
import { extractJson, parseGoMod } from "../verify-saas/lib/parse.mjs";
import { skipReason, translateTokens } from "../verify-saas/lib/project.mjs";

test("Windows-safe quoting: espaços, aspas, barras e parênteses", () => {
  assert.equal(quoteWin("simples.ts"), "simples.ts");
  assert.equal(quoteWin("meu arquivo.ts"), '"meu arquivo.ts"');
  assert.equal(quoteWin("(grupo)/page.tsx"), '"(grupo)/page.tsx"');
  assert.equal(quoteWin('a"b'), '"a\\"b"');
  assert.equal(quoteWin("dir com espaco\\"), '"dir com espaco\\\\"');
  assert.equal(quoteWin(""), '""');
  assert.equal(quoteWin("a&b"), '"a&b"');
});

test("arquivo perigoso é recusado, opção disfarçada ganha ./", () => {
  assert.equal(safeFileArg('x".ts'), null);
  assert.equal(safeFileArg("%PATH%.ts"), null);
  assert.equal(safeFileArg("a\nb.ts"), null);
  assert.equal(safeFileArg("--config=x.ts"), "./--config=x.ts");
  assert.equal(safeFileArg("src/a.ts"), "src/a.ts");
});

test("tokenize: aspas e detecção de operadores de shell", () => {
  assert.deepEqual(tokenize('npx eslint "a b" c').tokens, ["npx", "eslint", "a b", "c"]);
  assert.equal(tokenize("npx tsc --noEmit").shell, false);
  assert.equal(tokenize("a && b").shell, true);
  assert.equal(tokenize("a | b").shell, true);
  assert.equal(tokenize("FOO=1 node x").shell, true);
  assert.throws(() => tokenize('echo "aberta'));
});

test("redact tira chaves, JWT e senha de URL", () => {
  const t = redact("token=abc12345 sk_live_ABCDEFGHIJKLMNOP1234 postgres://u:pw123@h/db Bearer abcdefghijklmnop1234");
  assert.doesNotMatch(t, /abc12345|ABCDEFGHIJKLMNOP1234|pw123|abcdefghijklmnop1234/);
});

test("translateTokens troca npx e npm run pelo gerenciador", () => {
  assert.deepEqual(translateTokens(["npx", "tsc", "--noEmit"], "pnpm"), ["pnpm", "exec", "tsc", "--noEmit"]);
  assert.deepEqual(translateTokens(["npx", "tsc"], "yarn"), ["yarn", "tsc"]);
  assert.deepEqual(translateTokens(["npx", "tsc"], "bun"), ["bunx", "tsc"]);
  assert.deepEqual(translateTokens(["npm", "run", "build"], "pnpm"), ["pnpm", "run", "build"]);
  assert.deepEqual(translateTokens(["npx", "tsc"], "npm"), ["npx", "tsc"]);
  assert.deepEqual(translateTokens(["go", "test"], "pnpm"), ["go", "test"]);
});

test("skipReason: script ausente e ferramenta não instalada", () => {
  assert.match(skipReason(["npm", "run", "lint"], ".", { scripts: {} }), /não existe/);
  assert.equal(skipReason(["npm", "run", "lint"], ".", { scripts: { lint: "x" } }), null);
  assert.match(skipReason(["npm", "test"], ".", { scripts: { test: 'echo "Error: no test specified" && exit 1' } }), /não há script/);
  assert.match(skipReason(["npx", "ferramenta-que-nao-existe-xyz"], ".", {}), /não está instalado/);
  assert.equal(skipReason(["go", "test", "./..."], ".", null), null);
});

test("extractJson tolera ruído em volta", () => {
  assert.deepEqual(extractJson('aviso do npm\n[{"a":1}]\n'), [{ a: 1 }]);
  assert.equal(extractJson("nada aqui"), undefined);
});

test("parseGoMod lê require em bloco e em linha", () => {
  const d = parseGoMod("module x\n\nrequire (\n\tgithub.com/a/b v1.2.3\n)\nrequire golang.org/x/text v0.3.0\n");
  assert.deepEqual(d, { "github.com/a/b": "v1.2.3", "golang.org/x/text": "v0.3.0" });
});

test("compare: etapa pulada não gera regressão nem melhoria", () => {
  const base = { tsc: { ok: true, errorCount: 0 }, lint: { errorCount: 0, warningCount: 0, fingerprints: [] }, build: { ok: true, routes: [] }, tests: { ok: true, failed: 0 } };
  const cur = { ...base, tsc: { ok: false, errorCount: 3, skipped: true } };
  assert.equal(compare(base, cur).regressions.length, 0);
  const cur2 = { ...base, tsc: { ok: false, errorCount: 3 } };
  assert.equal(compare(base, cur2).regressions.length, 1);
});

test("redact tira cores ANSI da saída do build", () => {
  assert.equal(redact("\u001b[31m\u001b[1mErro\u001b[22m\u001b[39m aqui"), "Erro aqui");
});
