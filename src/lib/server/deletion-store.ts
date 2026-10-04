import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import * as path from "node:path";
import { confirmationFor, requireCondition } from "../deletion-policy";
import type {
  DeletionOperation,
  MovieDeletionPlan,
  PreparedDeletion,
} from "../types/deletion";

export interface PreparedPlan<T> {
  operationId: string;
  token: string;
  expiresAt: string;
  confirmation: string;
  plan: T;
}
type Stored = {
  scope: string;
  prepared: PreparedPlan<unknown>;
  binding: string;
};
const global = globalThis as typeof globalThis & {
  arrDeletionPlans?: Map<string, Stored>;
};
const plans = (global.arrDeletionPlans ??= new Map<string, Stored>());

export function rememberPlan(
  plan: MovieDeletionPlan,
  binding: string,
): PreparedDeletion {
  return rememberScopedPlan(
    `movie:${plan.movieId}`,
    plan,
    binding,
    confirmationFor(plan),
  );
}

export function rememberScopedPlan<T>(
  scope: string,
  plan: T,
  binding: string,
  confirmation: string,
): PreparedPlan<T> {
  for (const [key, value] of plans)
    if (Date.parse(value.prepared.expiresAt) <= Date.now()) plans.delete(key);
  requireCondition(
    plans.size < 32,
    "Too many prepared plans. Wait for expiry.",
  );
  const prepared = {
    operationId: randomUUID(),
    token: randomBytes(32).toString("hex"),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    confirmation,
    plan,
  };
  plans.set(prepared.token, { scope, prepared, binding });
  return prepared;
}

export function consumePlan(
  movieId: number,
  token: unknown,
  confirmation: unknown,
  acknowledged: unknown,
  binding: string,
) {
  return consumeScopedPlan<MovieDeletionPlan>(
    `movie:${movieId}`,
    token,
    confirmation,
    acknowledged,
    binding,
  );
}

export function consumeScopedPlan<T>(
  scope: string,
  token: unknown,
  confirmation: unknown,
  acknowledged: unknown,
  binding: string,
): PreparedPlan<T> {
  requireCondition(
    typeof token === "string" && /^[a-f0-9]{64}$/.test(token),
    "Invalid confirmation token.",
  );
  const stored = plans.get(token);
  requireCondition(
    stored &&
      stored.scope === scope &&
      stored.binding === binding &&
      Date.parse(stored.prepared.expiresAt) > Date.now(),
    "Plan expired or unavailable. Prepare it again.",
  );
  requireCondition(
    confirmation === stored.prepared.confirmation && acknowledged === true,
    "Type the exact confirmation and acknowledge the deletion scope.",
  );
  plans.delete(token); // Consume synchronously before any await, including lock acquisition.
  return stored.prepared as PreparedPlan<T>;
}

function directory() {
  const value = process.env.DELETE_STATE_DIR;
  requireCondition(
    value &&
      path.isAbsolute(value) &&
      path.resolve(value) !== path.parse(value).root,
    "A persistent deletion journal directory is required.",
  );
  return value;
}
function operationPath(id: string) {
  requireCondition(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      id,
    ),
    "Invalid operation ID.",
  );
  return path.join(directory(), `${id}.json`);
}
async function syncDirectory() {
  if (process.platform === "win32") return;
  const handle = await open(directory(), "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function acquireDeletionLock(id: string) {
  operationPath(id);
  await mkdir(directory(), { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = await open(path.join(directory(), "deletion.lock"), "wx", 0o600);
  } catch {
    throw new Error(
      "Deletion is locked by another or interrupted operation. Review the server journal before continuing.",
    );
  }
  try {
    await lock.writeFile(id);
    await lock.sync();
  } finally {
    await lock.close();
  }
  await syncDirectory();
}

export async function releaseDeletionLock(id: string) {
  const target = path.join(directory(), "deletion.lock");
  requireCondition(
    (await readFile(target, "utf8")) === id,
    "Deletion lock ownership changed.",
  );
  await unlink(target);
  await syncDirectory();
}

export async function persistOperation(operation: { id: string }) {
  const target = operationPath(operation.id),
    temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(operation, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await syncDirectory();
}

export async function readOperation<
  T extends { id: string } = DeletionOperation,
>(id: string): Promise<T> {
  const value = JSON.parse(await readFile(operationPath(id), "utf8")) as T;
  requireCondition(value.id === id, "Invalid operation journal.");
  return value;
}
