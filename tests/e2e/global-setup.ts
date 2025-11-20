import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import { URL } from 'node:url';

type SupabaseStatus = {
  dbUrl?: string;
};

const projectRoot = resolve(__dirname, '../..');
const envCandidates = [
  '.env.test.local',
  '.env.test',
  '.env.local',
  '.env',
].map((file) => resolve(projectRoot, file));

const SUPABASE_ENV = {
  SUPABASE_SCANNER_BUFFER_SIZE: '100mb',
};

const log = (message: string) => {
  console.info(`[e2e] ${message}`);
};

class SupabaseManager {
  private dbUrl?: string;
  private startedBySetup = false;

  async prepare() {
    log('Ensuring Supabase services are available…');
    await this.ensureStarted();
    log('Supabase services confirmed running.');
    await this.resetDatabase();
    await this.ensureDatabaseReady();
  }

  getPostgresBaseUrl(): string {
    if (!this.dbUrl) {
      throw new Error('Supabase database URL unavailable.');
    }
    return this.dbUrl;
  }

  async teardown() {
    const keepRunning =
      process.env.KEEP_SUPABASE === '1' ||
      process.env.E2E_KEEP_SUPABASE === '1';

    if (!this.startedBySetup || keepRunning) {
      if (this.startedBySetup) {
        log('Leaving Supabase running per configuration.');
      }
      return;
    }

    log('Stopping Supabase services started by the test run…');
    await this.runSupabase(['stop'], { allowFailure: true });
  }

  private async ensureStarted() {
    const status = await this.fetchStatus();

    if (status?.dbUrl) {
      this.dbUrl = status.dbUrl;
       log(`Detected existing Supabase instance at ${status.dbUrl}.`);
      return;
    }

    log('Supabase is not running; starting services…');
    await this.runSupabase([
      'start',
      '--exclude',
      'gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor',
      '--ignore-health-check',
      '--output',
      'env',
      '--yes',
    ]);

    this.startedBySetup = true;

    const readyStatus = await this.waitForStatus();
    log('Supabase services started successfully.');
    this.dbUrl = readyStatus.dbUrl;
  }

  private async resetDatabase() {
    log('Resetting Supabase database state…');
    await this.runSupabase(['db', 'reset', '--yes']);
    const status = await this.waitForStatus();
    log('Database reset complete.');
    this.dbUrl = status.dbUrl;
  }

  private async ensureDatabaseReady(timeout = 120_000) {
    if (!this.dbUrl) {
      throw new Error('Cannot verify Supabase readiness without DB URL.');
    }

    const url = new URL(this.dbUrl);
    const port = Number.parseInt(url.port || '5432', 10);
    const host = url.hostname;
    const deadline = Date.now() + timeout;

    log(`Waiting for database connection on ${host}:${port}…`);

    while (Date.now() < deadline) {
      const connected = await new Promise<boolean>((resolve) => {
        const socket = net.createConnection(
          { host, port, timeout: 3_000 },
          () => {
            socket.end();
            log('Database connection confirmed.');
            resolve(true);
          },
        );

        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });

        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
      });

      if (connected) {
        return;
      }

      await delay(1_000);
    }

    throw new Error(
      `Timed out waiting for Supabase database at ${host}:${port}`,
    );
  }

  private async waitForStatus(timeout = 120_000): Promise<SupabaseStatus> {
    const deadline = Date.now() + timeout;
    let lastError: unknown;

    while (Date.now() < deadline) {
      try {
        const status = await this.fetchStatus();
        if (status?.dbUrl) {
          if (!this.dbUrl) {
            log(`Supabase status available: ${status.dbUrl}`);
          }
          return status;
        }
      } catch (error) {
        lastError = error;
      }

      await delay(1_000);
    }

    if (lastError instanceof Error) {
      throw new Error(
        `Supabase did not become ready: ${lastError.message}`,
      );
    }

    throw new Error('Supabase did not become ready in time.');
  }

  private async fetchStatus(): Promise<SupabaseStatus | null> {
    const result = await this.runSupabase(
      ['status', '--output', 'env'],
      { allowFailure: true },
    );

    if (result.exitCode !== 0) {
      return null;
    }

    const dbUrl =
      this.extractDbUrl(result.stdout) || this.extractDbUrl(result.stderr);

    return { dbUrl };
  }

  private extractDbUrl(output: string): string | undefined {
    const envMatch = output.match(/DB_URL="?([^\s"]+)"?/);
    if (envMatch?.[1]) {
      return envMatch[1];
    }

    const prettyMatch = output.match(/Database URL:\s*(\S+)/);
    return prettyMatch?.[1];
  }

  private async runSupabase(
    args: string[],
    options?: { allowFailure?: boolean },
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn('pnpm', ['exec', 'supabase', ...args], {
        cwd: projectRoot,
        env: {
          ...process.env,
          ...SUPABASE_ENV,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      log(`Running: pnpm exec supabase ${args.join(' ')}`);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        const exitCode = code ?? 0;

        if (exitCode === 0 || options?.allowFailure) {
          resolve({ stdout, stderr, exitCode });
          return;
        }

        reject(
          new Error(
            `Supabase CLI command failed (exit ${exitCode}): ${stdout || stderr}`,
          ),
        );
      });
    });
  }
}

function loadEnvironment() {
  log('Loading environment variables for E2E tests…');
  for (const file of envCandidates) {
    if (existsSync(file)) {
      loadEnv({ path: file, override: false, quiet: true });
      log(`Applied environment file: ${file}`);
    }
  }
  log('Environment variables loaded.');
}

function resolvePostgresUri(baseUrl: string): string {
  const existing = process.env.POSTGRES_URI;
  const supabaseUrl = new URL(baseUrl);

  if (!existing) {
    return supabaseUrl.toString();
  }

  try {
    const existingUrl = new URL(existing);
    if (
      existingUrl.hostname === supabaseUrl.hostname &&
      existingUrl.port === supabaseUrl.port
    ) {
      return existingUrl.toString();
    }
  } catch (error) {
    // Ignore parse errors and fall back to Supabase URL.
  }

  log(
    `Using Supabase database URL from CLI: ${supabaseUrl.toString()}`,
  );
  return supabaseUrl.toString();
}

export default async function setup() {
  loadEnvironment();

  const manager = new SupabaseManager();
  await manager.prepare();

  const baseUrl = manager.getPostgresBaseUrl();
  const resolvedUri = resolvePostgresUri(baseUrl);

  process.env.POSTGRES_URI = resolvedUri;

  log(`Supabase ready at ${resolvedUri}`);

  return async () => {
    await manager.teardown();
  };
}
