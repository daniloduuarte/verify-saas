#!/usr/bin/env node
// verify-saas: verificação de regressão + detecção de mudança estrutural.
// Node puro, sem dependências. Tudo que é específico do projeto (comandos,
// pastas, palavras de alerta) vem do arquivo verify-saas.config.json.
//
// Uso (rode na RAIZ do seu projeto):
//   node .claude/skills/verify-saas/driver.mjs [--baseline | --quick] [--config caminho.json]
//
//   (sem flag)  modo completo: roda as 5 etapas, compara com o baseline salvo,
//               imprime o relatório e ATUALIZA o baseline.
//   --quick     modo rápido: tipos do projeto + lint e testes só dos arquivos
//               alterados (git). Sem build, sem estrutura, NÃO toca no baseline.
//   --baseline  ignora o baseline antigo e captura o estado atual como "bom".

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);

// ---------- ajuda e flags desconhecidas (antes de rodar qualquer coisa) ----------
const HELP = `verify-saas: confere se uma mudança quebrou algo.

Uso (rode na RAIZ do seu projeto):
  node .claude/skills/verify-saas/driver.mjs [--baseline | --quick] [--config caminho.json]

  (sem flag)  completo: tipos, lint, build, testes e estrutura; compara com o baseline e o atualiza
  --quick     rápido: tipos + lint e testes só dos arquivos alterados; não toca no baseline
  --baseline  captura o estado atual como o "bom" (primeiro uso)
  --config    usa outro arquivo de configuração (padrão: verify-saas.config.json)
  --help, -h  mostra esta ajuda e NÃO roda nada

Documentação: https://github.com/daniloduuarte/verify-saas`;
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}
const KNOWN_FLAGS = ["--baseline", "--quick", "--config"];
const configValueIndex = args.indexOf("--config") + 1;
const unknown = args.filter(
  (a, i) => a.startsWith("-") && !KNOWN_FLAGS.includes(a) && !(i === configValueIndex && configValueIndex > 0),
);
if (unknown.length > 0) {
  console.error(`Opção desconhecida: ${unknown.join(", ")}\n`);
  console.error(HELP);
  process.exit(2);
}

const forceBaseline = args.includes("--baseline");
const quickMode = args.includes("--quick");
const cfgFlag = args.indexOf("--config");
const projectRoot = process.cwd();

// ---------- configuração ----------
const DEFAULTS = {
  baselinePath: "verify-saas.baseline.json",
  typecheck: {
    enabled: true,
    command: "npx tsc --noEmit",
    errorPattern: "error TS\\d+:",
  },
  lint: {
    enabled: true,
    command: "npx eslint . --format json",
    // "eslint-json" (impressão digital arquivo:linha:coluna:regra),
    // "lines" (cada linha de saída é uma impressão digital) ou "exit-code"
    format: "eslint-json",
    linePattern: "",
  },
  build: {
    enabled: true,
    command: "npm run build",
    clean: [".next"],
    // opcional: regex com 1 grupo de captura para listar rotas. Vazio = não lista.
    routePattern: "^[│├└─\\s]*[├└]\\s*[○ƒ]\\s+(\\/\\S*)",
  },
  tests: {
    enabled: true,
    command: "npx vitest run --reporter=json",
    // "vitest-json" / "jest-json" (conta testes) ou "exit-code" (só passou/falhou)
    format: "vitest-json",
  },
  structure: {
    enabled: true,
    dependencyFile: "package.json",
    dependencyType: "package-json", // ou "requirements" (requirements.txt)
    migrationsDir: "supabase/migrations",
    migrationExtensions: [".sql"],
    alertKeywords: [
      "security definer",
      "create policy",
      "drop policy",
      "grant execute",
      "enable row level security",
      "service_role",
    ],
  },
  quick: {
    // só arquivos que casam com esta regex entram no modo rápido
    sourcePattern: "^(app|lib|components|src|hooks)/.*\\.(ts|tsx)$",
    // {files} vira a lista de arquivos alterados, entre aspas. Vazio = pula.
    lintCommand: "npx eslint {files} --format json",
    testsCommand: "npx vitest related --run {files}",
  },
};

function merge(base, extra) {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return extra ?? base;
  const out = { ...base };
  for (const k of Object.keys(extra ?? {})) {
    out[k] = k in base ? merge(base[k], extra[k]) : extra[k];
  }
  return out;
}

const cfgPath = path.resolve(projectRoot, cfgFlag >= 0 ? args[cfgFlag + 1] : "verify-saas.config.json");
let userCfg = {};
if (fs.existsSync(cfgPath)) {
  try {
    userCfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (e) {
    console.error(`Não consegui ler ${cfgPath}: ${e.message}`);
    process.exit(1);
  }
} else if (cfgFlag >= 0) {
  console.error(`Config não encontrada: ${cfgPath}`);
  process.exit(1);
}
const cfg = merge(DEFAULTS, userCfg);
const baselinePath = path.resolve(projectRoot, cfg.baselinePath);

// ---------- utilitários ----------
function run(cmd, opts = {}) {
  try {
    const output = execSync(cmd, {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 64,
      ...opts,
    });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const rel = (p) => path.relative(projectRoot, p).replace(/\\/g, "/");
const readBaseline = () => (fs.existsSync(baselinePath) ? JSON.parse(fs.readFileSync(baselinePath, "utf8")) : null);

function countTypeErrors(res) {
  const re = new RegExp(cfg.typecheck.errorPattern);
  const lines = res.output.split("\n").filter((l) => re.test(l));
  // comando falhou mas nenhuma linha casou com o padrão: conta como 1 erro
  return { ok: res.ok, lines, count: res.ok ? 0 : Math.max(lines.length, 1) };
}

// devolve { errors, warnings, fingerprints, readable, details }
function parseLint(res) {
  const fmt = cfg.lint.format;
  if (fmt === "eslint-json") {
    const out = { errors: 0, warnings: 0, fingerprints: [], details: {}, readable: true };
    try {
      for (const file of JSON.parse(res.output || "[]")) {
        const r = rel(file.filePath);
        for (const m of file.messages) {
          const fp = `${r}:${m.line}:${m.column}:${m.ruleId ?? "?"}`;
          if (m.severity === 2) out.errors++;
          if (m.severity === 1) out.warnings++;
          out.fingerprints.push(fp);
          out.details[fp] = { severity: m.severity, message: m.message };
        }
      }
    } catch {
      out.readable = false;
    }
    return out;
  }
  if (fmt === "lines") {
    const re = cfg.lint.linePattern ? new RegExp(cfg.lint.linePattern) : null;
    const fps = res.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && (!re || re.test(l)));
    return { errors: fps.length, warnings: 0, fingerprints: fps, details: {}, readable: true };
  }
  // exit-code
  return { errors: res.ok ? 0 : 1, warnings: 0, fingerprints: res.ok ? [] : ["(lint falhou)"], details: {}, readable: true };
}

function parseTests(res) {
  if (cfg.tests.format === "exit-code") {
    return { ok: res.ok, total: 0, passed: 0, failed: res.ok ? 0 : 1, json: null, readable: true };
  }
  try {
    const j = JSON.parse(res.output || "{}");
    return {
      ok: j.success === true,
      total: j.numTotalTests ?? 0,
      passed: j.numPassedTests ?? 0,
      failed: j.numFailedTests ?? 0,
      json: j,
      readable: true,
    };
  } catch {
    return { ok: res.ok, total: 0, passed: 0, failed: res.ok ? 0 : 1, json: null, readable: false };
  }
}

function printTestFailures(t, res) {
  if (!t.json) {
    console.log(res.output.slice(-3000));
    return;
  }
  for (const file of t.json.testResults ?? []) {
    const failed = (file.assertionResults ?? []).filter((x) => x.status === "failed");
    if (failed.length === 0 && file.status === "failed") {
      console.log(`  ✗ suíte ${String(file.name).split(/[\\/]/).slice(-2).join("/")} não rodou: ${String(file.message ?? "").slice(0, 300)}`);
    }
    for (const x of failed) {
      console.log(`  ✗ ${x.fullName}: ${String((x.failureMessages ?? [])[0] ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
    }
  }
}

const quoteFiles = (files) => files.map((f) => `"${f}"`).join(" ");

// ---------- modo rápido ----------
if (quickMode) {
  const listed = [run("git diff --name-only HEAD").output, run("git ls-files --others --exclude-standard").output].join("\n");
  const pat = new RegExp(cfg.quick.sourcePattern);
  const changed = [...new Set(listed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean))].filter(
    (f) => pat.test(f) && fs.existsSync(path.join(projectRoot, f)),
  );
  console.log(`== rápido — ${changed.length} arquivo(s) de código alterado(s) ==`);
  let allOk = true;

  if (cfg.typecheck.enabled) {
    const t = countTypeErrors(run(cfg.typecheck.command));
    console.log(t.ok ? "  tipos: ok" : `  tipos: ${t.count} erro(s)\n${t.lines.slice(0, 20).join("\n")}`);
    allOk &&= t.ok;
  }

  if (cfg.lint.enabled && cfg.quick.lintCommand && changed.length > 0) {
    const res = run(cfg.quick.lintCommand.replace("{files}", quoteFiles(changed)));
    const lint = parseLint(res);
    const base = readBaseline();
    const known = new Set(base?.lint?.fingerprints ?? []);
    let fresh = lint.fingerprints
      .filter((fp) => !known.has(fp) && (cfg.lint.format !== "eslint-json" || lint.details[fp]?.severity === 2))
      .map((fp) => `${fp}  ${lint.details[fp]?.message ?? ""}`.trim());
    if (!lint.readable) fresh = ["(não consegui ler a saída do lint)"];
    console.log(fresh.length === 0 ? "  lint (alterados): ok" : `  lint (alterados): ${fresh.length} erro(s) novo(s)\n    ${fresh.join("\n    ")}`);
    allOk &&= fresh.length === 0;
  }

  if (cfg.tests.enabled && cfg.quick.testsCommand && changed.length > 0) {
    const res = run(cfg.quick.testsCommand.replace("{files}", quoteFiles(changed)));
    console.log(`  testes ligados: ${res.ok ? "ok" : "FALHOU"}`);
    if (!res.ok) console.log(res.output.slice(-2500));
    allOk &&= res.ok;
  }

  console.log("\nModo rápido: sem build e sem baseline. Rode o completo antes de commit/push.");
  process.exit(allOk ? 0 : 1);
}

// ---------- modo completo ----------
const TOTAL = 5;

console.log(`== 1/${TOTAL} — tipos (${cfg.typecheck.command}) ==`);
let tsc = { ok: true, lines: [], count: 0 };
if (cfg.typecheck.enabled) {
  tsc = countTypeErrors(run(cfg.typecheck.command));
  console.log(tsc.ok ? "  ok, zero erros" : `  ${tsc.count} erro(s)`);
  if (!tsc.ok) console.log(tsc.lines.slice(0, 20).join("\n"));
} else console.log("  desligado na config");

console.log(`== 2/${TOTAL} — lint ==`);
let lint = { errors: 0, warnings: 0, fingerprints: [], details: {}, readable: true };
if (cfg.lint.enabled) {
  lint = parseLint(run(cfg.lint.command));
  if (!lint.readable) console.log("  (não consegui ler a saída do lint; veja a config lint.format)");
  console.log(`  ${lint.errors} erro(s), ${lint.warnings} warning(s)`);
} else console.log("  desligado na config");

console.log(`== 3/${TOTAL} — build (${cfg.build.command}) ==`);
let build = { ok: true, output: "" };
let routes = [];
if (cfg.build.enabled) {
  for (const dir of cfg.build.clean ?? []) fs.rmSync(path.join(projectRoot, dir), { recursive: true, force: true });
  build = run(cfg.build.command);
  if (cfg.build.routePattern) {
    const re = new RegExp(cfg.build.routePattern);
    routes = build.output.split("\n").map((l) => l.match(re)).filter(Boolean).map((m) => m[1]);
  }
  console.log(build.ok ? `  ok${cfg.build.routePattern ? `, ${routes.length} rota(s)` : ""}` : "  FALHOU — ver saída abaixo");
  if (!build.ok) console.log(build.output.slice(-3000));
} else console.log("  desligado na config");

console.log(`== 4/${TOTAL} — testes (${cfg.tests.command}) ==`);
let tests = { ok: true, total: 0, passed: 0, failed: 0 };
if (cfg.tests.enabled) {
  const res = run(cfg.tests.command);
  tests = parseTests(res);
  if (!tests.readable) console.log("  (não consegui ler a saída em JSON; usando só o código de saída)");
  console.log(tests.ok ? `  ok${tests.total ? `, ${tests.passed}/${tests.total} passou` : ""}` : `  ${tests.failed} falha(s)${tests.total ? ` de ${tests.total}` : ""}`);
  if (!tests.ok) printTestFailures(tests, res);
} else console.log("  desligado na config");

console.log(`== 5/${TOTAL} — estrutura: dependências e migrations ==`);
let deps = {};
let migrations = [];
const sc = cfg.structure;
const migrationsDir = path.join(projectRoot, sc.migrationsDir);
function scanKeywords(file) {
  const content = fs.readFileSync(path.join(migrationsDir, file), "utf8").toLowerCase();
  return sc.alertKeywords.filter((kw) => content.includes(kw.toLowerCase()));
}
if (sc.enabled) {
  const depFile = path.join(projectRoot, sc.dependencyFile);
  if (fs.existsSync(depFile)) {
    const raw = fs.readFileSync(depFile, "utf8");
    if (sc.dependencyType === "requirements") {
      for (const line of raw.split(/\r?\n/)) {
        const m = line.trim().match(/^([A-Za-z0-9_.\-]+)\s*(.*)$/);
        if (m && !line.trim().startsWith("#")) deps[m[1]] = m[2] || "*";
      }
    } else {
      const pkg = JSON.parse(raw);
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    }
  }
  if (fs.existsSync(migrationsDir)) {
    migrations = fs
      .readdirSync(migrationsDir)
      .filter((f) => sc.migrationExtensions.some((e) => f.endsWith(e)))
      .sort();
  }
  console.log(`  ${Object.keys(deps).length} dependência(s), ${migrations.length} migration(s)`);
} else console.log("  desligado na config");

const current = {
  capturedAt: new Date().toISOString(),
  tsc: { ok: tsc.ok, errorCount: tsc.count },
  lint: { errorCount: lint.errors, warningCount: lint.warnings, fingerprints: lint.fingerprints },
  build: { ok: build.ok, routes },
  tests: { ok: tests.ok, total: tests.total, passed: tests.passed, failed: tests.failed },
  dependencies: deps,
  migrations,
};

const baseline = !forceBaseline ? readBaseline() : null;

console.log("\n========== RELATÓRIO ==========");
let hadRegression = false;

if (!baseline) {
  console.log("(sem baseline anterior: esta rodada VIRA o baseline; a próxima já compara contra ela)");
} else {
  if (current.tsc.ok && !baseline.tsc.ok) console.log("✓ Tipos: os erros anteriores foram corrigidos.");
  else if (!current.tsc.ok && baseline.tsc.ok) {
    console.log("✗ REGRESSÃO — os tipos estavam limpos e agora têm erro(s).");
    hadRegression = true;
  } else if (current.tsc.errorCount > baseline.tsc.errorCount) {
    console.log(`✗ REGRESSÃO — tipos tinham ${baseline.tsc.errorCount} erro(s), agora têm ${current.tsc.errorCount}.`);
    hadRegression = true;
  }

  // lint: por impressão digital, não por contagem
  const baseSet = new Set(baseline.lint.fingerprints ?? []);
  const curSet = new Set(lint.fingerprints);
  const newIssues = lint.fingerprints.filter((f) => !baseSet.has(f));
  const fixed = (baseline.lint.fingerprints ?? []).filter((f) => !curSet.has(f));
  if (newIssues.length > 0) {
    console.log(`✗ NOVO(S) PROBLEMA(S) DE LINT (${newIssues.length}), não existiam antes:`);
    for (const f of newIssues) console.log(`    ${f}`);
    hadRegression = true;
  }
  if (fixed.length > 0) console.log(`✓ ${fixed.length} problema(s) de lint corrigido(s) desde a última rodada.`);
  if (newIssues.length === 0 && fixed.length === 0) {
    console.log(`= Lint sem mudança (${lint.errors} erro(s) / ${lint.warnings} warning(s) antigos, dívida anterior).`);
  }

  if (current.build.ok && !baseline.build.ok) console.log("✓ Build: estava quebrado, agora funciona.");
  else if (!current.build.ok && baseline.build.ok) {
    console.log("✗ REGRESSÃO — o build estava ok e agora falha.");
    hadRegression = true;
  }

  if (baseline.tests) {
    if (current.tests.ok && !baseline.tests.ok) console.log("✓ Testes: estavam falhando, agora todos passam.");
    else if (!current.tests.ok && baseline.tests.ok) {
      console.log(`✗ REGRESSÃO — os testes estavam ok e agora ${current.tests.failed} falha(m).`);
      hadRegression = true;
    } else if (!current.tests.ok && current.tests.failed > baseline.tests.failed) {
      console.log(`✗ REGRESSÃO — testes tinham ${baseline.tests.failed} falha(s), agora têm ${current.tests.failed}.`);
      hadRegression = true;
    }
  }

  const baseRoutes = new Set(baseline.build.routes ?? []);
  const curRoutes = new Set(routes);
  const added = routes.filter((r) => !baseRoutes.has(r));
  const removed = (baseline.build.routes ?? []).filter((r) => !curRoutes.has(r));
  if (added.length > 0) console.log(`ℹ Rota(s) nova(s): ${added.join(", ")}`);
  if (removed.length > 0) console.log(`⚠ Rota(s) que sumiram: ${removed.join(", ")}. Confirme se foi intencional.`);

  const baseDeps = baseline.dependencies ?? {};
  const addedDeps = Object.keys(deps).filter((d) => !(d in baseDeps));
  const removedDeps = Object.keys(baseDeps).filter((d) => !(d in deps));
  if (addedDeps.length > 0) console.log(`ℹ Dependência(s) nova(s): ${addedDeps.join(", ")}`);
  if (removedDeps.length > 0) console.log(`⚠ Dependência(s) removida(s): ${removedDeps.join(", ")}`);
  for (const d of Object.keys(deps).filter((d) => d in baseDeps && baseDeps[d] !== deps[d])) {
    console.log(`ℹ Versão mudou: ${d} (${baseDeps[d]} → ${deps[d]})`);
  }

  const baseMig = new Set(baseline.migrations ?? []);
  const newMig = migrations.filter((m) => !baseMig.has(m));
  if (newMig.length > 0) {
    console.log("ℹ Migration(s) nova(s) desde a última verificação:");
    for (const m of newMig) {
      const hits = scanKeywords(m);
      console.log(hits.length > 0 ? `    ${m}  ⚠ palavras de alerta (${hits.join(", ")}): revise antes de aplicar em produção` : `    ${m}`);
    }
  }
}

console.log("================================\n");

fs.writeFileSync(baselinePath, JSON.stringify(current, null, 2));
console.log(`Baseline atualizado em ${rel(baselinePath)}.`);

process.exit(hadRegression || !current.build.ok || !current.tsc.ok || !current.tests.ok ? 1 : 0);
