import type { ExportBucket } from "../../../src/services/export";

type StoredObject = {
  bytes: Uint8Array;
  contentType?: string;
  customMetadata: Record<string, string>;
  uploaded: Date;
};

export type R2Op = { op: "get" | "put" | "list"; key: string };

/**
 * In-memory stand-in for the part of an R2 bucket the dataset export uses
 * (`ExportBucket`). It records every operation in order, so tests can check
 * write ordering, and can be told to fail a put.
 */
export class FakeR2Bucket implements ExportBucket {
  readonly objects = new Map<string, StoredObject>();
  readonly ops: R2Op[] = [];
  /** Keys whose next put throws (to simulate a failed upload). */
  readonly failPutFor = new Set<string>();

  get(key: string) {
    this.ops.push({ op: "get", key });
    const stored = this.objects.get(key);
    if (!stored) return Promise.resolve(null);
    const text = new TextDecoder().decode(stored.bytes);
    return Promise.resolve({ text: () => Promise.resolve(text) });
  }

  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ) {
    this.ops.push({ op: "put", key });
    if (this.failPutFor.has(key)) {
      this.failPutFor.delete(key);
      return Promise.reject(new Error(`Simulated R2 failure writing ${key}`));
    }
    const bytes =
      typeof value === "string"
        ? new TextEncoder().encode(value)
        : value instanceof ArrayBuffer
          ? new Uint8Array(value.slice(0))
          : new Uint8Array(
              value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
            );
    this.objects.set(key, {
      bytes,
      contentType: options?.httpMetadata?.contentType,
      customMetadata: { ...options?.customMetadata },
      uploaded: new Date(),
    });
    return Promise.resolve({ key, size: bytes.byteLength });
  }

  list(options: { prefix?: string; delimiter?: string; cursor?: string } = {}) {
    const prefix = options.prefix ?? "";
    this.ops.push({ op: "list", key: prefix });
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    const delimitedPrefixes = new Set<string>();
    if (options.delimiter) {
      for (const key of keys) {
        const rest = key.slice(prefix.length);
        const index = rest.indexOf(options.delimiter);
        if (index >= 0) {
          delimitedPrefixes.add(prefix + rest.slice(0, index + options.delimiter.length));
        }
      }
    }
    return Promise.resolve({ delimitedPrefixes: [...delimitedPrefixes], truncated: false });
  }

  /** Stores an object directly (no op recorded), e.g. a previous manifest. */
  seed(key: string, value: string, contentType = "application/json") {
    this.objects.set(key, {
      bytes: new TextEncoder().encode(value),
      contentType,
      customMetadata: {},
      uploaded: new Date(),
    });
  }

  text(key: string): string | null {
    const stored = this.objects.get(key);
    return stored ? new TextDecoder().decode(stored.bytes) : null;
  }

  puts(): string[] {
    return this.ops.filter((op) => op.op === "put").map((op) => op.key);
  }

  /** As the worker's `EXPORTS` binding type (only the methods above exist). */
  asBinding(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}
