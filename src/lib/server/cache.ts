import "server-only";
import { createHash } from "node:crypto";

type Entry = {
  value?: unknown;
  expires: number;
  pending?: Promise<unknown>;
  group?: string;
  fetchedAt?: number;
};
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
  group?: string,
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
  const entry: Entry = { expires: 0, group };
  const pending = Promise.resolve()
    .then(load)
    .then(
      (value) => {
        entry.value = value;
        entry.fetchedAt = Date.now();
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

/** Does not invalidate authentication sessions. Pending invalidated reads cannot repopulate the map. */
export function invalidateGroup(group: string) {
  for (const [key, entry] of entries) {
    if (entry.group === group) entries.delete(key);
  }
}

export function oldestCachedRead(group: string): number | null {
  const timestamps = [...entries.values()]
    .filter((entry) => entry.group === group && entry.expires > Date.now())
    .flatMap((entry) => (entry.fetchedAt ? [entry.fetchedAt] : []));
  return timestamps.length ? Math.min(...timestamps) : null;
}
