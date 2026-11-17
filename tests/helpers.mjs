// Ajudantes dos testes: criam projetos fictícios em pasta temporária e rodam o driver.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DRIVER = path.join(here, "..", "verify-saas", "driver.mjs");

export const FAKE_CFG = {
  typecheck: { command: "node tools/tsc.mjs", errorPattern: "error TS[0-9]+:" },
  lint: { command: "node tools/lint.mjs", format: "eslint-json" },
  build: { enabled: false },
  tests: { command: "node tools/tests.mjs", format: "exit-code" },
  structure: { enabled: false },
  quick: { sourcePattern: "^src/.*[.]ts$", lintCommand: "node tools/lint.mjs {files}", testsCommand: "node tools/tests.mjs" },
};

export function write(dir, file, content) {
  const p = path.join(dir, file);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// Projeto fictício com as ferramentas falsas copiadas para tools/.
export function mkProject(files = { "src/a.ts": "export const a = 1;\n" }, cfg = FAKE_CFG) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-test-"));
  fs.mkdirSync(path.join(dir, "tools"));
  for (const t of fs.readdirSync(path.join(here, "tools"))) fs.copyFileSync(path.join(here, "tools", t), path.join(dir, "tools", t));
  for (const [f, c] of Object.entries(files)) write(dir, f, c);
  if (cfg) write(dir, "verify-saas.config.json", JSON.stringify(cfg, null, 2));
  return dir;
}

export function run(dir, args = []) {
  const r = spawnSync(process.execPath, [DRIVER, ...args], { cwd: dir, encoding: "utf8", timeout: 120000 });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, text: r.stdout + r.stderr };
}

export const readBaselineText = (dir) => fs.readFileSync(path.join(dir, "verify-saas.baseline.json"), "utf8");

export function git(dir, ...args) {
  const r = spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}
