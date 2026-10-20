/**
 * Failure reporting of the local BeingDB harness, using stand-in shell
 * scripts for the BeingDB executables (no real BeingDB needed).
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocalBeingDbError, compilePack, locateBeingDb, startBeingDb } from "../../scripts/local-beingdb.js";
import type { BeingDbInstallation } from "../../scripts/local-beingdb.js";

let dir: string;

function script(name: string, body: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

function fakeInstallation(serveBody: string, importBody = "exit 0"): BeingDbInstallation {
  return {
    source: "BEINGDB_BIN_DIR",
    importExe: script("beingdb-import", importBody),
    compileExe: script("beingdb-compile", "exit 0"),
    serveExe: script("beingdb-serve", serveBody),
  };
}

async function captureError(promise: Promise<unknown> | (() => unknown)): Promise<LocalBeingDbError> {
  try {
    await (typeof promise === "function" ? promise() : promise);
  } catch (err) {
    expect(err).toBeInstanceOf(LocalBeingDbError);
    return err as LocalBeingDbError;
  }
  throw new Error("expected a LocalBeingDbError");
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "beingdb-harness-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("locateBeingDb", () => {
  it("explains how to configure BeingDB when BEINGDB_REPO is not a checkout", async () => {
    const err = await captureError(() => locateBeingDb({ BEINGDB_REPO: path.join(dir, "missing") }));
    expect(err.stage).toBe("locate");
    expect(err.message).toContain("BEINGDB_REPO is not a BeingDB checkout");
    expect(err.message).toContain(path.join(dir, "missing"));
    expect(err.message).toContain("BEINGDB_BIN_DIR");
  });

  it("reports missing executables in BEINGDB_BIN_DIR", async () => {
    const err = await captureError(() => locateBeingDb({ BEINGDB_BIN_DIR: dir }));
    expect(err.stage).toBe("locate");
    expect(err.message).toContain("beingdb-serve");
  });

  it("prefers BEINGDB_BIN_DIR over BEINGDB_REPO and accepts installed executable names", () => {
    fakeInstallation("exit 0");
    const inst = locateBeingDb({ BEINGDB_BIN_DIR: dir, BEINGDB_REPO: "/nonexistent" });
    expect(inst).toEqual({
      source: "BEINGDB_BIN_DIR",
      importExe: path.join(dir, "beingdb-import"),
      compileExe: path.join(dir, "beingdb-compile"),
      serveExe: path.join(dir, "beingdb-serve"),
    });
  });

  it("uses BEINGDB_REPO's dune build directory", () => {
    const repo = path.join(dir, "beingdb");
    mkdirSync(repo);
    writeFileSync(path.join(repo, "dune-project"), "");
    const inst = locateBeingDb({ BEINGDB_REPO: repo });
    expect(inst.source).toBe("BEINGDB_REPO");
    expect(inst.serveExe).toBe(path.join(repo, "_build", "default", "bin", "serve.exe"));
  });
});

describe("compilePack", () => {
  it("reports the failing command and its output", async () => {
    const inst = fakeInstallation("exit 0", 'echo "bad fact on line 3" >&2; exit 1');
    const err = await captureError(() => compilePack(inst, { workDir: path.join(dir, "work") }));
    expect(err.stage).toBe("compile");
    expect(err.message).toContain("beingdb-import");
    expect(err.message).toContain("bad fact on line 3");
  });
});

describe("startBeingDb", () => {
  it("distinguishes a server that exits during startup, with its output", async () => {
    const inst = fakeInstallation('echo "cannot open pack store" >&2; exit 3');
    const err = await captureError(startBeingDb(inst, { packStore: dir, buildCommand: "dune build" }));
    expect(err.stage).toBe("start");
    expect(err.message).toContain("Local BeingDB exited during startup (exit code 3)");
    expect(err.message).toContain(`executable: ${inst.serveExe}`);
    expect(err.message).toContain("build command: dune build");
    expect(err.message).toContain("cannot open pack store");
  });

  it("distinguishes an executable that cannot be spawned", async () => {
    const inst = { ...fakeInstallation("exit 0"), serveExe: path.join(dir, "no-such-serve") };
    const err = await captureError(startBeingDb(inst, { packStore: dir }));
    expect(err.stage).toBe("start");
    expect(err.message).toContain("process could not start");
    expect(err.message).toContain("ENOENT");
  });

  it("distinguishes a server that never becomes ready, and stops only that process", async () => {
    const pidFile = path.join(dir, "pid");
    const inst = fakeInstallation(`echo $$ > "${pidFile}"; exec sleep 30`);
    const err = await captureError(startBeingDb(inst, { packStore: dir, readyTimeoutMs: 500 }));
    expect(err.stage).toBe("ready");
    expect(err.message).toMatch(/did not become ready at http:\/\/127\.0\.0\.1:\d+ within 500ms/);

    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
