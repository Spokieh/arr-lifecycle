// Run inside the deployed app container. ONLY prepare; never execute deletion.
const base = "http://127.0.0.1:3000";
const movieId = Number(process.env.MOVIE_ID ?? 148);
if (!Number.isSafeInteger(movieId) || movieId < 1)
  throw Error("Invalid movie ID");
const endpoint = `${base}/api/movies/${movieId}/deletion`;
const headers = {
  "Content-Type": "application/json",
  Origin: process.env.APP_ORIGIN,
};
const wrongOrigin = await fetch(endpoint, {
  method: "POST",
  headers: {
    ...headers,
    Origin: "http://untrusted.invalid",
  },
  body: JSON.stringify({ action: "prepare" }),
});
if (wrongOrigin.status !== 403)
  throw Error("Untrusted Origin was not rejected");
const result = await fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify({ action: "prepare" }),
});
const body = await result.json();
if (!result.ok) {
  console.log(
    JSON.stringify({
      originCheck: "passed",
      preparation: "blocked",
      reason: body.error,
      executed: false,
    }),
  );
} else {
  console.log(
    JSON.stringify({
      originCheck: "passed",
      preparation: "ready",
      title: body.prepared.plan.title,
      libraryFiles: body.prepared.plan.library.files.length,
      torrentFiles: body.prepared.plan.download.files.length,
      seerr: body.prepared.plan.seerr,
      executed: false,
    }),
  );
}
