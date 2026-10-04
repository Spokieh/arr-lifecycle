import "server-only";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}
const shared = globalThis as typeof globalThis & {
  arrRequests?: { active: number; queue: Array<() => void> };
};
const pool = (shared.arrRequests ??= { active: 0, queue: [] });
async function acquire(): Promise<() => void> {
  if (pool.active >= 6) {
    await new Promise<void>((resolve, reject) => {
      const resume = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = pool.queue.indexOf(resume);
        if (index >= 0) pool.queue.splice(index, 1);
        reject(new ApiError("Services are busy. Please retry shortly."));
      }, 5000);
      pool.queue.push(resume);
    });
  } else pool.active++;
  return () => {
    const next = pool.queue.shift();
    if (next) next();
    else pool.active--;
  };
}
export async function request<T>(
  service: string,
  url: string,
  init: RequestInit,
  decode: (response: Response) => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  const release = await acquire();
  try {
    const response = await fetch(url, {
      ...init,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok)
      throw new ApiError(
        `${service}: HTTP ${response.status}.`,
        response.status,
      );
    return await decode(response);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      `${service}: request failed or exceeded the ${timeoutMs / 1000}-second limit.`,
    );
  } finally {
    release();
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Service unavailable.";
}
