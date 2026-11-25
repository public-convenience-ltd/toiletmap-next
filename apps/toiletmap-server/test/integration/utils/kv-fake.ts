/**
 * In-memory stand-in for the `SETTINGS` KV namespace (the write kill switch),
 * so integration tests drive `write_mode` the way an operator would with
 * `wrangler kv key put`. Only `get` is used by the worker; `put` and
 * `delete` are for the test. Each instance is a fresh binding, so the
 * worker's per-isolate cache never carries a mode from one test to the next.
 */
export class FakeKvNamespace {
  readonly values = new Map<string, string>();
  /** When set, every `get` rejects with this error (a KV outage). */
  failWith: Error | null = null;

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  get(key: string): Promise<string | null> {
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve(this.values.get(key) ?? null);
  }

  put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.values.delete(key);
    return Promise.resolve();
  }

  /** This fake as the worker binding type (only `get` is ever called). */
  asBinding(): KVNamespace {
    return this as unknown as KVNamespace;
  }
}

/** A fresh SETTINGS binding with `write_mode` set to `mode`. */
export const settingsWithWriteMode = (mode: string) =>
  new FakeKvNamespace({ write_mode: mode }).asBinding();
