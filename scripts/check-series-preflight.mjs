// Read-only live preparation. Never sends execute or prints confirmation tokens.
for (const [instance, id] of [["tv", 71], ["anime", 14], ["anime", 21]]) {
  const response = await fetch(`http://127.0.0.1:3000/api/shows/${instance}/${id}/deletion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.APP_ORIGIN },
    body: JSON.stringify({ action: "prepare" }),
    signal: AbortSignal.timeout(90000),
  });
  const result = await response.json();
  const plan = result.prepared?.plan;
  console.log(JSON.stringify({ instance, id, status: response.status,
    title: plan?.title, episodeFiles: plan?.episodeFiles.length,
    torrents: plan?.torrents.map(({ hash, name, category, matchEvidence, matchedEpisodeFileIds }) => ({ hash, name, category, matchEvidence, matchedEpisodeFileIds })),
    seerrMediaId: plan?.seerr.mediaId,
    error: result.error }));
}
