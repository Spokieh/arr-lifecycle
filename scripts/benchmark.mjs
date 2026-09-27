const base = process.env.BENCH_URL || "http://localhost:3100";
for (const path of [
  "/movies",
  "/movies",
  "/movies/148",
  "/movies/148",
  "/movies/407",
  "/movies?q=Intimate",
]) {
  const start = performance.now();
  const response = await fetch(base + path);
  const headersMs = Math.round(performance.now() - start);
  const html = await response.text();
  console.log(
    JSON.stringify({
      path,
      status: response.status,
      headersMs,
      completeMs: Math.round(performance.now() - start),
      bytes: Buffer.byteLength(html),
      exactMatch: html.includes("Matched by hash"),
      secretsExposed: [process.env.RADARR_API_KEY, process.env.QBIT_PASSWORD]
        .filter(Boolean)
        .some((secret) => html.includes(secret)),
      hasServiceError:
        html.includes("request failed") ||
        html.includes("Matching unavailable"),
    }),
  );
}
