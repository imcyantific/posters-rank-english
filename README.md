# posters-rank-english

A Stremio-style addon that gives you **Top 10 Movies Today** and **Top 10 TV Shows Today**
catalogs (from TMDB's daily trending list), plus a **poster image service** that draws:

- the **rank number** (1–10)
- a frosted **status pill**: *Now Streaming*, *Just Added*, *In Theaters*, *New Episode*,
  *New Season*, *Premiere*, *Finale*, *Coming Oct 24* …
- the **streaming provider icon** (Netflix, Disney+, Prime Video …)
- **genre + rating** (e.g. `Animation • ★ 8.2`)
- the **title logo** on a textless poster, for a clean look

It runs on **Vercel** and is made to be used with **Xperience** (which hosts the
catalogs) and **Nuvio** (the app you watch in).

---

## 1. Deploy

1. Fork / clone this repo and import it into [Vercel](https://vercel.com).
2. Add the environment variables below (Settings → Environment Variables).
3. Deploy. Your addon lives at `https://YOUR-APP.vercel.app/manifest.json`.

> Vercel only reads environment variables when it builds, so **redeploy after
> changing any variable** (Deployments → ⋯ → Redeploy).

### Required variables

Tick **Production** only. Preview/Development are not needed.

| Variable | What to put |
|---|---|
| `TMDB_API_KEY` | Your TMDB key. Either the short **API Key** or the long **Read Access Token** (starts with `ey`) works. |
| `HOST_URL` | Your Vercel address, e.g. `https://posters-rank-english-pi.vercel.app` (no `/` at the end). Used to build image links. |

### Recommended variables

| Variable | Value | Why |
|---|---|---|
| `CATALOG_ART` | `poster` | Bakes the rank into the Top 10 posters so numbers always match the row order (see [Rank numbers](#4-rank-numbers-why-baked-in)). |
| `CRON_SECRET` | any long random text | Protects the daily `/warm` job so only Vercel can run it. |
| `WARM_CUSTOM_URL` | your Xperience Custom URL, **exactly** | Pre-renders the Custom URL images every day so they load fast. |

You do **not** need `PORT`. That's only for running locally.

---

## 2. Use it in Xperience + Nuvio

### Add the catalogs
In Xperience, add the addon with your manifest URL:
```
https://YOUR-APP.vercel.app/manifest.json
```
Then add **Top 10 Movies Today** / **Top 10 TV Shows Today** as rows.

### Custom URL poster provider (for your other catalogs)
In Xperience → poster settings → **Custom URL**, paste:
```
https://YOUR-APP.vercel.app/top10/{shape}/{imdb_id}.jpg?type={type}&tmdb={tmdb_id}&ranks=none&v=1
```
Every poster in your other rows then gets the pill, provider icon, genre/rating and logo.
`{shape}` makes it work in both **Portrait** and **Landscape**.

| Query option | Values | Meaning |
|---|---|---|
| `ranks` | `none` (recommended) | No rank numbers (use this; the Top 10 rows already have them baked in) |
| | `landscape` (default) | Rank numbers only on landscape art |
| | `all` | Rank numbers on everything that's in today's Top 10 |
| `v` | any number | Cache buster. **Change it whenever you want apps to fetch fresh images.** |
| `debug` | `1` | Shows the real error text instead of a broken image (for testing in a browser) |

### Using it directly in Nuvio (instead of Xperience)
Nuvio has its own **Custom Poster Source** (Profile → Poster Card Style). It needs a
slightly different URL:
```
https://YOUR-APP.vercel.app/top10/{shape}/{imdb_id|tmdb_id}.jpg?type={type}&ranks=none&v=1
```
Why: in Nuvio, `{tmdb_id}` is only filled for titles whose ID starts with `tmdb:`. Most
catalogs use IMDb IDs (`tt…`), so the Xperience URL leaves `{tmdb_id}` empty and Nuvio
falls back to the plain poster. `{imdb_id|tmdb_id}` means "use whichever ID the title has".
Titles with neither (e.g. `kitsu:` anime IDs) keep their normal poster.

### After any change: the refresh routine
Apps remember images by their URL, so after a design or settings change:

1. Bump `&v=` by one, using the same number in **both** the Xperience Custom URL and `WARM_CUSTOM_URL`.
2. In Xperience, press **Re-sync** on the addon.
3. In Nuvio, close the app from recent apps and open it again.

(The Top 10 catalog posters refresh by themselves, because the code bumps its own
`IMG_VERSION` whenever the design changes.)

---

## 3. All settings

All optional. Leave a variable out to get the default.

### Catalog
| Variable | Default | Options |
|---|---|---|
| `CATALOG_ART` | `plain` | `plain`: normal TMDB poster + backdrop · `poster`: rank baked into the poster, backdrop stays clean for the hero banner · `ranked`: rank baked into both poster and backdrop |
| `META_LOGO` | `on` | `off` stops sending the title logo for the hero banner |
| `RANK_TZ` | `Pacific/Auckland` | Time zone whose midnight starts a new Top 10 day |
| `DIGITAL_ONLY` | `off` | `on` = movie Top 10 skips titles that are only in cinemas (no digital release yet) |
| `DIGITAL_REGION` | *(any country)* | e.g. `NZ` or `US`: country used for the digital-release check |

### Poster look
| Variable | Default | Options |
|---|---|---|
| `RANK_STYLE` | `pill` | `pill`: Top 10 rank shown in the pill as **Top 1 Today** (no side number) · `number`: big rank number on the side + normal status pill |
| `POSTER_STYLE` | `logo` | `logo`: textless poster + drawn title logo, only on ranked Top 10 posters · `always`: on every poster · `original`: never, always the normal poster |
| `PILL_POSITION` | `bottom` | `top` moves the status pill to the top of portrait posters |
| `LANDSCAPE_PILL_POSITION` | same as `PILL_POSITION` | `top` / `bottom` for landscape images |
| `PILL_SIZE` | `0.8` | Pill size: `1` = big (old size), `0.7` = smaller. Range 0.5–1.5 |
| `POSTER_INFO` | `on` | `off` hides the provider icon **and** genre/rating |
| `POSTER_SKIP` | *(empty)* | TMDB images to never use, comma-separated, e.g. `/b5Z2OHgLWYq84YaYeJTBdXILaIx.jpg` (also accepts the full image link). Clear the image cache after changing it |
| `POSTER_META` | `on` | `off` hides only the genre/rating line (provider icon stays) |
| `META_CHIP` | `off` | `on` puts the genre/rating on a dark rounded background |
| `PROVIDER_REGION` | `NZ` | Whose streaming services to show (`US`, `AU` …). Falls back to US, then any country |

### Speed / caching
| Variable | Default | Meaning |
|---|---|---|
| `CRON_SECRET` | *(none)* | Required by `/warm` when set. Vercel sends it automatically |
| `WARM_CUSTOM_URL` | *(none)* | Your Custom URL, identical to Xperience's (including `v=`), so the daily warm-up pre-renders those images too |
| `CUSTOM_CACHE_DAYS` | `2` | How long Vercel keeps Custom URL images (without rank numbers) before re-drawing them (1–7). Higher = less Vercel usage; pills like *New Episode* update a bit later |
| `IMAGE_QUALITY` | `high` | `high`: landscape 1920×1080, JPEG 92 · `balanced`: landscape 1280×720, JPEG 85 (about 3× smaller files; use it if Vercel usage gets close to the limit) |
| `JPEG_QUALITY` | *(from `IMAGE_QUALITY`)* | Override the JPEG quality (60–95). Lower = smaller files and less Vercel usage |

---

## 4. Rank numbers: why baked in?

TMDB's trending list changes during the day, so the addon **freezes one list per day**
(it switches at midnight in `RANK_TZ`).

There are two ways to show rank numbers:

- **Baked in (`CATALOG_ART=poster`), recommended.** Each poster's link contains its
  rank, so a title that moves from #3 to #7 gets a brand-new link, and the image always
  arrives together with the new row order. Numbers and order can't drift apart.
- **Custom URL with `ranks=all`.** The link for a title is the same every day, so Nuvio/Xperience
  may keep showing yesterday's cached "3" after it moved to #7 (duplicate or jumbled
  numbers). Fine to experiment with, but not reliable.

Xperience re-syncs your catalogs about once an hour (the addon tells it to with
`cacheMaxAge: 3600`), so in the first hour after midnight the row can still show
yesterday's list. Re-sync manually if you want it straight away.

---

## 5. Daily warm-up (speed)

`vercel.json` runs two Vercel Cron jobs every day, shortly after the list switches at
midnight NZ time (00:10 in winter, 01:10 during daylight saving):

```
/warm?type=movie    12:10 UTC
/warm?type=series   12:20 UTC
```

They request every Top 10 image once (catalog posters + your `WARM_CUSTOM_URL` portrait
and landscape versions), so Vercel's CDN already has them when you open the app.
On the Vercel Hobby plan crons run once a day and may run up to an hour late.

The server region is `syd1` (Sydney), the closest to New Zealand.

---

### Vercel free plan usage
The Hobby plan includes **10 GB of Fast Origin Transfer** over a **rolling 30 days**
(each day's usage counts for 30 days, then drops off). Every *newly drawn* image counts;
images served from Vercel's cache don't. To stay under it:
- avoid unnecessary redeploys and `v=` bumps (each one redraws everything),
- use the Custom URL in only one app (Xperience **or** Nuvio),
- set `IMAGE_QUALITY=balanced`, raise `CUSTOM_CACHE_DAYS` or lower `JPEG_QUALITY` if you get close.

## 6. Endpoints

| URL | What it is |
|---|---|
| `/manifest.json` | Addon manifest |
| `/catalog/movie/top10_movies.json` · `/catalog/series/top10_series.json` | The Top 10 catalogs |
| `/top10/{portrait\|landscape}/{imdb or tmdb id}.jpg?type=…&tmdb=…&ranks=…&v=…` | Custom URL poster provider |
| `/render-poster?type=…&tmdbId=…&rank=…&tag=…` | Portrait art used by the catalog (`CATALOG_ART`) |
| `/render-backdrop?type=…&tmdbId=…&rank=…&tag=…` | Landscape art used by the catalog |
| `/poster/{id}.jpg` | Older poster endpoint (pill only, no rank) |
| `/top10-list/{movie\|tv}/{YYYY-MM-DD}.json` | Today's frozen Top 10 list |
| `/warm?type=movie\|series` | Daily warm-up (run by Vercel Cron) |

---

## 7. Troubleshooting

| Problem | Fix |
|---|---|
| Xperience **Verify** says `Custom URL: HTTP 500` | Open the URL in a browser with `&debug=1` added to see the real error. Check Vercel → Logs. |
| Numbers out of order / duplicated | Use `CATALOG_ART=poster` with `ranks=none`, then **Re-sync** in Xperience and reopen Nuvio. |
| Changed a setting but nothing looks different | Redeploy on Vercel, bump `&v=`, Re-sync, reopen Nuvio (see [refresh routine](#after-any-change-the-refresh-routine)). |
| Some posters have a foreign (e.g. Russian) title under the logo | TMDB tagged that poster as "textless" by mistake. Fix its language on themoviedb.org (can take up to a day to reach apps), and add it to `POSTER_SKIP` for an instant fix. Or use `POSTER_STYLE=logo` (textless art only on ranked posters) or `original`. |
| Foreign film / anime poster has no title | It uses the original-language poster when there's no English one. If TMDB has none with a title, there's nothing better to show. |
| Images load slowly the first time | Set `CRON_SECRET` + `WARM_CUSTOM_URL` so the daily warm-up pre-renders them. |

---

## 8. Self-host on your own server (e.g. Oracle Cloud free tier)

Vercel's free plan only allows **10 GB of freshly drawn images per 30 days**. A VPS like
Oracle's Always Free **A1 (ARM)** has far more outgoing data, so you can keep the highest
image quality. Everything works the same; three things Vercel did are built in instead:

| On Vercel | On your server |
|---|---|
| Vercel's CDN keeps finished images | **Disk cache** in `CACHE_DIR` (same keep-for times) |
| Vercel Cron runs the warm-up | `server.js` runs it daily at `WARM_AT` (default `00:10` in `RANK_TZ`) |
| CDN shares one Top 10 list per day | The day's list is saved to disk (survives restarts) |

### Steps (Docker)
1. On the server:
   ```bash
   git clone https://github.com/imcyantific/posters-rank-english.git
   cd posters-rank-english
   nano .env
   ```
   Put your settings in `.env`, one per line, for example:
   ```
   TMDB_API_KEY=your_key
   HOST_URL=https://posters.your-domain.com
   CATALOG_ART=poster
   CRON_SECRET=some-long-random-text
   WARM_CUSTOM_URL=https://posters.your-domain.com/top10/poster/{imdb_id}.jpg?type={type}&tmdb={tmdb_id}&ranks=none&v=1
   ```
2. Start it:
   ```bash
   docker compose up -d --build
   ```
   It listens on `127.0.0.1:3010` (only reachable from the server itself).
3. Give it an HTTPS address with the reverse proxy you already use for AIOStreams.
   Point a (sub)domain's DNS at the server, then e.g. for **Caddy** add to your Caddyfile:
   ```
   posters.your-domain.com {
       reverse_proxy 127.0.0.1:3010
   }
   ```
   (If your proxy runs inside Docker, put both containers on the same Docker network and
   use `posters-rank-english:3000` as the target instead of `127.0.0.1:3010`.)
4. Check `https://posters.your-domain.com/manifest.json` opens in a browser.
5. In Xperience: add the new manifest URL (and remove the Vercel one), and change the
   Custom URL to the new domain. Keep `WARM_CUSTOM_URL` identical to it.

### Updating
```bash
git pull && docker compose up -d --build
```
The disk cache is kept (in `./cache`), so nothing is redrawn after an update. That also
means: after a **design** change, bump `&v=` in the Custom URL (and `WARM_CUSTOM_URL`)
so those images are drawn again. The Top 10 catalog posters refresh by themselves.

### Extra settings (self-host only)
| Variable | Default | Meaning |
|---|---|---|
| `CACHE_DIR` | `/cache` in Docker | Where images and the daily list are saved. Unset = no disk cache |
| `CACHE_MAX_GB` | `2` | Most disk space the image cache may use. When it's full, the images closest to expiring are deleted first |
| `PORT` | `3000` | Port inside the container |
| `WARM_AT` | `00:10` | Time (in `RANK_TZ`) for the daily warm-up; `off` to disable |

Expired images are deleted from disk automatically every hour, and the cache is trimmed back under `CACHE_MAX_GB` every hour.

## 9. Run locally

```bash
npm install
echo "TMDB_API_KEY=your_key" > .env
node server.js            # http://localhost:3000/manifest.json
```

## For developers

- `index.js`: Express app: catalogs, daily list, image routes, warm-up.
- `poster.js`: drawing with `@napi-rs/canvas` (layouts, pill, rank, logo, provider icon, genre/rating).
- `tags.js`: decides the pill text from TMDB details.
- `server.js`: starts the app as a normal server (Docker/VPS) and runs the daily warm-up.
- `diskcache.js`: disk cache for images when self-hosting (`CACHE_DIR`).
- `tmdb.js`: shared TMDB helpers: API calls (connections kept open), image downloads with time limits, a small in-memory cache, and the "best image" sorting.
- When you change how images look, bump `IMG_VERSION` in `index.js`.
