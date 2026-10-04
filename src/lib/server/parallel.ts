/** Bounded reads; await every worker even when one fails. */
export async function mapLimited<T, R>(
  items: T[],
  concurrency: number,
  load: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (index < items.length) {
        const current = index++;
        result[current] = await load(items[current], current);
      }
    },
  );
  const settled = await Promise.allSettled(workers);
  const error = settled.find((entry) => entry.status === "rejected");
  if (error?.status === "rejected") throw error.reason;
  return result;
}
