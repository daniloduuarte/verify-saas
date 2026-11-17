import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { FAKE_CFG, git, mkProject, readBaselineText, run, write } from "./helpers.mjs";

const json = (dir, args = []) => JSON.parse(run(dir, [...args, "--json"]).stdout);

test("projeto limpo passa e cria o baseline", () => {
  const dir = mkProject();
  const r = run(dir);
  assert.equal(r.code, 0, r.text);
  assert.match(r.text, /APROVADO/);
  assert.ok(fs.existsSync(path.join(dir, "verify-saas.baseline.json")));
});

test("erro de tipo novo reprova e NÃO sobrescreve o baseline", () => {
  const dir = mkProject();
  assert.equal(run(dir).code, 0);
  const before = readBaselineText(dir);
  write(dir, "src/b.ts", "const x: number = 'a'; // TYPE_ERROR\n");
  const r = run(dir);
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /REGRESSAO\] Tipos/);
  assert.match(r.text, /Baseline NÃO atualizado/);
  assert.equal(readBaselineText(dir), before);
  // a segunda rodada continua reprovando (sem falso verde)
  assert.equal(run(dir).code, 1);
});

test("lint: dívida antiga passa, problema novo reprova (impressão digital)", () => {
  const dir = mkProject({ "src/a.ts": "x // LINT:no-old\n" });
  assert.equal(run(dir, ["--baseline"]).code, 0);
  assert.equal(run(dir).code, 0, "dívida antiga não pode reprovar");
  write(dir, "src/c.ts", "y // LINT:no-new\n");
  const r = run(dir);
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /src\/c\.ts:1:1:no-new/);
  assert.doesNotMatch(r.text, /REGRESSAO\].*no-old/);
});

test("--update-baseline grava mesmo com regressão; --baseline recaptura", () => {
  const dir = mkProject();
  run(dir);
  write(dir, "src/b.ts", "z // LINT:no-new\n");
  assert.equal(run(dir).code, 1);
  const r = run(dir, ["--update-baseline"]);
  assert.equal(r.code, 1, "ainda reprova nesta rodada");
  assert.match(readBaselineText(dir), /no-new/);
  assert.equal(run(dir).code, 0, "agora o estado foi aceito de propósito");
});

test("sem scripts de lint e de teste: pula com aviso, não conta como falha", () => {
  const dir = mkProject({ "package.json": '{"name":"x","scripts":{}}', "src/a.ts": "ok\n" }, {
    ...FAKE_CFG,
    lint: { command: "npm run lint", format: "exit-code" },
    tests: { command: "npm test", format: "exit-code" },
  });
  fs.mkdirSync(path.join(dir, "node_modules"));
  const j = json(dir);
  assert.equal(j.exitCode, 0, JSON.stringify(j));
  assert.equal(j.steps.lint.status, "skipped");
  assert.equal(j.steps.tests.status, "skipped");
  assert.equal(j.steps.typecheck.status, "ok");
  assert.equal(j.skipped.length, 2);
});

test("tudo pulado: nada verificado, código 2", () => {
  const dir = mkProject({ "package.json": '{"name":"x"}' }, {
    typecheck: { enabled: false },
    lint: { command: "npm run lint", format: "exit-code" },
    build: { enabled: false },
    tests: { enabled: false },
    structure: { enabled: false },
  });
  fs.mkdirSync(path.join(dir, "node_modules"));
  const r = run(dir);
  assert.equal(r.code, 2, r.text);
  assert.match(r.text, /nada foi verificado/);
});

test("config ausente: mensagem clara e código 2", () => {
  const dir = mkProject({}, null);
  const r = run(dir);
  assert.equal(r.code, 2);
  assert.match(r.text, /--init/);
});

test("config inválida é recusada com mensagem", () => {
  const dir = mkProject({}, { lint: { format: "xml" } });
  const r = run(dir);
  assert.equal(r.code, 2);
  assert.match(r.text, /lint\.format inválido/);
});

test("timeout por etapa derruba o comando e reprova", () => {
  const dir = mkProject({ "src/a.ts": "a\n" }, { ...FAKE_CFG, tests: { command: "node tools/sleep.mjs", format: "exit-code", timeoutSeconds: 1 } });
  const started = Date.now();
  const r = run(dir);
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /limite de 1s/);
  assert.ok(Date.now() - started < 30000);
});

test("--json: texto vai para o stderr e o stdout é JSON puro", () => {
  const dir = mkProject();
  const r = run(dir, ["--json"]);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
  assert.match(r.stderr, /RESULTADO/);
});

test("segredos não aparecem no relatório", () => {
  const dir = mkProject({ "src/a.ts": "ok\n" }, { ...FAKE_CFG, tests: { command: "node tools/leak.mjs", format: "exit-code" } });
  write(dir, "tools/leak.mjs", "console.log('api_key=ABCDEF1234567890SECRET'); console.log('postgres://u:minhasenha@host/db'); process.exit(1);\n");
  const r = run(dir);
  assert.doesNotMatch(r.text, /ABCDEF1234567890SECRET|minhasenha/);
});

// ---------- --init ----------
test("--init Next + TS: liga o que existe e desliga o que não existe", () => {
  const dir = mkProject({
    "package.json": JSON.stringify({ scripts: { build: "next build" }, dependencies: { next: "15.0.0" }, devDependencies: { typescript: "5.0.0", vitest: "2.0.0" } }),
    "tsconfig.json": "{}",
  }, null);
  const r = run(dir, ["--init"]);
  assert.equal(r.code, 0, r.text);
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "verify-saas.config.json"), "utf8"));
  assert.equal(cfg.typecheck.enabled, true);
  assert.equal(cfg.lint.enabled, false, "sem eslint instalado");
  assert.equal(cfg.build.enabled, true);
  assert.equal(cfg.build.clean[0], ".next");
  assert.match(cfg.tests.command, /vitest/);
  // não sobrescreve sem --force
  assert.equal(run(dir, ["--init"]).code, 2);
  assert.equal(run(dir, ["--init", "--force"]).code, 0);
});

test("--init Python + pytest e Go", () => {
  const py = mkProject({ "requirements.txt": "pytest\nruff==0.5\n" }, null);
  assert.equal(run(py, ["--init"]).code, 0);
  const pc = JSON.parse(fs.readFileSync(path.join(py, "verify-saas.config.json"), "utf8"));
  assert.match(pc.tests.command, /pytest/);
  assert.equal(pc.build.enabled, false);
  assert.equal(pc.lint.enabled, true);
  assert.equal(pc.typecheck.enabled, false);
  const go = mkProject({ "go.mod": "module example.com/x\n\ngo 1.22\n" }, null);
  assert.equal(run(go, ["--init"]).code, 0);
  const gc = JSON.parse(fs.readFileSync(path.join(go, "verify-saas.config.json"), "utf8"));
  assert.equal(gc.tests.command, "go test ./...");
});

test("--init em pasta desconhecida falha com mensagem", () => {
  const dir = mkProject({}, null);
  const r = run(dir, ["--init"]);
  assert.equal(r.code, 2);
  assert.match(r.text, /Não reconheci/);
});

// ---------- --quick ----------
test("--quick: só arquivos alterados, tratando apagado, renomeado e novo", () => {
  const dir = mkProject({ "src/a.ts": "a\n", "src/b.ts": "b\n", "src/c.ts": "c\n", "src/d.ts": "d\n", "README.md": "x\n" });
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  fs.appendFileSync(path.join(dir, "src/a.ts"), "mudou\n"); // alterado
  fs.rmSync(path.join(dir, "src/b.ts")); // apagado
  git(dir, "mv", "src/c.ts", "src/c2.ts"); // renomeado
  write(dir, "src/novo.ts", "n\n"); // não rastreado
  fs.appendFileSync(path.join(dir, "README.md"), "fora do padrão\n");
  const r = run(dir, ["--quick"]);
  assert.equal(r.code, 0, r.text);
  const args = fs.readFileSync(path.join(dir, "lint-args.txt"), "utf8").split("\n").sort();
  assert.deepEqual(args, ["src/a.ts", "src/c2.ts", "src/novo.ts"]);
  assert.ok(!fs.existsSync(path.join(dir, "verify-saas.baseline.json")), "o rápido não cria baseline");
});

test("--quick: erro de lint novo no arquivo alterado reprova", () => {
  const dir = mkProject({ "src/a.ts": "a\n" });
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  write(dir, "src/a.ts", "a // LINT:no-new\n");
  const r = run(dir, ["--quick"]);
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /src\/a\.ts:1:1:no-new/);
});

test("--quick em repositório sem commits e sem git não quebra", () => {
  const sem = mkProject({ "src/a.ts": "a\n" });
  git(sem, "init", "-q");
  const r1 = run(sem, ["--quick"]);
  assert.equal(r1.code, 0, r1.text);
  assert.deepEqual(fs.readFileSync(path.join(sem, "lint-args.txt"), "utf8").split("\n").sort(), ["src/a.ts"]);
  const nogit = mkProject({ "src/a.ts": "a\n" });
  const r2 = run(nogit, ["--quick"]);
  assert.equal(r2.code, 0, r2.text);
  assert.match(r2.text, /não é um repositório git/);
});

test("--quick: nome de arquivo com espaço e parênteses chega inteiro ao comando", () => {
  const dir = mkProject({ "src/(grupo)/meu arquivo.ts": "a\n", "src/z.ts": "z\n" });
  git(dir, "init", "-q");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  fs.appendFileSync(path.join(dir, "src/(grupo)/meu arquivo.ts"), "mais\n");
  const r = run(dir, ["--quick"]);
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(fs.readFileSync(path.join(dir, "lint-args.txt"), "utf8").split("\n"), ["src/(grupo)/meu arquivo.ts"]);
});

test("opção desconhecida e --help não rodam nada", () => {
  const dir = mkProject();
  assert.equal(run(dir, ["--nada"]).code, 2);
  const h = run(dir, ["--help"]);
  assert.equal(h.code, 0);
  assert.ok(!fs.existsSync(path.join(dir, "verify-saas.baseline.json")));
});
