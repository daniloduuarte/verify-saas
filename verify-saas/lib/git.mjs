// Lista os arquivos alterados via git, sem passar por shell.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function git(args, cwd) {
  return spawnSync("git", ["-c", "core.quotepath=false", ...args], { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

// Devolve { git: boolean, files: string[] } com caminhos relativos a cwd.
// Trata: fora de repositório git, repositório sem commits, arquivos apagados
// (somem da lista) e renomeados (entra o nome novo).
export function changedFiles(cwd) {
  const inside = git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (inside.error || inside.status !== 0) return { git: false, files: [] };
  const hasHead = git(["rev-parse", "--verify", "-q", "HEAD"], cwd).status === 0;
  const base = ["diff", "--name-only", "-z", "--relative", "--diff-filter=ACMR"];
  const results = hasHead ? [git([...base, "HEAD"], cwd)] : [git([...base, "--cached"], cwd), git(base, cwd)];
  results.push(git(["ls-files", "--others", "--exclude-standard", "-z"], cwd));
  const set = new Set();
  for (const r of results) {
    if (r.status !== 0) continue;
    for (const f of r.stdout.split("\0")) if (f) set.add(f);
  }
  const files = [...set].filter((f) => {
    try {
      return fs.statSync(path.join(cwd, f)).isFile();
    } catch {
      return false;
    }
  });
  return { git: true, files: files.sort() };
}
