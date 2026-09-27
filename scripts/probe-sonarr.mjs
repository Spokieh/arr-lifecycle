// Read-only connection check. Run with --env-file=.env.local; never prints keys.
for (const prefix of ["SONARR", "SONARR_ANIME"]) {
  try {
    const base = process.env[`${prefix}_URL`]?.replace(/\/+$/, "");
    const key = process.env[`${prefix}_API_KEY`];
    if (!base || !key) throw new Error("Missing configuration");
    const read = async (path) => {
      const response = await fetch(base + path, {
        method: "GET",
        headers: { "X-Api-Key": key },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    };
    const [status, series] = await Promise.all([
      read("/api/v3/system/status"),
      read("/api/v3/series"),
    ]);
    if (!Array.isArray(series) || typeof status.version !== "string")
      throw new Error("Unexpected API response");
    console.log(
      JSON.stringify({
        instance: prefix,
        connected: true,
        version: status.version,
        shows: series.length,
        category: process.env[`${prefix}_QBIT_CATEGORY`] || null,
      }),
    );
  } catch {
    console.error(
      `${prefix}: connection check failed (configuration, HTTP or network error).`,
    );
    process.exitCode = 1;
  }
}
