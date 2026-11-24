import type { DatasetBucket, DatasetObject, DatasetObjectBody } from "../utils/dataset";

type Stored = {
  text: string;
  contentType?: string;
  customMetadata?: Record<string, string>;
  uploaded: Date;
  etag: string;
};

/**
 * In-memory stand-in for the read side of an R2 bucket (`DatasetBucket`).
 * `get(key, { onlyIf: headers })` follows R2: when `If-None-Match` matches
 * the ETag, the object is not newer than `If-Modified-Since`, `If-Match`
 * does not match, or the object is newer than `If-Unmodified-Since`, it
 * returns the object without a body. `get(key, { range: headers })` returns
 * the bytes a single `Range` asks for and sets `range` (as R2 does, it sets
 * `range` to the whole object otherwise, and ignores a range it cannot
 * satisfy). `failNextGet` makes the next get throw.
 */
export class FakeDatasetBucket implements DatasetBucket {
  readonly objects = new Map<string, Stored>();
  readonly gets: string[] = [];
  failNextGet = false;

  put(
    key: string,
    text: string,
    options: {
      contentType?: string;
      customMetadata?: Record<string, string>;
      uploaded?: Date;
    } = {},
  ) {
    this.objects.set(key, {
      text,
      contentType: options.contentType,
      customMetadata: options.customMetadata,
      uploaded: options.uploaded ?? new Date("2026-11-18T00:17:05.000Z"),
      etag: `etag-${this.objects.size + 1}`,
    });
  }

  private meta(stored: Stored): DatasetObject {
    return {
      size: new TextEncoder().encode(stored.text).byteLength,
      httpEtag: `"${stored.etag}"`,
      uploaded: stored.uploaded,
      httpMetadata: stored.contentType ? { contentType: stored.contentType } : {},
      customMetadata: stored.customMetadata ?? {},
    };
  }

  private conditionFails(stored: Stored, meta: DatasetObject, onlyIf: Headers | undefined) {
    if (!onlyIf) return false;
    const seconds = Math.floor(stored.uploaded.getTime() / 1000);
    const date = (name: string) => {
      const value = onlyIf.get(name);
      return value ? Math.floor(Date.parse(value) / 1000) : null;
    };
    const tags = (name: string) =>
      onlyIf
        .get(name)
        ?.split(",")
        .map((tag) => tag.trim());
    const ifMatch = tags("if-match");
    if (ifMatch && !ifMatch.some((tag) => tag === meta.httpEtag || tag === "*")) return true;
    const unmodifiedSince = date("if-unmodified-since");
    if (unmodifiedSince !== null && seconds > unmodifiedSince) return true;
    const ifNoneMatch = tags("if-none-match");
    if (ifNoneMatch) return ifNoneMatch.some((tag) => tag === meta.httpEtag || tag === "*");
    const modifiedSince = date("if-modified-since");
    return modifiedSince !== null && seconds <= modifiedSince;
  }

  get(
    key: string,
    options?: { onlyIf?: Headers; range?: Headers },
  ): Promise<DatasetObjectBody | DatasetObject | null> {
    this.gets.push(key);
    if (this.failNextGet) {
      this.failNextGet = false;
      return Promise.reject(new Error("Simulated R2 failure"));
    }
    const stored = this.objects.get(key);
    if (!stored) return Promise.resolve(null);
    const meta = this.meta(stored);
    if (this.conditionFails(stored, meta, options?.onlyIf)) return Promise.resolve(meta);

    const bytes = new TextEncoder().encode(stored.text);
    let offset = 0;
    let length = bytes.byteLength;
    const single = /^bytes=(\d*)-(\d*)$/.exec(options?.range?.get("range") ?? "");
    if (single && (single[1] || single[2])) {
      const [, first, last] = single;
      if (!first) {
        length = Math.min(Number(last), bytes.byteLength);
        offset = bytes.byteLength - length;
      } else {
        const start = Number(first);
        const end = last ? Math.min(Number(last), bytes.byteLength - 1) : bytes.byteLength - 1;
        if (start < bytes.byteLength && end >= start) {
          offset = start;
          length = end - start + 1;
        }
      }
    }
    const part = bytes.slice(offset, offset + length);
    return Promise.resolve({
      ...meta,
      range: { offset, length },
      body: new Response(part).body as ReadableStream,
      text: () => Promise.resolve(new TextDecoder().decode(part)),
    });
  }

  head(key: string): Promise<DatasetObject | null> {
    const stored = this.objects.get(key);
    return Promise.resolve(stored ? this.meta(stored) : null);
  }
}
