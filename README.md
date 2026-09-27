# Arr Lifecycle

Read-only Next.js App Router application for Radarr movies, two Sonarr libraries and related qBittorrent torrents.

## Run

Install with `npm ci`. Copy `.env.example` to `.env.local` and configure the service URLs and credentials. Secrets are server-only; never use NEXT_PUBLIC variables.

- Development: `npm run dev`
- Production locally: `npm run build`, then `npm start`
- Movies: http://localhost:3000/movies

Leave both qBittorrent credentials empty only when the server already permits this client's unauthenticated access. Otherwise set both. This app does not configure service authentication.

## Data flow and performance

The searchable movie list renders 24 movies per page. File/monitoring filters and title/year/size sorting apply before pagination. Torrent-match filters apply to the entire filtered library, using complete paginated history (up to 20,000 records, bounded lookup time). Partial history is never accepted as proof. Without a match filter, only the visible movie IDs need history; details fetch the selected movie's history. Movie/status/torrent reads run concurrently. Upstream errors are shown as unavailable, not as absence of torrents. Filters persist in pagination URLs and reset pagination when applied.

Refresh data invalidates only this process's media read cache (including detail reads), preserves authentication sessions, and refreshes the current route without changing filters. It does not modify Radarr or qBittorrent. The displayed UTC timestamp is the oldest unexpired media read in the process cache, not a claim that all APIs were read atomically. No automatic browser polling is performed. Like the rest of this unauthenticated internal app, refresh must not be exposed publicly.

A process-local cache stores successful reads for 30 seconds (version: 60 seconds, authenticated session: 20 minutes). Keys include service and credential identity, hashed in memory. Concurrent identical reads share a promise. The cache is capped at 512 entries, survives development module reloads, and resets on process restart. Each server process has its own cache. Expired data is not silently used as current data. Large payloads bypass the Next.js Data Cache.

External work is limited to six concurrent requests per process. Network reads have a five-second timeout; queue waiting is also limited to five seconds. Authenticated qBittorrent sessions renew once after a 403. A slow history sequence is bounded and reports incomplete lookup rather than treating partial history as proof. A whole page may take longer than a single request timeout.

Loading boundaries stream a loading state immediately. Use production mode for representative timing; development compilation adds latency.

## Matching and preview

Both routes use the same matcher. Radarr history's top-level downloadId is compared to torrent hashes, scoped strictly to the movie ID. Exactly one hash match in MoviesRR is required for the **Hash match verified** label. Multiple matches are ambiguous; other categories are blocked. Title/year candidates are labelled explicitly and remain blocked.

The details/modal displays whitelisted evidence: history record ID, movie ID, event type, date, hash and its source field (`downloadId`, or legacy `data.downloadId` / `data.hash`). Exact matches and title/year candidates are listed separately; ambiguous matches never automatically select a torrent. Incomplete API lookups cannot receive a verified label. No additional API calls are needed to render evidence.

History API reference: https://github.com/Radarr/Radarr/blob/develop/src/Radarr.Api.V3/History/HistoryResource.cs

The delete preview has no executable deletion control and never claims **SAFE TO DELETE**. Hash verification is based on cached API evidence only; it does not verify hardlinks, filesystem ownership, or current deletion safety. Any future execution feature must fetch fresh evidence and perform filesystem checks separately.

## Verification

- `npm run lint`
- `npm test` (cache concurrency/expiry/failures, HTTP concurrency, matching and units)
- `npm run typecheck`
- `npm run build`
- `npm run format:check`

Optional live read-only diagnostics:

- `node --env-file=.env.local scripts/probe.mjs` checks movie 148's hash mapping without printing credentials.
- Run `node --env-file=.env.local scripts/benchmark.mjs` against the existing production server on port 3000. It measures complete HTML responses (not just streamed headers), cold/warm requests, matching and credential leakage. Set BENCH_URL to test another local port.
- `node scripts/check-modal.mjs` and `node scripts/check-filters.mjs` run read-only live Chrome checks (require local Chrome and a populated library; modal test uses movie 148, filter test expects more than 24 matched movies).

## Sonarr TV and anime

Movies, TV and anime share the same server-rendered `MediaCard` layout. Thin adapters supply the labels and routes. Series file badges use `episodeFileCount` versus `totalEpisodeCount` (including specials/future episodes), never the monitored-only `episodeCount`. Missing or inconsistent statistics cannot produce a Complete badge. Series torrent status remains Not checked on the list (or Matching unavailable when qBittorrent fails); opening the modal performs the separate episode-level lookup. No extra per-card API requests are introduced.

`/shows` combines two independent libraries. Set `SONARR_URL` / `SONARR_API_KEY` for TV, and `SONARR_ANIME_URL` / `SONARR_ANIME_API_KEY` for anime in `.env.local`. Set `SONARR_QBIT_CATEGORY` and `SONARR_ANIME_QBIT_CATEGORY` to the exact respective qBittorrent category names. Categories have no guessed defaults: a missing or different category prevents verified matching but does not hide the library. All configuration and API requests remain server-side.

GET-only endpoints per instance:

- `/api/v3/system/status`
- `/api/v3/series` and `/api/v3/series/{id}`
- `/api/v3/episode?seriesId={id}`
- `/api/v3/episodefile?seriesId={id}`
- `/api/v3/history/series?seriesId={id}`

Endpoint and history field definitions were checked against the [Sonarr API schema](https://github.com/Sonarr/Sonarr/blob/develop/src/Sonarr.Api.V3/openapi.json) and [history controller](https://github.com/Sonarr/Sonarr/blob/develop/src/Sonarr.Api.V3/History/HistoryController.cs).

List queries do not fetch history for every show. Opening a card loads the selected series, episodes, files, history and cached torrents concurrently, using the existing 30-second read cache and bounded request pool. Cache identity and routes include the Sonarr instance (`tv:7` and `anime:7` are different entities). Each unavailable instance is reported independently. Public HTTPS TMDB and TVDB artwork is allowlisted (TVDB: artworks.thetvdb.com/banners); URL queries/fragments are stripped. Other image hosts use a placeholder, never a credential-bearing service URL.

Matching uses the selected instance's history, scoped by series and episode ID. Only valid 40/64-character hexadecimal `downloadId` values are compared to torrent hashes. No title/path matching is used for shows. One series can legitimately have multiple torrents; multiple current torrent matches for one episode are ambiguous. Shared hashes list all history-linked episode IDs and warn about multi-episode scope. This does **not** prove complete season-pack contents, current-file provenance, cross-series ownership or hardlink safety. All deletion remains disabled.

`node scripts/check-sonarr.mjs` runs a production-build browser test with local fake Sonarr/qBittorrent APIs, no real service access. It temporarily uses port 3101 (override with SONARR_TEST_PORT), closes its own processes, and tests instance isolation, modal/direct navigation, shared hashes, outages, mobile layout, secret leakage and GET-only upstream traffic. Requires a completed build and local Chrome. Actual Sonarr connections must be checked separately with the user's configured credentials.

No database or media mutation endpoints are present.
