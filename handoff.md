# Handoff

Last updated: 2026-11-15. Owner prefers plain, student-friendly explanations, wants the
reasoning behind each answer, and wants to be asked before anything is assumed.

## Current status
- `main` is at the merge of PR #48. PRs #43 to #48 (this session) are all merged; no open
  PRs, no unmerged work. `IMG_VERSION` is 47.
- Live server: https://posters.22111997.xyz (Oracle VPS, Docker, behind Cloudflare).
  Repo folder on the server is `~/stacks/posters`; `~/stacks/update.sh` pulls and rebuilds.
- Not confirmed: whether the owner has run `./update.sh` since PR #48, or done the
  Cloudflare steps under "Next steps".
- Owner's setup is in flux. Last known manifest link code decodes to: frosted pill, size
  0.9, "Top 1 Today", genre off, ratings top-right, region US, plain catalog art, hero logo
  on. They were testing the addon installed STRAIGHT into Nuvio (not through Xperience)
  with the red TOP badge and red pill, and want the Custom URL on `ranks=none`.
- Uses landscape on a Google TV and portrait on a phone, both Nuvio. The Top 10 catalog
  also feeds Nuvio's hero banner.

## What was added this session
- `CATALOG_ART=nologo`: ranked landscape art without the drawn logo (PR #43).
- `CATALOG_ART=cards`: ranked art in `poster` and in a separate `landscapePoster` field,
  plain `background` + `logo` for the hero (PR #48). Built from reading Nuvio's code;
  NOT yet tested in Nuvio.
- Disk cache fix (PR #45): saved pictures now report the time really left, each rank has
  its own saved copy, and nothing ranked is kept past midnight.
- `RANK_STYLE=badge` (red "TOP n" badge, icon moves top-right, ratings under the icon),
  `BADGE_PILL`, `PILL_STYLE=red` (red pill on every title), `RATING_BG=off`.
- Frosted glass rebuilt (real blur); ratings badge follows the pill style; top fade behind
  a colour pill at the top; streaming icon 15% bigger everywhere.
- Ratings line is now kept on posters with a printed title (owner's choice).

## Next steps
1. Ask how `CATALOG_ART=cards` looks in Nuvio Mobile and Nuvio TV: landscape cards should
   show the ranked art with one logo, the hero banner a clean backdrop + logo.
2. Ask whether the rank pills now change only at midnight NZ (the PR #45 fix). If a number
   still moves mid-day, get the time and the title.
3. Owner still to do in Cloudflare: purge the cache once, and set Browser Cache TTL to
   "Respect Existing Headers" (it was rewriting our 1 hour to 4 hours).
4. Still pending from before: test opening a brand-new show from the Top 10 row (PR #40).
5. Offered, not chosen: remove the `BADGE_PILL` toggle now that `PILL_STYLE=red` exists;
   apply the "only move when the top pill reaches it" rule to ratings in other rank
   styles; a `/status` page; "Top 10 this week"; rank movement arrows.

## Decisions made
- Baked-in catalog art is the only way order and rank numbers can never disagree. With the
  Custom URL (`ranks=all`) the pictures switch at midnight but Xperience fetches the order
  only hourly (`cacheMaxAge: 3600`, its minimum), so up to ~1 hour of mismatch remains.
- Do NOT refresh the list more than once a day: every list change is a mismatch window.
- Keep IMDb ids as the default `meta.id`; `tmdb:<id>` only when Cinemeta has no named
  record. Do not switch shows to TVDB ids without an owner test.
- Do not send `meta.logo` when the background is rendered art with a drawn logo.
- Default pill label is "Now Streaming". Never leave a title without a pill.
- Logos keep their original colours; only plain black/grey logos are lightened.
- Look settings live in `/c/<code>/` links (nothing is stored on the server); `.env` keeps
  only server settings. A new setting = a new link code, so no `v=` bump. A server-side
  look change with the same code needs `v=` raised (or `cache/images` cleared).
- Never delete `cache/lists` mid-day (it re-freezes the day's list). `cache/images` is
  always safe to clear.
- Never ask the owner to paste secrets. PRs only when asked; the owner merges them.
  Push only to the session's designated branch.

## Known issues / facts learned
- Nuvio (both apps) obeys the picture's cache time. Nuvio TV shows the old picture, then
  re-checks using the ETag and swaps it; it refreshes home rows after 15 minutes.
- Nuvio's hero banner uses the logo that comes with the catalog item and never picks one
  itself. Landscape cards use `landscapePoster` if present (no logo overlay), unless
  Nuvio's "always show logo on landscape cards" option is on.
- Xperience replaces the logo our catalog sends: Never Surrender (tt39370926) showed the
  Indonesian logo in the hero though we send the English one. No Xperience setting for it;
  a support message was drafted for the owner. Unknown if Xperience passes
  `landscapePoster` through.
- TMDB's data feed can lag the website by up to a day (Alicia's Law English poster).
  After that the server notices within 30 minutes; saved pictures follow later.
- Titles with no IMDb id get a plain TMDB poster in Xperience (it needs `{imdb_id}`).
- Wrong logos/posters on titles with few TMDB votes: fix the label on TMDB, or add the
  file to `POSTER_SKIP` for an instant fix.
- MDBList only accepts its key in the URL, so test it with a local stub (`MDBLIST_BASE`).
- This cloud environment can reach api.themoviedb.org, image.tmdb.org and the live
  server, but not www.themoviedb.org. Public repos NuvioMedia/NuvioTV and
  NuvioMedia/NuvioMobile can be cloned read-only to check app behaviour.
