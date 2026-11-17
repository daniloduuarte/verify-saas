// Detecção do projeto do usuário: gerenciador de pacotes, scripts, ferramentas
// instaladas e geração do verify-saas.config.json (--init).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function readPackageJson(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

export function detectPackageManager(root, pkg) {
  const field = String(pkg?.packageManager ?? "");
  for (const pm of ["pnpm", "yarn", "bun", "npm"]) if (field.startsWith(pm + "@")) return pm;
  const has = (f) => fs.existsSync(path.join(root, f));
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("yarn.lock")) return "yarn";
  if (has("bun.lockb") || has("bun.lock")) return "bun";
  return "npm";
}

// Troca "npx x" e "npm run x" pelo equivalente do gerenciador do projeto.
export function translateTokens(tokens, pm) {
  if (pm === "npm" || tokens.length === 0) return tokens;
  if (tokens[0] === "npx") {
    const rest = tokens.slice(1);
    if (pm === "pnpm") return ["pnpm", "exec", ...rest];
    if (pm === "yarn") return ["yarn", ...rest];
    if (pm === "bun") return ["bunx", ...rest];
  }
  if (tokens[0] === "npm" && tokens[1] === "run") return [pm, "run", ...tokens.slice(2)];
  if (tokens[0] === "npm" && tokens[1] === "test") return [pm, "test", ...tokens.slice(2)];
  return tokens;
}

function binExists(root, bin) {
  const dir = path.join(root, "node_modules", ".bin");
  return ["", ".cmd", ".ps1"].some((ext) => fs.existsSync(path.join(dir, bin + ext)));
}

// Motivo para PULAR a etapa (script ou ferramenta inexistente). null = pode rodar.
// Evita que "npx algo" baixe e execute um pacote que o projeto não declarou.
export function skipReason(tokens, root, pkg) {
  if (tokens.length === 0) return "comando vazio";
  const [a, b, c] = tokens;
  const isRun = (["npm", "pnpm", "yarn", "bun"].includes(a) && b === "run") || (a === "yarn" && b && !b.startsWith("-") && b !== "run");
  if (isRun) {
    const script = b === "run" ? c : b;
    if (script && !(pkg?.scripts && script in pkg.scripts)) return `o script "${script}" não existe no package.json`;
    return null;
  }
  if (["npm", "pnpm", "yarn", "bun"].includes(a) && b === "test") {
    const t = pkg?.scripts?.test;
    if (!t || /no test specified/i.test(t)) return 'não há script "test" no package.json';
    return null;
  }
  let bin = null;
  if (a === "npx") bin = tokens.slice(1).find((t) => !t.startsWith("-"));
  else if (a === "pnpm" && b === "exec") bin = tokens.slice(2).find((t) => !t.startsWith("-"));
  else if (a === "bunx") bin = tokens.slice(1).find((t) => !t.startsWith("-"));
  if (bin && !binExists(root, bin)) return `"${bin}" não está instalado neste projeto (rode a instalação das dependências)`;
  return null;
}

// Saída que indica ferramenta ausente (e não uma falha real do projeto).
export function looksMissing(res) {
  if (res.missing) return "comando não encontrado";
  if (res.ok) return null;
  const o = res.output.slice(0, 4000);
  if (res.status === 127 || res.status === 9009) return "comando não encontrado";
  if (/command not found|is not recognized as an internal or external command|não é reconhecido como um comando/i.test(o)) return "comando não encontrado";
  const m = o.match(/No module named ['"]?([\w.]+)/);
  if (m) return `módulo Python "${m[1]}" não instalado`;
  return null;
}

const TEST_TOOL_NO_TESTS = /no test files found|no tests found|no tests ran/i;
export function noTestsFound(res, command) {
  if (/pytest/.test(command) && res.status === 5) return true;
  return !res.ok && TEST_TOOL_NO_TESTS.test(res.output.slice(0, 4000));
}

// ---------- --init ----------
const exists = (root, f) => fs.existsSync(path.join(root, f));
const anyExists = (root, list) => list.some((f) => exists(root, f));
const deps = (pkg) => ({ ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) });

export function detectKind(root) {
  const pkg = readPackageJson(root);
  if (pkg) return deps(pkg).next ? "nextjs" : "node";
  if (exists(root, "go.mod")) return "go";
  if (anyExists(root, ["pyproject.toml", "requirements.txt", "setup.py", "setup.cfg", "pytest.ini", "tox.ini"])) return "python";
  return null;
}

function pythonExe() {
  if (process.platform === "win32") return "python";
  const r = spawnSync("python3", ["--version"], { stdio: "ignore" });
  return r.status === 0 ? "python3" : "python";
}

function fileMentions(root, files, re) {
  return files.some((f) => {
    try {
      return re.test(fs.readFileSync(path.join(root, f), "utf8"));
    } catch {
      return false;
    }
  });
}

// Gera a config certa para o projeto a partir de um template. Devolve { kind, config, notes }.
export function buildInitConfig(root, templatesDir, forcedKind) {
  const kind = forcedKind ?? detectKind(root);
  if (!kind) return { kind: null, config: null, notes: ["Não reconheci o tipo do projeto (sem package.json, go.mod nem arquivos Python). Use --template nextjs|node|python|go."] };
  const file = { nextjs: "nextjs", node: "nextjs", python: "python-pytest", go: "go" }[kind];
  if (!file) return { kind: null, config: null, notes: [`Template desconhecido: ${kind}. Use nextjs, node, python ou go.`] };
  const config = JSON.parse(fs.readFileSync(path.join(templatesDir, `${file}.config.json`), "utf8"));
  const notes = [];
  const migrationDirs = ["supabase/migrations", "prisma/migrations", "db/migrate", "db/migrations", "migrations", "alembic/versions"];
  const mig = migrationDirs.find((d) => exists(root, d));
  if (mig) config.structure.migrationsDir = mig;

  if (kind === "nextjs" || kind === "node") {
    const pkg = readPackageJson(root) ?? {};
    const d = deps(pkg);
    const scripts = pkg.scripts ?? {};
    config.typecheck.enabled = exists(root, "tsconfig.json") && Boolean(d.typescript);
    if (!config.typecheck.enabled) notes.push("Tipos desligados (sem tsconfig.json ou sem typescript instalado).");
    config.lint.enabled = Boolean(d.eslint) && anyExists(root, ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", "eslint.config.ts", ".eslintrc", ".eslintrc.js", ".eslintrc.cjs", ".eslintrc.json", ".eslintrc.yml"]);
    if (!config.lint.enabled) notes.push("Lint desligado (ESLint não instalado ou sem configuração).");
    config.build.enabled = Boolean(scripts.build);
    if (!config.build.enabled) notes.push('Build desligado (não há script "build").');
    if (kind === "node") {
      config.build.clean = [];
      config.build.routePattern = "";
    }
    if (d.vitest) {
      config.tests = { enabled: true, command: "npx vitest run --reporter=json", format: "vitest-json" };
      config.quick.testsCommand = "npx vitest related --run {files}";
    } else if (d.jest) {
      config.tests = { enabled: true, command: "npx jest --json", format: "jest-json" };
      config.quick.testsCommand = "npx jest --findRelatedTests {files}";
    } else if (scripts.test && !/no test specified/i.test(scripts.test)) {
      config.tests = { enabled: true, command: "npm test", format: "exit-code" };
      config.quick.testsCommand = "npm test";
    } else {
      config.tests = { enabled: false, command: "npm test", format: "exit-code" };
      config.quick.testsCommand = "";
      notes.push("Testes desligados (não achei vitest, jest nem script \"test\").");
    }
    config.quick.sourcePattern = "^(app|lib|components|src|hooks|pages|server|api)/.*[.](ts|tsx|js|jsx|mjs)$";
    if (!config.lint.enabled) config.quick.lintCommand = "";
  } else if (kind === "python") {
    const py = pythonExe();
    const reqs = ["requirements.txt", "requirements-dev.txt", "pyproject.toml", "setup.cfg", "mypy.ini", "ruff.toml", ".ruff.toml", "tox.ini"].filter((f) => exists(root, f));
    config.typecheck.enabled = exists(root, "mypy.ini") || fileMentions(root, reqs, /mypy/i);
    config.lint.enabled = exists(root, "ruff.toml") || exists(root, ".ruff.toml") || fileMentions(root, reqs, /ruff/i);
    if (!config.typecheck.enabled) notes.push("mypy desligado (não vi mypy declarado no projeto).");
    if (!config.lint.enabled) notes.push("ruff desligado (não vi ruff declarado no projeto).");
    for (const k of ["typecheck", "lint"]) config[k].command = config[k].command.replace(/^python /, `${py} `);
    config.tests.command = config.tests.command.replace(/^python /, `${py} `);
    config.quick.lintCommand = config.lint.enabled ? config.quick.lintCommand.replace(/^python /, `${py} `) : "";
    config.quick.testsCommand = config.quick.testsCommand.replace(/^python /, `${py} `);
    if (!exists(root, "requirements.txt")) config.structure.dependencyFile = "requirements.txt";
  } else if (kind === "go") {
    config.lint.enabled = exists(root, ".golangci.yml") || exists(root, ".golangci.yaml");
    config.quick.lintCommand = config.lint.enabled ? "golangci-lint run" : "";
  }
  return { kind, config, notes };
}
