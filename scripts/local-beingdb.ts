/**
 * Local BeingDB harness. Locates a BeingDB checkout (or prebuilt
 * executables), builds it incrementally with dune, compiles a fixture into
 * a pack store with BeingDB's own `import`/`compile` CLIs, and runs
 * `beingdb-serve` on a localhost port. Everything stays on this machine:
 * there is no remote fallback.
 *
 * Used by the integration-test global setup, and as a CLI:
 *
 *   npm run beingdb:local                      # demo fixture on 127.0.0.1:8080
 *   npm run beingdb:local -- --port 18080
 *   npm run beingdb:local -- --pack ../some/pack_store
 *
 * BeingDB is located, in order, from:
 *   1. BEINGDB_BIN_DIR  directory with beingdb-import/-compile/-serve (or import/compile/serve.exe); not built
 *   2. BEINGDB_REPO     a BeingDB checkout, built with dune
 *   3. ../beingdb       a sibling checkout of this repository, built with dune
 */
import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import type { WriteStream } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEMO_FIXTURE_DIR = path.join(PROJECT_ROOT, "fixtures", "demo-facts");
export const DEFAULT_LOCAL_PORT = 8080;

const HOW_TO_CONFIGURE =
  "Clone https://github.com/jptmoore/beingdb next to this repository (../beingdb), or set BEINGDB_REPO=/path/to/beingdb, or BEINGDB_BIN_DIR=/directory/containing/beingdb-serve.";
const BUILD_TARGETS = ["./bin/import.exe", "./bin/compile.exe", "./bin/serve.exe"];

export type HarnessStage = "locate" | "build" | "compile" | "start" | "ready";

/** A local-setup failure, labelled with the stage that failed and the details needed to fix it. */
export class LocalBeingDbError extends Error {
  readonly stage: HarnessStage;

  constructor(stage: HarnessStage, summary: string, details: Record<string, string | undefined> = {}) {
    const lines = Object.entries(details)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "")
      .map(([key, value]) => (value.includes("\n") ? `${key}:\n${indent(value.trimEnd())}` : `${key}: ${value}`));
    super([summary, ...lines.map((l) => indent(l))].join("\n"));
    this.name = "LocalBeingDbError";
    this.stage = stage;
  }
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}

export interface BeingDbInstallation {
  source: "BEINGDB_BIN_DIR" | "BEINGDB_REPO" | "sibling checkout";
  /** The checkout to build; absent for prebuilt executables. */
  repo?: string;
  importExe: string;
  compileExe: string;
  serveExe: string;
}

export function locateBeingDb(env: NodeJS.ProcessEnv = process.env): BeingDbInstallation {
  if (env.BEINGDB_BIN_DIR) {
    const dir = path.resolve(env.BEINGDB_BIN_DIR);
    const pick = (name: string) => [path.join(dir, `beingdb-${name}`), path.join(dir, `${name}.exe`)].find((p) => existsSync(p));
    const [importExe, compileExe, serveExe] = ["import", "compile", "serve"].map(pick);
    if (!importExe || !compileExe || !serveExe) {
      throw new LocalBeingDbError("locate", "BEINGDB_BIN_DIR does not contain the BeingDB executables.", {
        BEINGDB_BIN_DIR: dir,
        expected: "beingdb-import, beingdb-compile, beingdb-serve (or import.exe, compile.exe, serve.exe)",
      });
    }
    return { source: "BEINGDB_BIN_DIR", importExe, compileExe, serveExe };
  }
  if (env.BEINGDB_REPO) return fromCheckout(path.resolve(env.BEINGDB_REPO), "BEINGDB_REPO");
  const sibling = path.resolve(PROJECT_ROOT, "..", "beingdb");
  if (existsSync(path.join(sibling, "dune-project"))) return fromCheckout(sibling, "sibling checkout");
  throw new LocalBeingDbError("locate", "No local BeingDB found.", { "looked for": sibling, fix: HOW_TO_CONFIGURE });
}

function fromCheckout(repo: string, source: "BEINGDB_REPO" | "sibling checkout"): BeingDbInstallation {
  if (!existsSync(path.join(repo, "dune-project"))) {
    throw new LocalBeingDbError("locate", `${source} is not a BeingDB checkout (no dune-project).`, { repository: repo, fix: HOW_TO_CONFIGURE });
  }
  const exe = (name: string) => path.join(repo, "_build", "default", "bin", `${name}.exe`);
  return { source, repo, importExe: exe("import"), compileExe: exe("compile"), serveExe: exe("serve") };
}

export function describeInstallation(inst: BeingDbInstallation): string {
  return inst.repo ? `${inst.repo} (${inst.source})` : `${path.dirname(inst.serveExe)} (${inst.source})`;
}

/**
 * Build the three executables with dune (incremental, so cheap when up to
 * date), falling back to `opam exec -- dune` when dune is not on PATH.
 * Returns the command used, or why nothing was built.
 */
export function buildBeingDb(inst: BeingDbInstallation): string {
  if (!inst.repo) return "not built (prebuilt executables from BEINGDB_BIN_DIR)";
  const attempts = [
    ["dune", "build", ...BUILD_TARGETS],
    ["opam", "exec", "--", "dune", "build", ...BUILD_TARGETS],
  ];
  for (const [cmd, ...args] of attempts) {
    const result = spawnSync(cmd!, args, { cwd: inst.repo, encoding: "utf8" });
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue;
    const command = `${[cmd, ...args].join(" ")}  (in ${inst.repo})`;
    if (result.status !== 0) {
      throw new LocalBeingDbError("build", "Building local BeingDB failed.", {
        repository: inst.repo,
        "build command": command,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || result.error?.message,
      });
    }
    return command;
  }
  if ([inst.importExe, inst.compileExe, inst.serveExe].every((p) => existsSync(p))) {
    return "not rebuilt (neither dune nor opam on PATH); using the existing build in _build/";
  }
  throw new LocalBeingDbError("build", "Cannot build local BeingDB: neither `dune` nor `opam` is on PATH, and it has not been built.", {
    repository: inst.repo,
    "expected executable": inst.serveExe,
    fix: `Install OCaml/opam and run \`dune build\` in ${inst.repo}, or set BEINGDB_BIN_DIR.`,
  });
}

/** Import `fixtureDir` and compile it into `<workDir>/pack_store` (both stores are recreated). Returns the pack path. */
export function compilePack(inst: BeingDbInstallation, opts: { workDir: string; fixtureDir?: string }): string {
  const fixtureDir = opts.fixtureDir ?? DEMO_FIXTURE_DIR;
  const gitStore = path.join(opts.workDir, "git_store");
  const packStore = path.join(opts.workDir, "pack_store");
  rmSync(gitStore, { recursive: true, force: true });
  rmSync(packStore, { recursive: true, force: true });
  mkdirSync(opts.workDir, { recursive: true });

  const steps: Array<[string, string[]]> = [
    [inst.importExe, ["--input", fixtureDir, "--git", gitStore]],
    [inst.compileExe, ["--git", gitStore, "--pack", packStore]],
  ];
  for (const [exe, args] of steps) {
    const result = spawnSync(exe, args, { encoding: "utf8" });
    if (result.status !== 0) {
      throw new LocalBeingDbError("compile", `Compiling the test pack failed (${path.basename(exe)}).`, {
        command: [exe, ...args].join(" "),
        fixture: fixtureDir,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim() || result.error?.message,
      });
    }
  }
  return packStore;
}

/** A free TCP port on all interfaces (BeingDB binds 0.0.0.0). */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      const address = server.address();
      server.close(() => (address && typeof address === "object" ? resolve(address.port) : reject(new Error("No port assigned"))));
    });
  });
}

function assertPortFree(port: number, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (err: NodeJS.ErrnoException) =>
      reject(new LocalBeingDbError("start", `${name} cannot start: port ${port} is unavailable (${err.code ?? err.message}).`, { fix: "Choose another port with --port." }))
    );
    server.listen(port, "0.0.0.0", () => server.close(() => resolve()));
  });
}

export interface LocalProcess {
  url: string;
  port: number;
  pid: number;
  logFile?: string;
  /** Resolves when the process exits, for whatever reason. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Stop this process only (SIGTERM, then SIGKILL after 5s). Idempotent. */
  stop(): Promise<void>;
}

export interface StartProcessOptions {
  /** Human-readable name used in errors, e.g. "Local BeingDB". */
  name: string;
  command: string;
  args: (port: number) => string[];
  env?: NodeJS.ProcessEnv | ((port: number) => NodeJS.ProcessEnv);
  cwd?: string;
  port?: number;
  /** Readiness probe for `http://127.0.0.1:<port>`. */
  isReady: (baseUrl: string) => Promise<boolean>;
  logFile?: string;
  inheritOutput?: boolean;
  readyTimeoutMs?: number;
  /** Extra lines for error reports (repository, build command, ...). */
  context?: Record<string, string | undefined>;
}

/** Spawn a localhost server process, wait until it is ready, and return a handle that stops exactly this process. */
export async function startLocalProcess(opts: StartProcessOptions): Promise<LocalProcess> {
  const port = opts.port ?? (await findFreePort());
  if (opts.port !== undefined) await assertPortFree(port, opts.name);
  const args = opts.args(port);
  const url = `http://127.0.0.1:${port}`;
  const readyTimeoutMs = opts.readyTimeoutMs ?? 20_000;

  let log: WriteStream | undefined;
  if (opts.logFile) {
    mkdirSync(path.dirname(opts.logFile), { recursive: true });
    log = createWriteStream(opts.logFile, { flags: "w" });
  }
  let tail = "";
  const record = (chunk: Buffer) => {
    log?.write(chunk);
    tail = (tail + chunk.toString("utf8")).slice(-4000);
  };

  const child: ChildProcess = spawn(opts.command, args, {
    cwd: opts.cwd,
    env: typeof opts.env === "function" ? opts.env(port) : (opts.env ?? process.env),
    stdio: ["ignore", opts.inheritOutput ? "inherit" : "pipe", opts.inheritOutput ? "inherit" : "pipe"],
  });
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);

  let spawnError: Error | undefined;
  let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    const finish = (info: { code: number | null; signal: NodeJS.Signals | null }) => {
      if (exitInfo) return;
      exitInfo = info;
      log?.end();
      resolve(info);
    };
    child.once("exit", (code, signal) => finish({ code, signal }));
    // A failed spawn (ENOENT, EACCES) emits "error" and never "exit".
    child.once("error", (err) => {
      spawnError = err;
      finish({ code: null, signal: null });
    });
  });
  // Never leave an orphaned server behind if the parent exits abruptly.
  const killOnExit = () => {
    if (!exitInfo) child.kill("SIGKILL");
  };
  process.once("exit", killOnExit);

  const stop = async () => {
    process.removeListener("exit", killOnExit);
    if (exitInfo) return;
    child.kill("SIGTERM");
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    await exited;
    clearTimeout(timer);
  };

  const details = (): Record<string, string | undefined> => ({
    executable: opts.command,
    command: [opts.command, ...args].join(" "),
    ...opts.context,
    log: opts.logFile,
    "process output": opts.inheritOutput ? "(see terminal above)" : tail || "(none)",
  });

  const deadline = Date.now() + readyTimeoutMs;
  for (;;) {
    if (spawnError) {
      throw new LocalBeingDbError("start", `${opts.name} process could not start (${spawnError.message}).`, details());
    }
    if (exitInfo) {
      throw new LocalBeingDbError(
        "start",
        `${opts.name} exited during startup (${exitInfo.signal ? `signal ${exitInfo.signal}` : `exit code ${exitInfo.code}`}).`,
        details()
      );
    }
    if (await opts.isReady(url)) break;
    if (Date.now() > deadline) {
      await stop();
      throw new LocalBeingDbError("ready", `${opts.name} did not become ready at ${url} within ${readyTimeoutMs}ms.`, details());
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return { url, port, pid: child.pid!, logFile: opts.logFile, exited, stop };
}

async function isBeingDbReady(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(1_000) });
    const body = (await res.json()) as { status?: unknown };
    return res.ok && body.status === "OK";
  } catch {
    return false;
  }
}

export function startBeingDb(
  inst: BeingDbInstallation,
  opts: { packStore: string; port?: number; logFile?: string; inheritOutput?: boolean; readyTimeoutMs?: number; buildCommand?: string }
): Promise<LocalProcess> {
  return startLocalProcess({
    name: "Local BeingDB",
    command: inst.serveExe,
    args: (port) => ["--pack", opts.packStore, "--port", String(port)],
    port: opts.port,
    isReady: isBeingDbReady,
    logFile: opts.logFile,
    inheritOutput: opts.inheritOutput,
    readyTimeoutMs: opts.readyTimeoutMs,
    context: { repository: inst.repo, "build command": opts.buildCommand, "pack store": opts.packStore },
  });
}

// ---- CLI: npm run beingdb:local [-- --port N] [-- --pack DIR] ----

function parseArgs(argv: string[]): { port: number; pack?: string } {
  let port = DEFAULT_LOCAL_PORT;
  let pack: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") port = Number(argv[++i]);
    else if (arg === "--pack") pack = argv[++i];
    else throw new Error(`Unknown argument '${arg}'. Usage: npm run beingdb:local [-- --port N] [-- --pack DIR]`);
  }
  if (!Number.isInteger(port) || port <= 0) throw new Error("--port must be a positive integer");
  return { port, pack };
}

async function main(): Promise<void> {
  const say = (msg: string) => process.stderr.write(`[beingdb:local] ${msg}\n`);
  const { port, pack } = parseArgs(process.argv.slice(2));
  const inst = locateBeingDb();
  say(`BeingDB: ${describeInstallation(inst)}`);
  const buildCommand = buildBeingDb(inst);
  say(`build: ${buildCommand}`);
  const packStore = pack ? path.resolve(pack) : compilePack(inst, { workDir: path.join(PROJECT_ROOT, ".local") });
  say(`pack store: ${packStore}${pack ? "" : " (compiled from fixtures/demo-facts)"}`);

  const server = await startBeingDb(inst, { packStore, port, inheritOutput: true, buildCommand });
  say(`ready at ${server.url} (pid ${server.pid}). Ctrl-C to stop.`);
  say(`run the MCP server against it with: ${port === DEFAULT_LOCAL_PORT ? "npm run dev" : `BEINGDB_URL=${server.url} npm run dev`}`);

  const shutdown = () => void server.stop().then(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  const { code, signal } = await server.exited;
  say(`BeingDB exited (${signal ?? `code ${code}`})`);
  process.exit(code ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    process.stderr.write(`[beingdb:local] ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
