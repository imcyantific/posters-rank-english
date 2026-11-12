# Handoff

Last updated: 2026-11-12. Owner prefers plain, student-friendly explanations.

## Current status
- `main` is at the merge of PR #41. PRs #35 to #41 are all merged; no open PRs, no unmerged work.
- Live server: https://posters.22111997.xyz (Oracle VPS, Docker, behind Cloudflare).
  - Repo folder on the server is `~/stacks/posters` (compose file renamed locally to `compose.yaml`).
  - `~/stacks/update.sh` now does `git pull` + rebuild for posters.
  - `MDBLIST_API_KEY` is set on the server (IMDb / RT scores show).
- Not confirmed: whether the owner has run `./update.sh` since PR #40 was merged, so the
  "Failed to load" fix may not be live yet.
- Owner's setup:
  - Xperience: addon imported from a `/c/<code>/manifest.json` link, Poster art = **Provider**,
    Custom URL = `/c/<code>/top10/{shape}/{imdb_id}.jpg?type={type}&tmdb={tmdb_id}&ranks=all&v=1`.
  - Look: liquid glass pill, size 1, "#1 Today", genre off, ratings in the top-right badge.
  - Uses landscape on a Google TV and portrait on a phone, both through Nuvio.
  - `WARM_CUSTOM_URL` in `.env` should always be the same link as the Custom URL.

## Next steps
1. Ask the owner to test PR #40 after updating: open a brand-new show from the Top 10 row
   (the original case was "One of a Kind Romance"). Check the page loads, episodes show
   streams, and the poster keeps its pill.
2. If that title's poster goes plain in Xperience: try sending a stand-in value in the
   `imdb_id` field for titles sent with a `tmdb:` id (untested idea; needs an owner test).
3. Bump `IMG_VERSION` (still 40) in the next change; it was not raised for the colour pill
   and ratings-line changes.
4. Offered, not yet chosen by the owner:
   - automatic wrong-logo / wrong-poster check with Claude vision (needs an Anthropic API key);
   - a `/status` page (cache size, today's lists, MDBList lookups left, last warm-up);
   - "Top 10 this week" row; rank movement arrows; Cloudflare auto-purge;
   - a drawn text title when a title has no logo;
   - a "Show IDs" option on /configure (IMDb / TMDB / TVDB) to test TVDB ids.

## Decisions made
- Keep IMDb ids as the default `meta.id`; use `tmdb:<id>` only when Cinemeta has no named
  record. Reason: streams, watch history and Xperience's Custom URL all rely on IMDb ids.
  Do not switch shows to TVDB ids without an owner test.
- Do not send `meta.logo` when the background is rendered art (Nuvio drew the logo twice).
- Xperience uses Poster art = Provider + Custom URL. With "Original", Xperience adds its
  own logo on top of rendered landscape art.
- Default pill label is "Now Streaming". Removed for good: year + running time,
  "N Seasons", "Rent or Buy". Never leave a title without a pill.
- Logos: keep the original colours (Resident Evil red, Gachiakuta black + red outline);
  only plain black/grey logos are lightened.
- Pill at the bottom; ratings only (no genre) for the owner's own setup.
- `DIGITAL_ONLY` is a per-link option on /configure, with its own daily list per setting.
- Look settings live in `/c/<code>/` links; the owner's `.env` keeps only server settings
  (`TMDB_API_KEY`, `HOST_URL`, `CRON_SECRET`, `WARM_CUSTOM_URL`, `MDBLIST_API_KEY`).
- The `v=` number only needs raising when the picture changes but the settings code does
  not (server update, TMDB fix, `POSTER_SKIP` change).
- Never ask the owner to paste secrets. PRs only when asked. Push only to the session's
  designated branch; no force-push without permission.

## Known issues
- Titles with **no IMDb id at all** (e.g. "The Silent Storm") get a plain TMDB poster in
  Xperience: it requires `{imdb_id}` in the Custom URL and skips titles without one.
  Fixes itself once TMDB lists an IMDb id.
- Xperience may not know the TMDB number of a brand-new title, so `tmdb:{tmdb_id}` in the
  Custom URL path was worse than `{imdb_id}`. Keep `{imdb_id}` in the path.
- Wrong logos / posters on titles with few TMDB votes (mislabelled "No Language" images).
  Manual fix: `POSTER_SKIP` in `.env`, or correct the label on TMDB.
- MDBList only accepts its key in the URL (`?apikey=`), so it can't be tested through the
  cloud environment's secure credential form; use a local stub (`MDBLIST_BASE`).
- This cloud environment can reach api.themoviedb.org and image.tmdb.org, but not
  www.themoviedb.org.
- After a look change: clear `cache/images`, purge Cloudflare, Re-sync Xperience.
