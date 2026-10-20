/**
 * Integration-suite lifecycle: build (incrementally) and start one real,
 * local BeingDB for the whole suite, serving a pack freshly compiled from
 * fixtures/demo-facts on a free 127.0.0.1 port; stop exactly that process
 * and delete the pack afterwards, whether the tests pass or fail. The URL
 * reaches the tests via `inject("beingDbUrl")` -- no environment variable
 * or remote endpoint is consulted.
 */
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GlobalSetupContext } from "vitest/node";

import {
  PROJECT_ROOT,
  buildBeingDb,
  compilePack,
  describeInstallation,
  locateBeingDb,
  startBeingDb,
} from "../../scripts/local-beingdb.js";

declare module "vitest" {
  export interface ProvidedContext {
    beingDbUrl: string;
  }
}

export const LOG_DIR = path.join(PROJECT_ROOT, ".local", "logs");

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const say = (msg: string) => process.stdout.write(`[integration] ${msg}\n`);
  const inst = locateBeingDb();
  const buildCommand = buildBeingDb(inst);
  const workDir = mkdtempSync(path.join(os.tmpdir(), "beingdb-mcp-it-"));
  const logFile = path.join(LOG_DIR, "integration-beingdb.log");

  let server;
  try {
    const packStore = compilePack(inst, { workDir });
    server = await startBeingDb(inst, { packStore, logFile, buildCommand });
  } catch (err) {
    rmSync(workDir, { recursive: true, force: true });
    throw err;
  }

  say(`local BeingDB started: pid ${server.pid} at ${server.url}`);
  say(`  BeingDB: ${describeInstallation(inst)}; build: ${buildCommand}`);
  say(`  log: ${path.relative(PROJECT_ROOT, logFile)}`);
  provide("beingDbUrl", server.url);

  const running = server;
  return async () => {
    await running.stop();
    rmSync(workDir, { recursive: true, force: true });
    say(`local BeingDB stopped: pid ${running.pid}`);
  };
}
