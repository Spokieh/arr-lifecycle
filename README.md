# Arr Lifecycle

Read-only Next.js App Router application for Radarr movies and related qBittorrent torrents.

## Run

Install with `npm ci`. Copy `.env.example` to `.env.local` and configure the service URLs and credentials. Secrets are server-only; never use NEXT_PUBLIC variables.

- Development: `npm run dev`
- Production locally: `npm run build`, then `npm start`
- Movies: http://localhost:3000/movies

Leave both qBittorrent credentials empty only when the server already permits this client's unauthenticated access. Otherwise set both. This app does not configure service authentication.

## Data flow and performance

The searchable movie list renders 24 movies per page. Movie/status/torrent reads run concurrently. One paginated Radarr history query covers the visible movie IDs; details fetch the selected movie's complete history. Upstream errors are shown as unavailable, not as absence of torrents.

A process-local cache stores successful reads for 30 seconds (version: 60 seconds, authenticated session: 20 minutes). Keys include service and credential identity, hashed in memory. Concurrent identical reads share a promise. The cache is capped at 512 entries, survives development module reloads, and resets on process restart. Each server process has its own cache. Expired data is not silently used as current data. Large payloads bypass the Next.js Data Cache.

External work is limited to six concurrent requests per process. Network reads have a five-second timeout; queue waiting is also limited to five seconds. Authenticated qBittorrent sessions renew once after a 403. A slow history sequence is bounded and reports incomplete lookup rather than treating partial history as proof. A whole page may take longer than a single request timeout.

Loading boundaries stream a loading state immediately. Use production mode for representative timing; development compilation adds latency.

## Matching and preview

Both routes use the same matcher. Radarr history's top-level downloadId is compared to torrent hashes, scoped strictly to the movie ID. Exactly one hash match in MoviesRR is required for eligibility. Multiple matches are ambiguous; other categories are blocked. Title/year candidates are labelled explicitly and remain blocked.

History API reference: https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/History/HistoryResource.cs

The delete preview has no executable deletion control. Its eligibility is based on cached API evidence only; it does not verify hardlinks, filesystem ownership, or current deletion safety. Any future execution feature must fetch fresh evidence and perform filesystem checks separately.

## Verification

- `npm run lint`
- `npm test` (cache concurrency/expiry/failures, HTTP concurrency, matching and units)
- `npm run typecheck`
- `npm run build`
- `npm run format:check`

Optional live read-only diagnostics:

- `node --env-file=.env.local scripts/probe.mjs` checks movie 148's hash mapping without printing credentials.
- Start production on port 3100 with `npm start -- --port 3100`, then `node --env-file=.env.local scripts/benchmark.mjs`. It measures complete HTML responses (not just streamed headers), cold/warm requests, matching and credential leakage. Set BENCH_URL to test another local port.

No database, Sonarr integration or media mutation endpoints are present.
