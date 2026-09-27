import "server-only";
import { createHash } from "node:crypto";

type Entry = { value?: unknown; expires: number; pending?: Promise<unknown> };
const root = globalThis as typeof globalThis & {
  arrCache?: Map<string, Entry>;
};
const entries = (root.arrCache ??= new Map<string, Entry>());

export function cacheKey(...parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Successful values only; concurrent callers share one request. No stale fallback. */
export async function cached<T>(
  key: string,
  ttl: number,
  load: () => Promise<T>,
): Promise<T> {
  const existing = entries.get(key);
  if (existing?.pending) return existing.pending as Promise<T>;
  if (existing && existing.expires > Date.now()) return existing.value as T;
  entries.delete(key);
  if (entries.size >= 512) {
    for (const [oldKey, entry] of entries) {
      if (!entry.pending) {
        entries.delete(oldKey);
        break;
      }
    }
  }
  if (entries.size >= 512) return load();
  const entry: Entry = { expires: 0 };
  const pending = Promise.resolve()
    .then(load)
    .then(
      (value) => {
        entry.value = value;
        entry.expires = Date.now() + ttl;
        entry.pending = undefined;
        return value;
      },
      (error) => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      },
    );
  entry.pending = pending;
  entries.set(key, entry);
  return pending;
}
export function invalidate(key: string) {
  entries.delete(key);
}
