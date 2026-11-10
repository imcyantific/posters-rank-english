# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Stremio-style addon (Express, CommonJS, Node 22) that serves "Top 10 Today" catalogs from TMDB's daily trending list and an image service that draws posters and landscape art with `@napi-rs/canvas` (rank, status pill, title logo, provider icon, ratings). It is consumed by Xperience (catalog host with a "Custom URL" poster provider) and Nuvio (the player app). README.md is the user-facing guide and the reference for every env variable and endpoint.

## Commands

```bash
npm install
echo "TMDB_API_KEY=your_key" > .env      # v3 key or v4 Bearer token ("ey...")
node server.js                           # http://localhost:3000/manifest.json and /configure
node -c index.js                         # syntax check (there is no lint, build step or test suite)
```

There are no automated tests. Verify changes by running the server and fetching real output:

- An image: `curl -o out.jpg "localhost:3000/top10/portrait/<tmdbId>.jpg?type=movie&tmdb=<tmdbId>&ranks=all&debug=1"` (`landscape` for wide art). `debug=1` bypasses the disk cache and shows real error text.
- The catalog: `curl localhost:3000/catalog/series/top10_series.json`.
- With per-link options: prefix any path with `/c/<code>`, where the code comes from `node -e "console.log(require('./options').encode({pillStyle:'color'}))"`.
- Set `CACHE_DIR=<dir>` to exercise the disk cache and saved daily lists; leave it unset for a stateless run.
- IMDb and Rotten Tomatoes scores need `MDBLIST_API_KEY`. `MDBLIST_BASE` and `CINEMETA_URL` can point at a local stub.

## Two deployment modes

The same `index.js` runs in both, and code must work in each:

- **Vercel (serverless):** `vercel.json` runs `index.js` directly. Vercel's CDN is the image cache (via `Cache-Control: s-maxage`), and Vercel cron calls `/warm`. Instances share nothing, so the day's Top 10 is shared through the CDN-cached `/top10-list/<type>/<day>.json` route.
- **Self-hosted (Docker):** `server.js` starts the app and runs the daily warm-up timer. `CACHE_DIR` turns on `diskcache.js` (which emulates the CDN, keyed on `req.originalUrl`, honouring `s-maxage` and `stale-while-revalidate`) and stores the daily lists and `ratings.json` on disk.

## Architecture

**Per-request options (`options.js`).** Look settings live in `SCHEMA` (short key, env name, default, parser). `configMiddleware` strips a `/c/<code>/` URL prefix (base64url JSON of non-default options) and runs the request inside an `AsyncLocalStorage` store. Code reads settings only through `opt('name')`, and builds outgoing links with `prefix()`. Consequences:

- Option getters in `index.js` and `poster.js` are functions (`PILL_STYLE()`), never module-level constants, because the value differs per request.
- A `/c/<code>` link falls back to built-in defaults, not `.env`; plain links use `.env` values.
- Adding an option means: a `SCHEMA` entry, its use via `opt()`, a control in the `GROUPS` list in `configure.html`, and a README row. `configure.html` is a single static file; `/configure` injects `{host, options, keys, builtIn, ratingsKey}` at the `/*__DATA__*/null` marker, and the page encodes the settings code the same way `options.encode` does.

**One frozen Top 10 list per day (`index.js`).** `getDailyTop10` returns the same list all day (day boundary in `RANK_TZ`), so the catalog order and the rank numbers drawn into images always agree. The list name includes the `digitalOnly` option (`listName()`), so each setting has its own list and its own disk-cache copies of `/top10/` images.

**Two ways images are requested.**

- `/render-poster` and `/render-backdrop`: URLs the catalog itself emits. Rank, tag and `IMG_VERSION` are in the URL, so a URL's image never changes and is cached for a week.
- `/top10/:shape/:id.jpg`: the Custom URL template that apps fill in (`{shape}`, `{imdb_id}`, `{tmdb_id}`, `{type}`). The server works out the rank and tag itself, so ranked responses are cached only until midnight. `resolveTitle` accepts IMDb ids, `tmdb:` ids and a `tmdb=` hint.

**Rendering (`poster.js`).** `generatePoster` / `generateBackdrop` pick artwork, then `drawOverlays` draws the shared stack for both layouts in `LAYOUTS`. Artwork choice: prefer a textless ("No Language") image plus a drawn title logo; when there is no logo, use the image with its printed title and drop the genre/ratings line. Image ranking and filtering (`byBest`, `sharpFirst`, `rankLogos`, `POSTER_SKIP`) are in `tmdb.js`. The pill is drawn last because the frosted and glass styles read back the finished pixels.

**Catalog metas (`buildMeta` in `index.js`).** `CATALOG_ART` decides whether poster/background are plain TMDB images or the addon's rendered art. Two behaviours exist because of how client apps work:

- `meta.logo` is not sent when the background is rendered art (it already contains the logo, and Nuvio overlays `meta.logo` on landscape cards).
- `meta.id` is the IMDb id only when Cinemeta has a named record for it (`cinemetaKnows`); otherwise `tmdb:<id>`, because apps fail to open titles Cinemeta only half knows. `imdb_id` and `moviedb_id` are always sent so apps can fill Custom URL placeholders.

**Other modules.** `tags.js` decides the pill text from TMDB details (falls back to "Now Streaming"). `ratings.js` fetches IMDb/RT scores from MDBList with a per-title cache and a pause when the daily limit is hit. `/warm` pre-renders every Top 10 image, including the `WARM_CUSTOM_URL` variants.

## Conventions

- When a change alters how images look, bump `IMG_VERSION` in `index.js` so catalog image URLs change; self-hosters also clear `cache/images`.
- Failures must never be cached: `sendImage` sends `no-store` on a failed render, and `memo` (in `tmdb.js`) drops rejected promises.
- External lookups (MDBList, Cinemeta) are optional: on error or timeout, render without that data rather than failing the request.
- Comments and README text are written in plain language for a non-developer owner; keep that style, and update the README table when adding or changing an env variable.
- New files needed at runtime on Vercel must be added to `includeFiles` in `vercel.json`.
