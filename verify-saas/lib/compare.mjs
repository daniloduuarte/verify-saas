// Comparação do estado atual com o baseline. Função pura: não lê nem grava arquivo.
// Devolve { regressions: string[], lines: { tag, text }[] }. Etapa pulada (de um lado
// ou do outro) não é comparada.
export function compare(baseline, current, scanKeywords = () => []) {
  const lines = [];
  const regressions = [];
  const add = (tag, text) => lines.push({ tag, text });
  const regress = (text) => {
    regressions.push(text);
    add("REGRESSAO", text);
  };
  const both = (k) => baseline[k] && current[k] && !baseline[k].skipped && !current[k].skipped;

  if (both("tsc")) {
    if (current.tsc.ok && !baseline.tsc.ok) add("melhorou", "Tipos: os erros anteriores foram corrigidos.");
    else if (!current.tsc.ok && baseline.tsc.ok) regress("Tipos: estavam limpos e agora têm erro(s).");
    else if (current.tsc.errorCount > baseline.tsc.errorCount) regress(`Tipos: tinham ${baseline.tsc.errorCount} erro(s), agora têm ${current.tsc.errorCount}.`);
  }

  if (both("lint")) {
    // por impressão digital, não por contagem
    const baseSet = new Set(baseline.lint.fingerprints ?? []);
    const curSet = new Set(current.lint.fingerprints ?? []);
    const fresh = (current.lint.fingerprints ?? []).filter((f) => !baseSet.has(f));
    const fixed = (baseline.lint.fingerprints ?? []).filter((f) => !curSet.has(f));
    if (fresh.length > 0) {
      regress(`Lint: ${fresh.length} problema(s) novo(s), não existiam antes:`);
      for (const f of fresh) add("REGRESSAO", `    ${f}`);
    }
    if (fixed.length > 0) add("melhorou", `Lint: ${fixed.length} problema(s) corrigido(s) desde a última rodada.`);
    if (fresh.length === 0 && fixed.length === 0) {
      add("igual", `Lint sem mudança (${current.lint.errorCount} erro(s) / ${current.lint.warningCount} warning(s) antigos, dívida anterior).`);
    }
  }

  if (both("build")) {
    if (current.build.ok && !baseline.build.ok) add("melhorou", "Build: estava quebrado, agora funciona.");
    else if (!current.build.ok && baseline.build.ok) regress("Build: estava ok e agora falha.");
    const baseRoutes = new Set(baseline.build.routes ?? []);
    const curRoutes = new Set(current.build.routes ?? []);
    const added = (current.build.routes ?? []).filter((r) => !baseRoutes.has(r));
    const removed = (baseline.build.routes ?? []).filter((r) => !curRoutes.has(r));
    if (added.length > 0) add("info", `Rota(s) nova(s): ${added.join(", ")}`);
    if (removed.length > 0) add("atencao", `Rota(s) que sumiram: ${removed.join(", ")}. Confirme se foi intencional.`);
  }

  if (both("tests")) {
    if (current.tests.ok && !baseline.tests.ok) add("melhorou", "Testes: estavam falhando, agora todos passam.");
    else if (!current.tests.ok && baseline.tests.ok) regress(`Testes: estavam ok e agora ${current.tests.failed} falha(m).`);
    else if (!current.tests.ok && current.tests.failed > baseline.tests.failed) regress(`Testes: tinham ${baseline.tests.failed} falha(s), agora têm ${current.tests.failed}.`);
  }

  const baseDeps = baseline.dependencies ?? {};
  const curDeps = current.dependencies ?? {};
  const addedDeps = Object.keys(curDeps).filter((d) => !(d in baseDeps));
  const removedDeps = Object.keys(baseDeps).filter((d) => !(d in curDeps));
  if (addedDeps.length > 0) add("info", `Dependência(s) nova(s): ${addedDeps.join(", ")}`);
  if (removedDeps.length > 0) add("atencao", `Dependência(s) removida(s): ${removedDeps.join(", ")}`);
  for (const d of Object.keys(curDeps).filter((d) => d in baseDeps && baseDeps[d] !== curDeps[d])) {
    add("info", `Versão mudou: ${d} (${baseDeps[d]} para ${curDeps[d]})`);
  }

  const baseMig = new Set(baseline.migrations ?? []);
  const newMig = (current.migrations ?? []).filter((m) => !baseMig.has(m));
  if (newMig.length > 0) {
    add("info", "Migration(s) nova(s) desde a última verificação:");
    for (const m of newMig) {
      const hits = scanKeywords(m);
      add(hits.length > 0 ? "atencao" : "info", hits.length > 0 ? `    ${m}  palavras de alerta (${hits.join(", ")}): revise antes de aplicar em produção` : `    ${m}`);
    }
  }
  return { regressions, lines };
}
