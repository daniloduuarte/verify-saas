// Interpretação da saída das ferramentas. Funções puras (recebem a config e o texto).
import path from "node:path";

// Acha o JSON mesmo com ruído antes ou depois (avisos do npm, por exemplo).
export function extractJson(text) {
  const t = String(text ?? "").trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    /* tenta recortar */
  }
  const lines = t.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!/^[[{]/.test(lines[i])) continue;
    const closer = lines[i][0] === "[" ? "]" : "}";
    for (let j = lines.length - 1; j >= i; j--) {
      if (!lines[j].trimEnd().endsWith(closer)) continue;
      try {
        return JSON.parse(lines.slice(i, j + 1).join("\n"));
      } catch {
        /* continua */
      }
    }
  }
  return undefined;
}

export function countTypeErrors(cfg, res) {
  const re = new RegExp(cfg.typecheck.errorPattern);
  const lines = res.output.split(/\r?\n/).filter((l) => re.test(l));
  // falhou mas nenhuma linha casou com o padrão: conta como 1 erro
  return { ok: res.ok, lines, count: res.ok ? 0 : Math.max(lines.length, 1) };
}

// devolve { errors, warnings, fingerprints, details, readable }
export function parseLint(cfg, res, root) {
  const fmt = cfg.lint.format;
  const empty = { errors: 0, warnings: 0, fingerprints: [], details: {}, readable: true };
  if (fmt === "eslint-json") {
    const data = extractJson(res.output);
    if (!Array.isArray(data)) return { ...empty, readable: false };
    const out = { ...empty, fingerprints: [], details: {} };
    for (const file of data) {
      const r = path.relative(root, file.filePath ?? "").replace(/\\/g, "/");
      for (const m of file.messages ?? []) {
        const fp = `${r}:${m.line}:${m.column}:${m.ruleId ?? "?"}`;
        if (m.severity === 2) out.errors++;
        if (m.severity === 1) out.warnings++;
        out.fingerprints.push(fp);
        out.details[fp] = { severity: m.severity, message: m.message };
      }
    }
    return out;
  }
  if (fmt === "lines") {
    const re = cfg.lint.linePattern ? new RegExp(cfg.lint.linePattern) : null;
    const fps = res.output.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && (!re || re.test(l)));
    return { ...empty, errors: fps.length, fingerprints: fps };
  }
  // exit-code
  return { ...empty, errors: res.ok ? 0 : 1, fingerprints: res.ok ? [] : ["(lint falhou)"] };
}

export function parseTests(cfg, res) {
  if (cfg.tests.format === "exit-code") {
    return { ok: res.ok, total: 0, passed: 0, failed: res.ok ? 0 : 1, json: null, readable: true };
  }
  const j = extractJson(res.output);
  if (j && typeof j === "object" && "success" in j) {
    return { ok: j.success === true, total: j.numTotalTests ?? 0, passed: j.numPassedTests ?? 0, failed: j.numFailedTests ?? 0, json: j, readable: true };
  }
  return { ok: res.ok, total: 0, passed: 0, failed: res.ok ? 0 : 1, json: null, readable: false };
}

// go.mod: linhas "modulo vX" (dentro de require ou com require na frente)
export function parseGoMod(raw) {
  const deps = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.trim().match(/^(?:require\s+)?([A-Za-z0-9_.\-/~]+\.[A-Za-z0-9_.\-/~]+)\s+(v\S+)/);
    if (m) deps[m[1]] = m[2];
  }
  return deps;
}

export function parseRequirements(raw) {
  const deps = {};
  for (const line of raw.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("#") || l.startsWith("-")) continue;
    const m = l.match(/^([A-Za-z0-9_.\-]+)\s*(.*)$/);
    if (m) deps[m[1]] = m[2] || "*";
  }
  return deps;
}
