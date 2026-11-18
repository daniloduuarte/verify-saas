#!/usr/bin/env node
// verify-saas: verificação de regressão + detecção de mudança estrutural.
// Node puro, sem dependências. Tudo que é específico do projeto (comandos,
// pastas, palavras de alerta) vem do arquivo verify-saas.config.json.
// Rode SEMPRE na raiz do projeto: a pasta atual (process.cwd()) é o projeto.
//
// SEGURANÇA: o config executa comandos arbitrários, como os scripts do
// package.json. Não rode em repositório que você não confia.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULTS, loadConfig } from "./lib/config.mjs";
import { redact, runCommand } from "./lib/exec.mjs";
import { changedFiles } from "./lib/git.mjs";
import { compare } from "./lib/compare.mjs";
import { countTypeErrors, parseGoMod, parseLint, parseRequirements, parseTests } from "./lib/parse.mjs";
import { buildInitConfig, detectPackageManager, looksMissing, noTestsFound, readPackageJson, skipReason, translateTokens } from "./lib/project.mjs";
import { tokenize } from "./lib/exec.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

const HELP = `verify-saas: confere se uma mudança quebrou algo.

Uso (rode na RAIZ do seu projeto):
  node .claude/skills/verify-saas/driver.mjs [opções]

  (sem opção)         completo: tipos, lint, build, testes e estrutura; compara com o baseline
  --init              cria o verify-saas.config.json certo para o projeto (detecta Next, Node, Python, Go)
  --quick             rápido: tipos + lint e testes só dos arquivos alterados (git); não toca no baseline
  --baseline          captura o estado atual como o "bom" (primeiro uso), ignorando o baseline antigo
  --update-baseline   grava o baseline mesmo com regressão (aceitar de propósito)
  --json              imprime um resultado em JSON no stdout (o texto vai para o stderr)
  --config ARQUIVO    usa outro arquivo de configuração (padrão: verify-saas.config.json)
  --template NOME     com --init: nextjs, node, python ou go
  --force             com --init: sobrescreve uma config existente
  --help, -h          mostra esta ajuda e NÃO roda nada

Códigos de saída: 0 = ok; 1 = regressão ou etapa quebrada; 2 = uso/config errados ou nada foi verificado.
AVISO: o config executa comandos do seu projeto. Não rode em repositório não confiável.
Documentação: https://github.com/daniloduuarte/verify-saas`;

if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

// ---------- argumentos ----------
const FLAGS = new Set(["--baseline", "--update-baseline", "--quick", "--json", "--init", "--force"]);
const VALUE_FLAGS = new Set(["--config", "--template"]);
const opts = { values: {} };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (FLAGS.has(a)) opts[a.slice(2)] = true;
  else if (VALUE_FLAGS.has(a)) {
    if (!args[i + 1] || args[i + 1].startsWith("-")) {
      console.error(`A opção ${a} precisa de um valor.\n`);
      process.exit(2);
    }
    opts.values[a.slice(2)] = args[++i];
  } else {
    console.error(`Opção desconhecida: ${a}\n\n${HELP}`);
    process.exit(2);
  }
}
if (opts.quick && (opts.baseline || opts["update-baseline"] || opts.init)) {
  console.error("--quick não combina com --baseline, --update-baseline nem --init (o rápido nunca toca no baseline).");
  process.exit(2);
}

const projectRoot = process.cwd();
const jsonMode = Boolean(opts.json);
const out = (s = "") => (jsonMode ? console.error : console.log)(redact(s));
const rel = (p) => path.relative(projectRoot, p).replace(/\\/g, "/");
const cfgFlag = opts.values.config;
const cfgPath = path.resolve(projectRoot, cfgFlag ?? "verify-saas.config.json");

function finish(code, report) {
  if (jsonMode) console.log(JSON.stringify({ exitCode: code, ...report }, null, 2));
  process.exit(code);
}

// ---------- --init ----------
if (opts.init) {
  if (fs.existsSync(cfgPath) && !opts.force) {
    console.error(`Já existe ${rel(cfgPath)}. Não sobrescrevi. Use --init --force para recriar.`);
    process.exit(2);
  }
  const { kind, config, notes } = buildInitConfig(projectRoot, path.join(here, "templates"), opts.values.template);
  if (!config) {
    console.error(notes.join("\n"));
    process.exit(2);
  }
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + "\n");
  out(`Criei ${rel(cfgPath)} para um projeto "${kind}".`);
  for (const n of notes) out(`  aviso: ${n}`);
  out("Revise o arquivo (os comandos rodam no seu computador) e depois rode:");
  out("  node .claude/skills/verify-saas/driver.mjs --baseline");
  process.exit(0);
}

// ---------- configuração e projeto ----------
const loaded = loadConfig(cfgPath, cfgFlag !== undefined);
if (loaded.error) {
  console.error(loaded.error);
  process.exit(2);
}
const cfg = loaded.cfg;
const baselinePath = path.resolve(projectRoot, cfg.baselinePath);
const pkg = readPackageJson(projectRoot);
const pm = cfg.packageManager === "auto" ? detectPackageManager(projectRoot, pkg) : cfg.packageManager;
const translate = (tokens) => translateTokens(tokens, pm);
const maxBytes = Math.max(1, Number(cfg.maxOutputMB) || DEFAULTS.maxOutputMB) * 1024 * 1024;

if (pkg && !fs.existsSync(path.join(projectRoot, "node_modules")) && /(^|\s)(npx|npm|pnpm|yarn|bun)\b/.test(JSON.stringify(cfg))) {
  console.error("Este projeto tem package.json mas não tem a pasta node_modules.\nInstale as dependências primeiro (npm install, pnpm install, yarn ou bun install) e rode de novo.");
  process.exit(2);
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch (e) {
    out(`Aviso: não consegui ler o baseline (${e.message}). Ele será tratado como inexistente.`);
    return null;
  }
}

// Para o comando: [skipReason] ou resultado de execução.
function precheck(command) {
  let tk;
  try {
    tk = tokenize(command);
  } catch (e) {
    return e.message;
  }
  if (tk.shell) return null;
  return skipReason(translate(tk.tokens), projectRoot, pkg);
}

async function execute(command, stepCfg, files = []) {
  const seconds = Number(stepCfg.timeoutSeconds ?? cfg.timeoutSeconds) || DEFAULTS.timeoutSeconds;
  const res = await runCommand({ command, cwd: projectRoot, files, timeoutMs: seconds * 1000, maxBytes, translate });
  res.limit = seconds;
  return res;
}

function failNote(res) {
  if (res.timedOut) return `passou do limite de ${res.limit}s (aumente timeoutSeconds na config se for normal)`;
  if (res.error && !res.missing) return `não consegui rodar: ${res.error}`;
  if (res.truncated) return "a saída passou do limite (maxOutputMB) e foi cortada";
  return "";
}

const skippedList = [];
const brokenList = [];
const report = { mode: opts.quick ? "quick" : "full", steps: {} };

// ---------- modo rápido ----------
if (opts.quick) {
  const { git, files: all } = changedFiles(projectRoot);
  const pat = new RegExp(cfg.quick.sourcePattern);
  const changed = all.filter((f) => pat.test(f));
  if (!git) out("Aviso: esta pasta não é um repositório git; não sei quais arquivos mudaram. O modo rápido vai rodar só os tipos.");
  out(`== rapido: ${changed.length} arquivo(s) de código alterado(s) ==`);
  let ran = 0;
  let allOk = true;
  report.changedFiles = changed;

  if (cfg.typecheck.enabled) {
    const why = precheck(cfg.typecheck.command);
    if (why) {
      out(`  tipos: PULADO (${why})`);
      skippedList.push(`tipos: ${why}`);
      report.steps.typecheck = { status: "skipped", reason: why };
    } else {
      const res = await execute(cfg.typecheck.command, cfg.typecheck);
      const miss = looksMissing(res);
      if (miss) {
        out(`  tipos: PULADO (${miss})`);
        skippedList.push(`tipos: ${miss}`);
        report.steps.typecheck = { status: "skipped", reason: miss };
      } else {
        ran++;
        const t = countTypeErrors(cfg, res);
        out(t.ok ? "  tipos: ok" : `  tipos: ${t.count} erro(s) ${failNote(res)}\n${t.lines.slice(0, 20).join("\n")}`);
        report.steps.typecheck = { status: t.ok ? "ok" : "failed", errorCount: t.count };
        allOk &&= t.ok;
      }
    }
  }

  const base = readBaseline();
  if (git && cfg.lint.enabled && cfg.quick.lintCommand && changed.length > 0) {
    const why = precheck(cfg.quick.lintCommand);
    const res = why ? null : await execute(cfg.quick.lintCommand, cfg.lint, changed);
    const miss = why ?? (res ? looksMissing(res) : null);
    if (miss) {
      out(`  lint (alterados): PULADO (${miss})`);
      skippedList.push(`lint: ${miss}`);
      report.steps.lint = { status: "skipped", reason: miss };
    } else {
      ran++;
      const lint = parseLint(cfg, res, projectRoot);
      if (!lint.readable) {
        out(`  lint (alterados): FALHOU, não consegui ler a saída. ${failNote(res)}\n${res.output.slice(-1500)}`);
        report.steps.lint = { status: "failed", reason: "saída ilegível" };
        allOk = false;
      } else {
        const known = new Set(base?.lint?.fingerprints ?? []);
        const fresh = lint.fingerprints
          .filter((fp) => !known.has(fp) && (cfg.lint.format !== "eslint-json" || lint.details[fp]?.severity === 2))
          .map((fp) => `${fp}  ${lint.details[fp]?.message ?? ""}`.trim());
        out(fresh.length === 0 ? "  lint (alterados): ok" : `  lint (alterados): ${fresh.length} erro(s) novo(s)\n    ${fresh.join("\n    ")}`);
        if (!base) out("  (sem baseline: todo erro de lint nos arquivos alterados conta como novo)");
        report.steps.lint = { status: fresh.length === 0 ? "ok" : "failed", newProblems: fresh };
        allOk &&= fresh.length === 0;
      }
    }
  }

  if (git && cfg.tests.enabled && cfg.quick.testsCommand && changed.length > 0) {
    const why = precheck(cfg.quick.testsCommand);
    const res = why ? null : await execute(cfg.quick.testsCommand, cfg.tests, changed);
    const miss = why ?? (res ? looksMissing(res) : null) ?? (res && noTestsFound(res, cfg.quick.testsCommand) ? "nenhum teste ligado a esses arquivos" : null);
    if (miss) {
      out(`  testes ligados: PULADO (${miss})`);
      skippedList.push(`testes: ${miss}`);
      report.steps.tests = { status: "skipped", reason: miss };
    } else {
      ran++;
      out(`  testes ligados: ${res.ok ? "ok" : "FALHOU " + failNote(res)}`);
      if (!res.ok) out(res.output.slice(-2500));
      report.steps.tests = { status: res.ok ? "ok" : "failed" };
      allOk &&= res.ok;
    }
  }

  out("\nModo rápido: sem build e sem baseline. Rode o completo antes de commit/push.");
  if (skippedList.length > 0) out(`Etapas puladas (NÃO verificadas): ${skippedList.join("; ")}`);
  if (ran === 0) {
    out("RESULTADO: nada foi verificado (todas as etapas foram puladas ou estão desligadas).");
    finish(2, { ok: false, ...report, skipped: skippedList });
  }
  out(allOk ? "RESULTADO: APROVADO no que foi verificado." : "RESULTADO: REPROVADO. Corrija os itens acima.");
  finish(allOk ? 0 : 1, { ok: allOk, ...report, skipped: skippedList });
}

// ---------- modo completo ----------
const TOTAL = 5;
const current = {
  version: 2,
  capturedAt: new Date().toISOString(),
  tsc: { ok: true, errorCount: 0, skipped: true },
  lint: { errorCount: 0, warningCount: 0, fingerprints: [], skipped: true },
  build: { ok: true, routes: [], skipped: true },
  tests: { ok: true, total: 0, passed: 0, failed: 0, skipped: true },
  dependencies: {},
  migrations: [],
};
let ranCount = 0;
const skip = (key, label, reason) => {
  out(`  PULADO: ${reason}`);
  skippedList.push(`${label}: ${reason}`);
  report.steps[key] = { status: "skipped", reason };
};

out(`== 1/${TOTAL} tipos${cfg.typecheck.enabled ? ` (${cfg.typecheck.command})` : ""} ==`);
if (!cfg.typecheck.enabled) {
  out("  desligado na config");
  report.steps.typecheck = { status: "disabled" };
} else {
  const why = precheck(cfg.typecheck.command);
  const res = why ? null : await execute(cfg.typecheck.command, cfg.typecheck);
  const miss = why ?? (res ? looksMissing(res) : null);
  if (miss) skip("typecheck", "tipos", miss);
  else {
    ranCount++;
    const t = countTypeErrors(cfg, res);
    current.tsc = { ok: t.ok, errorCount: t.count };
    out(t.ok ? "  ok, zero erros" : `  ${t.count} erro(s) ${failNote(res)}`);
    if (!t.ok) {
      out(t.lines.slice(0, 20).join("\n"));
      brokenList.push("tipos com erro");
    }
    report.steps.typecheck = { status: t.ok ? "ok" : "failed", errorCount: t.count };
  }
}

out(`== 2/${TOTAL} lint ==`);
let lint = { errors: 0, warnings: 0, fingerprints: [] };
if (!cfg.lint.enabled) {
  out("  desligado na config");
  report.steps.lint = { status: "disabled" };
} else {
  const why = precheck(cfg.lint.command);
  const res = why ? null : await execute(cfg.lint.command, cfg.lint);
  const miss = why ?? (res ? looksMissing(res) : null);
  if (miss) skip("lint", "lint", miss);
  else {
    ranCount++;
    lint = parseLint(cfg, res, projectRoot);
    if (!lint.readable) {
      out(`  FALHOU: não consegui ler a saída do lint (a ferramenta pode ter quebrado). ${failNote(res)}`);
      out(`  Confira lint.format e o comando na config. Fim da saída:\n${res.output.slice(-800)}`);
      brokenList.push("lint ilegível");
      report.steps.lint = { status: "failed", reason: "saída ilegível" };
    } else {
      current.lint = { errorCount: lint.errors, warningCount: lint.warnings, fingerprints: lint.fingerprints.map(redact) };
      out(`  ${lint.errors} erro(s), ${lint.warnings} warning(s)`);
      report.steps.lint = { status: "ok", errors: lint.errors, warnings: lint.warnings };
    }
  }
}

out(`== 3/${TOTAL} build${cfg.build.enabled ? ` (${cfg.build.command})` : ""} ==`);
if (!cfg.build.enabled) {
  out("  desligado na config");
  report.steps.build = { status: "disabled" };
} else {
  const why = precheck(cfg.build.command);
  if (why) skip("build", "build", why);
  else {
    for (const dir of cfg.build.clean ?? []) {
      const target = path.resolve(projectRoot, dir);
      // só apaga DENTRO do projeto, nunca a própria raiz nem fora dela
      if (target !== projectRoot && target.startsWith(projectRoot + path.sep)) fs.rmSync(target, { recursive: true, force: true });
      else out(`  aviso: build.clean ignorou "${dir}" (fora da pasta do projeto)`);
    }
    const res = await execute(cfg.build.command, cfg.build);
    const miss = looksMissing(res);
    if (miss) skip("build", "build", miss);
    else {
      ranCount++;
      let routes = [];
      if (cfg.build.routePattern) {
        const re = new RegExp(cfg.build.routePattern);
        routes = res.output.split(/\r?\n/).map((l) => l.match(re)).filter(Boolean).map((m) => m[1]);
      }
      current.build = { ok: res.ok, routes };
      out(res.ok ? `  ok${cfg.build.routePattern ? `, ${routes.length} rota(s)` : ""}` : `  FALHOU ${failNote(res)}\n${res.output.slice(-3000)}`);
      if (!res.ok) brokenList.push("build falhou");
      report.steps.build = { status: res.ok ? "ok" : "failed", routes: routes.length };
    }
  }
}

out(`== 4/${TOTAL} testes${cfg.tests.enabled ? ` (${cfg.tests.command})` : ""} ==`);
if (!cfg.tests.enabled) {
  out("  desligado na config");
  report.steps.tests = { status: "disabled" };
} else {
  const why = precheck(cfg.tests.command);
  const res = why ? null : await execute(cfg.tests.command, cfg.tests);
  const miss = why ?? (res ? looksMissing(res) : null) ?? (res && noTestsFound(res, cfg.tests.command) ? "nenhum teste encontrado" : null);
  if (miss) skip("tests", "testes", miss);
  else {
    ranCount++;
    const t = parseTests(cfg, res);
    if (!t.readable) out("  (não consegui ler a saída em JSON; usando só o código de saída)");
    current.tests = { ok: t.ok, total: t.total, passed: t.passed, failed: t.failed };
    out(t.ok ? `  ok${t.total ? `, ${t.passed}/${t.total} passou` : ""}` : `  ${t.failed} falha(s)${t.total ? ` de ${t.total}` : ""} ${failNote(res)}`);
    if (!t.ok) {
      if (t.json) {
        for (const file of t.json.testResults ?? []) {
          const failed = (file.assertionResults ?? []).filter((x) => x.status === "failed");
          if (failed.length === 0 && file.status === "failed") out(`  X suíte ${String(file.name).split(/[\\/]/).slice(-2).join("/")} não rodou: ${String(file.message ?? "").slice(0, 300)}`);
          for (const x of failed) out(`  X ${x.fullName}: ${String((x.failureMessages ?? [])[0] ?? "").replace(/\s+/g, " ").slice(0, 300)}`);
        }
      } else out(res.output.slice(-3000));
      brokenList.push("testes falhando");
    }
    report.steps.tests = { status: t.ok ? "ok" : "failed", total: t.total, passed: t.passed, failed: t.failed };
  }
}

out(`== 5/${TOTAL} estrutura: dependências e migrations ==`);
const sc = cfg.structure;
const migrationsDir = path.resolve(projectRoot, sc.migrationsDir);
if (!sc.enabled) {
  out("  desligado na config");
  report.steps.structure = { status: "disabled" };
} else {
  try {
    const depFile = path.resolve(projectRoot, sc.dependencyFile);
    if (fs.existsSync(depFile)) {
      const raw = fs.readFileSync(depFile, "utf8");
      if (sc.dependencyType === "requirements") current.dependencies = parseRequirements(raw);
      else if (sc.dependencyType === "go-mod") current.dependencies = parseGoMod(raw);
      else {
        const p = JSON.parse(raw);
        current.dependencies = { ...p.dependencies, ...p.devDependencies };
      }
    }
    if (fs.existsSync(migrationsDir)) {
      current.migrations = fs.readdirSync(migrationsDir).filter((f) => sc.migrationExtensions.some((e) => f.endsWith(e))).sort();
    }
    out(`  ${Object.keys(current.dependencies).length} dependência(s), ${current.migrations.length} migration(s)`);
    report.steps.structure = { status: "ok", dependencies: Object.keys(current.dependencies).length, migrations: current.migrations.length };
  } catch (e) {
    out(`  aviso: não consegui ler dependências/migrations (${e.message}). Etapa ignorada.`);
    report.steps.structure = { status: "skipped", reason: e.message };
  }
}

function scanKeywords(file) {
  try {
    const content = fs.readFileSync(path.join(migrationsDir, file), "utf8").toLowerCase();
    return sc.alertKeywords.filter((kw) => content.includes(kw.toLowerCase()));
  } catch {
    return [];
  }
}

// ---------- relatório ----------
const oldBaseline = readBaseline();
const baseline = opts.baseline ? null : oldBaseline;
out("\n========== RELATORIO ==========");
let regressions = [];
if (!baseline) {
  out("(sem baseline anterior: esta rodada vira o baseline; a próxima já compara contra ela)");
} else {
  const cmp = compare(baseline, current, scanKeywords);
  regressions = cmp.regressions;
  for (const l of cmp.lines) out(`[${l.tag}] ${l.text}`);
  if (cmp.lines.length === 0) out("[igual] Nada mudou em relação ao baseline.");
}
out("================================\n");

// ---------- baseline: nunca esconder regressão ----------
const hadRegression = regressions.length > 0;
let baselineAction;
if (ranCount === 0) {
  baselineAction = "não gravado";
  out("Baseline não gravado: nenhuma etapa rodou.");
} else if (hadRegression && !opts["update-baseline"] && !opts.baseline) {
  baselineAction = "mantido";
  out("Baseline NÃO atualizado: houve regressão. Corrija e rode de novo.");
  out("(Se aceita o estado atual de propósito, rode com --update-baseline.)");
} else {
  // etapa pulada nesta rodada preserva o que o baseline antigo sabia sobre ela
  const toWrite = { ...current };
  if (oldBaseline && !opts.baseline) {
    for (const k of ["tsc", "lint", "build", "tests"]) if (current[k].skipped && oldBaseline[k] && !oldBaseline[k].skipped) toWrite[k] = oldBaseline[k];
  }
  fs.writeFileSync(baselinePath, JSON.stringify(toWrite, null, 2));
  baselineAction = oldBaseline && !opts.baseline ? "atualizado" : "criado";
  out(`Baseline ${baselineAction} em ${rel(baselinePath)}${hadRegression ? " (regressão aceita por --baseline/--update-baseline)" : ""}.`);
}

// ---------- veredito ----------
if (skippedList.length > 0) out(`Etapas puladas (NÃO verificadas): ${skippedList.join("; ")}`);
const NOMES = { typecheck: "tipos", lint: "lint", build: "build", tests: "testes", structure: "estrutura" };
const disabledList = Object.entries(report.steps).filter(([, v]) => v.status === "disabled").map(([k]) => NOMES[k] ?? k);
if (disabledList.length > 0) out(`Etapas desligadas na config (NÃO verificadas): ${disabledList.join(", ")}. "Aprovado" vale só para o que rodou.`);
const summary = { ok: false, ...report, disabled: disabledList, regressions, broken: brokenList, skipped: skippedList, baseline: baselineAction };
if (ranCount === 0) {
  out("RESULTADO: nada foi verificado (todas as etapas foram puladas ou estão desligadas). Revise o verify-saas.config.json.");
  finish(2, summary);
}
const bad = hadRegression || brokenList.length > 0;
out(bad ? `RESULTADO: REPROVADO (${regressions.length} regressão(ões); quebrado: ${brokenList.join(", ") || "nada"}).` : "RESULTADO: APROVADO no que foi verificado.");
summary.ok = !bad;
finish(bad ? 1 : 0, summary);
