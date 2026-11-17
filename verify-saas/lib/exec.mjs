// Execução de comandos sem depender de shell sempre que possível.
// Texto vindo do verify-saas.config.json é tratado como comando confiável do dono
// do projeto (igual a um script do package.json). A lista de arquivos do --quick
// NUNCA é concatenada em texto de shell: vai como argumentos separados.
import { spawn } from "node:child_process";

// Quebra o comando em argumentos respeitando aspas simples e duplas.
// shell=true quando há operadores de shell (&&, |, ;, >, <, `, $() ou VAR=valor).
export function tokenize(cmd) {
  const tokens = [];
  let cur = "";
  let inTok = false;
  let q = null;
  let shell = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q) {
      if (c === q) q = null;
      else if (c === "\\" && q === '"' && (cmd[i + 1] === '"' || cmd[i + 1] === "\\")) cur += cmd[++i];
      else cur += c;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      inTok = true;
      continue;
    }
    if (/\s/.test(c)) {
      if (inTok) {
        tokens.push(cur);
        cur = "";
        inTok = false;
      }
      continue;
    }
    if ("&|;<>`".includes(c) || (c === "$" && cmd[i + 1] === "(")) shell = true;
    cur += c;
    inTok = true;
  }
  if (q) throw new Error(`aspas não fechadas no comando: ${cmd}`);
  if (inTok) tokens.push(cur);
  if (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) shell = true;
  return { tokens, shell };
}

// Aspas para o cmd.exe do Windows (um argumento).
export function quoteWin(a) {
  if (a === "") return '""';
  if (!/[\s"&|<>^()%!]/.test(a)) return a;
  return '"' + a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1") + '"';
}

// Arquivo seguro para virar argumento. Recusa o que o cmd.exe expandiria
// (aspas e %VAR%) e quebras de linha. Nomes que começam com "-" ganham "./".
export function safeFileArg(f) {
  if (/["%\r\n\0]/.test(f)) return null;
  return f.startsWith("-") ? `./${f}` : f;
}

// Remove segredos conhecidos de qualquer texto antes de imprimir ou gravar.
const REDACTIONS = [
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "[REDACTED]"],
  [/\b(?:sk|pk|rk)[-_](?:live|test)?[-_]?[A-Za-z0-9]{16,}/g, "[REDACTED]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, "[REDACTED]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED]"],
  [/(:\/\/[^\s:/@]+:)[^\s@/]+@/g, "$1[REDACTED]@"],
  [/((?:secret|token|password|passwd|api[_-]?key|private[_-]?key|authorization)[A-Za-z0-9_]*["']?\s*[=:]\s*)(["']?)[^\s"',;]{4,}/gi, "$1$2[REDACTED]"],
];
export function redact(text) {
  let out = String(text ?? "");
  for (const [re, rep] of REDACTIONS) out = out.replace(re, rep);
  return out;
}

function killTree(child) {
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* já terminou */
    }
  }
}

// Roda um comando. Nunca lança: devolve { ok, status, output, timedOut, truncated, missing, error }.
// translate(tokens) => tokens permite trocar npx/npm pelo gerenciador do projeto.
export function runCommand({ command, cwd, files = [], timeoutMs = 600000, maxBytes = 64 * 1024 * 1024, translate }) {
  return new Promise((resolve) => {
    const fail = (error) => resolve({ ok: false, status: null, output: "", timedOut: false, truncated: false, missing: false, error });
    let parsed;
    try {
      parsed = tokenize(command);
    } catch (e) {
      return fail(e.message);
    }
    let { tokens, shell } = parsed;
    const slot = tokens.indexOf("{files}");
    if (command.includes("{files}") && slot < 0) return fail("{files} precisa ser um argumento separado por espaços, ex.: npx eslint {files}");
    if (slot >= 0) {
      if (shell) return fail("{files} não pode ser usado em comando com operadores de shell (&&, |, ;, >)");
      const safe = files.map(safeFileArg).filter((f) => f !== null);
      tokens = [...tokens.slice(0, slot), ...safe, ...tokens.slice(slot + 1)];
    }
    if (!shell && translate) tokens = translate(tokens);
    const opts = { cwd, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32" };
    let child;
    try {
      if (shell) child = spawn(command, { ...opts, shell: true });
      else if (process.platform === "win32") child = spawn(tokens.map(quoteWin).join(" "), { ...opts, shell: true });
      else child = spawn(tokens[0], tokens.slice(1), { ...opts, shell: false });
    } catch (e) {
      return fail(e.message);
    }
    const chunks = [];
    let bytes = 0;
    let truncated = false;
    let timedOut = false;
    const onData = (b) => {
      if (bytes >= maxBytes) {
        truncated = true;
        return;
      }
      bytes += b.length;
      chunks.push(b);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    let done = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ output: Buffer.concat(chunks).toString("utf8"), timedOut, truncated, missing: false, error: null, ...r });
    };
    child.on("error", (e) => finish({ ok: false, status: null, missing: e.code === "ENOENT", error: e.message }));
    child.on("close", (code) => finish({ ok: code === 0 && !timedOut, status: code }));
  });
}
