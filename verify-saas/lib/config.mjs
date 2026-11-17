// Configuração: padrões, mescla com o arquivo do usuário e validação.
import fs from "node:fs";

export const DEFAULTS = {
  baselinePath: "verify-saas.baseline.json",
  packageManager: "auto", // auto | npm | pnpm | yarn | bun
  timeoutSeconds: 600, // limite por etapa (cada etapa pode ter o seu: "timeoutSeconds")
  maxOutputMB: 64, // saída máxima guardada por comando
  typecheck: { enabled: true, command: "npx tsc --noEmit", errorPattern: "error TS[0-9]+:" },
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
    routePattern: "",
  },
  tests: {
    enabled: true,
    command: "npx vitest run --reporter=json",
    // "vitest-json" / "jest-json" (contam testes) ou "exit-code" (só passou/falhou)
    format: "vitest-json",
  },
  structure: {
    enabled: true,
    dependencyFile: "package.json",
    dependencyType: "package-json", // package-json | requirements | go-mod
    migrationsDir: "supabase/migrations",
    migrationExtensions: [".sql"],
    alertKeywords: ["security definer", "create policy", "drop policy", "grant execute", "enable row level security", "service_role"],
  },
  quick: {
    // só arquivos que casam com esta regex entram no modo rápido
    sourcePattern: "^(app|lib|components|src|hooks)/.*[.](ts|tsx)$",
    // {files} vira a lista de arquivos alterados (argumentos separados). Vazio = pula.
    lintCommand: "npx eslint {files} --format json",
    testsCommand: "npx vitest related --run {files}",
  },
};

export function merge(base, extra) {
  if (Array.isArray(base) || typeof base !== "object" || base === null) return extra ?? base;
  const out = { ...base };
  for (const k of Object.keys(extra ?? {})) out[k] = k in base ? merge(base[k], extra[k]) : extra[k];
  return out;
}

// Lê o arquivo e devolve { cfg } ou { error }.
export function loadConfig(cfgPath, explicit) {
  if (!fs.existsSync(cfgPath)) {
    return {
      error: explicit
        ? `Config não encontrada: ${cfgPath}`
        : `Não achei verify-saas.config.json nesta pasta (${cfgPath}).\nRode a skill na RAIZ do seu projeto e gere a config com:\n  node .claude/skills/verify-saas/driver.mjs --init`,
    };
  }
  let user;
  try {
    user = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (e) {
    return { error: `Não consegui ler ${cfgPath}: ${e.message}` };
  }
  const cfg = merge(DEFAULTS, user);
  const problems = [];
  if (!["eslint-json", "lines", "exit-code"].includes(cfg.lint.format)) problems.push(`lint.format inválido: "${cfg.lint.format}" (use eslint-json, lines ou exit-code)`);
  if (!["vitest-json", "jest-json", "exit-code"].includes(cfg.tests.format)) problems.push(`tests.format inválido: "${cfg.tests.format}" (use vitest-json, jest-json ou exit-code)`);
  if (!["package-json", "requirements", "go-mod"].includes(cfg.structure.dependencyType)) problems.push(`structure.dependencyType inválido: "${cfg.structure.dependencyType}"`);
  if (!["auto", "npm", "pnpm", "yarn", "bun"].includes(cfg.packageManager)) problems.push(`packageManager inválido: "${cfg.packageManager}"`);
  for (const [name, rx] of [["typecheck.errorPattern", cfg.typecheck.errorPattern], ["build.routePattern", cfg.build.routePattern], ["quick.sourcePattern", cfg.quick.sourcePattern], ["lint.linePattern", cfg.lint.linePattern]]) {
    if (!rx) continue;
    try {
      new RegExp(rx);
    } catch (e) {
      problems.push(`${name} não é uma expressão regular válida: ${e.message}`);
    }
  }
  if (problems.length > 0) return { error: `Problemas em ${cfgPath}:\n  - ${problems.join("\n  - ")}` };
  return { cfg };
}
