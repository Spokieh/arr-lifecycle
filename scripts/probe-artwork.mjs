// Inspect public artwork locations without printing credentials or URL queries.
for (const prefix of ["SONARR", "SONARR_ANIME"]) {
  const response = await fetch(
    process.env[`${prefix}_URL`] + "/api/v3/series",
    {
      headers: { "X-Api-Key": process.env[`${prefix}_API_KEY`] },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new Error(`${prefix}: HTTP ${response.status}`);
  const series = await response.json();
  console.log(
    prefix,
    JSON.stringify(
      series.slice(0, 2).map((show) => ({
        id: show.id,
        images: show.images?.map((image) => {
          const url = image.remoteUrl ? new URL(image.remoteUrl) : null;
          return {
            type: image.coverType,
            host: url?.hostname,
            path: url?.pathname,
          };
        }),
      })),
    ),
  );
}
