/**
 * Runs one of Playwright's webServer commands, keeps its output, and restarts
 * it if it dies mid-run:
 *
 *   node e2e/support/log-web-server.ts <log file> <command> [args...]
 *
 * Output: stdout and stderr both go to the log file, each line prefixed with
 * a timestamp (to line up with test failures); stderr is also passed through
 * to Playwright, which prints it with a [WebServer] prefix.
 *
 * Restarts: if the command exits without having been asked to stop (wrangler
 * dev 4.120 sometimes exits after "ProxyController ... Network connection
 * lost" and never comes back), it is started again after a short backoff, up
 * to MAX_RESTARTS times per run; each restart is logged to the log file and
 * stderr. Leftovers of the dead command (e.g. workerd, which keeps holding
 * :8787 when wrangler is killed) are killed first, and again on the way out.
 * A stop request (SIGINT /
 * SIGTERM / SIGHUP to this process, or the command being ended by SIGINT /
 * SIGTERM) is never answered with a restart. Playwright normally stops web
 * servers by SIGKILLing the whole process group, which ends this wrapper and
 * everything it started at once.
 *
 * Run directly by Node (type stripping), so only erasable TypeScript and
 * node: imports.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAX_RESTARTS = 5;
/** Backoff before restart n (1-based): 1s, 2s, 3s, ... */
const restartDelayMs = (n: number) => n * 1_000;

const [logFile, command, ...args] = process.argv.slice(2);
if (!logFile || !command) {
  console.error("Usage: node log-web-server.ts <log file> <command> [args...]");
  process.exit(2);
}

mkdirSync(dirname(logFile), { recursive: true });
const log = createWriteStream(logFile, { flags: "w" });

/** Colour codes (the dev servers colour their output even into a pipe). */
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const writeLine = (stream: string, line: string) =>
  log.write(`${new Date().toISOString()} ${stream} ${line.replace(ANSI_COLOUR, "")}\n`);

/** A wrapper message: to the log file and (for Playwright's output) stderr. */
const announce = (message: string) => {
  writeLine("---", message);
  process.stderr.write(`[log-web-server] ${message}\n`);
};

/** Writes complete lines with a timestamp; keeps a trailing partial line for the next chunk. */
function lineWriter(stream: string) {
  let pending = "";
  return {
    write(chunk: Buffer) {
      const lines = (pending + chunk.toString("utf8")).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) writeLine(stream, line);
    },
    flush() {
      if (pending) writeLine(stream, pending);
      pending = "";
    },
  };
}

const out = lineWriter("out");
const err = lineWriter("err");
const commandLine = [command, ...args].join(" ");

let child: ChildProcess | undefined;
let restarts = 0;
let restartTimer: NodeJS.Timeout | undefined;
let stopping = false;

const finish = (code: number) => log.end(() => process.exit(code));

/**
 * Kills what the dead command left behind: processes in this process group
 * that were orphaned (re-parented to pid 1), and their descendants. Only the
 * command's own descendants qualify, never this wrapper or its parents.
 */
function killLeftovers() {
  if (process.platform === "win32") return;
  let rows: { pid: number; ppid: number; pgid: number }[];
  try {
    rows = execFileSync("ps", ["-A", "-o", "pid=,ppid=,pgid="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .map((line) => {
        const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number);
        return { pid, ppid, pgid };
      });
  } catch (error) {
    announce(`could not list processes to clean up: ${(error as Error).message}`);
    return;
  }
  const pgid = rows.find((row) => row.pid === process.pid)?.pgid;
  if (pgid === undefined) return;
  const group = rows.filter((row) => row.pgid === pgid && row.pid !== process.pid);
  const leftovers = new Set(group.filter((row) => row.ppid === 1).map((row) => row.pid));
  for (let grew = true; grew; ) {
    grew = false;
    for (const row of group) {
      if (!leftovers.has(row.pid) && leftovers.has(row.ppid)) {
        leftovers.add(row.pid);
        grew = true;
      }
    }
  }
  if (leftovers.size === 0) return;
  announce(`killing leftover processes of the exited command: ${[...leftovers].join(", ")}`);
  for (const pid of leftovers) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function start() {
  writeLine("---", restarts === 0 ? commandLine : `restart ${restarts}: ${commandLine}`);
  const current = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
  child = current;
  current.stdout?.on("data", (chunk: Buffer) => out.write(chunk));
  current.stderr?.on("data", (chunk: Buffer) => {
    err.write(chunk);
    process.stderr.write(chunk);
  });

  current.on("error", (error) => {
    // Failed to start at all (e.g. command not found): restarting will not help.
    announce(`failed to start: ${error.message}`);
    child = undefined;
    finish(1);
  });

  current.on("exit", (code, signal) => {
    if (child !== current) return; // already handled by "error"
    child = undefined;
    out.flush();
    err.flush();
    const status = `code ${code}, signal ${signal}`;

    if (stopping || signal === "SIGINT" || signal === "SIGTERM") {
      writeLine("---", `exited (${status})`);
      killLeftovers();
      finish(code ?? 1);
      return;
    }
    if (restarts >= MAX_RESTARTS) {
      announce(`exited unexpectedly (${status}); giving up after ${MAX_RESTARTS} restarts`);
      finish(code || 1);
      return;
    }

    restarts++;
    const delay = restartDelayMs(restarts);
    announce(
      `exited unexpectedly (${status}); restart ${restarts} of ${MAX_RESTARTS} in ${delay / 1000}s: ${commandLine}`,
    );
    killLeftovers();
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      if (!stopping) start();
    }, delay);
  });
}

// Playwright stops web servers by signalling the whole process group; pass
// signals on anyway in case only this process receives one.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => {
    stopping = true;
    if (child) {
      child.kill(signal);
    } else {
      // Between a crash and its restart: nothing to wait for.
      clearTimeout(restartTimer);
      writeLine("---", `stopped by ${signal} while waiting to restart`);
      finish(1);
    }
  });
}

start();
