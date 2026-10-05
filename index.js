require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { generatePoster, generateBackdrop } = require('./poster');
const { determineTag } = require('./tags');

const app = express();
app.use(cors());

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const HOST_URL = process.env.HOST_URL || `http://localhost:${process.env.PORT || 3000}`;

// Bump this whenever you redesign the images, so apps fetch fresh copies.
const IMG_VERSION = 23;

// true  = use the IMDb id (tt1234567) when TMDB knows it, like Cinemeta does.
// false = always use tmdb:<id>.
const USE_IMDB_IDS = true;

// CATALOG_ART decides what images the Top 10 catalogs send:
//   plain  (default) -> normal TMDB poster + backdrop, like Xperience's own catalogs.
//                       Xperience's Custom URL provider then swaps in our /top10/... art
//                       (with ranks=all) in both Portrait and Landscape.
//   ranked           -> our own rendered art (rank + pill) baked into the catalog.
//                       Use this in apps that have no Custom URL provider (e.g. Stremio).
const RANKED_ART = String(process.env.CATALOG_ART || 'plain').toLowerCase() === 'ranked';

// Set META_LOGO=off in Vercel to stop sending the "logo" field.
const SEND_LOGO = String(process.env.META_LOGO || 'on').toLowerCase() !== 'off';

const tmdb = {
  headers: TMDB_API_KEY.startsWith('ey') ? { Authorization: `Bearer ${TMDB_API_KEY}` } : {},
  params: TMDB_API_KEY.startsWith('ey') ? {} : { api_key: TMDB_API_KEY }
};

async function fetchDetails(tmdbType, tmdbId) {
  const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${tmdbId}`, {
    headers: tmdb.headers,
    params: { ...tmdb.params, append_to_response: 'external_ids,images', include_image_language: 'en,null' }
  });
  return data;
}

// ---------- One shared Top 10 list per day ----------
// TMDB's "trending/day" list changes during the day. If the catalog and the rank
// numbers each asked TMDB at different times, the ranks came out of order.
// So we freeze one list per calendar day: it is served from /top10-list/<type>/<day>.json,
// which Vercel's CDN caches for the day, and both the catalog and the ranks read it.
const RANK_TZ = process.env.RANK_TZ || 'Pacific/Auckland';
const dayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: RANK_TZ }); // YYYY-MM-DD

// Seconds left until the list switches at midnight, so nothing is cached past the switch.
function secondsUntilMidnight() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: RANK_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(p => [p.type, Number(p.value)]));
  const left = 86400 - (parts.hour * 3600 + parts.minute * 60 + parts.second);
  return Math.max(60, left);
}

// DIGITAL_ONLY=on in Vercel -> the movie Top 10 skips titles without a digital release yet
// (still only in cinemas). Uses TMDB release type 4 = Digital, already released.
// DIGITAL_REGION (e.g. NZ or US) limits the check to one country; empty = any country.
const DIGITAL_ONLY = String(process.env.DIGITAL_ONLY || 'off').toLowerCase() === 'on';
const DIGITAL_REGION = String(process.env.DIGITAL_REGION || '').toUpperCase();

async function hasDigitalRelease(movieId) {
  try {
    const { data } = await axios.get(`https://api.themoviedb.org/3/movie/${movieId}/release_dates`, {
      headers: tmdb.headers,
      params: tmdb.params
    });
    const now = Date.now();
    return (data.results || [])
      .filter(c => !DIGITAL_REGION || c.iso_3166_1 === DIGITAL_REGION)
      .some(c => (c.release_dates || []).some(r => r.type === 4 && Date.parse(r.release_date) <= now));
  } catch (e) {
    console.error(`Release dates failed for ${movieId}:`, e.message);
    return false;
  }
}

async function fetchTrendingFromTmdb(tmdbType) {
  const getPage = async page => (await axios.get(`https://api.themoviedb.org/3/trending/${tmdbType}/day`, {
    headers: tmdb.headers,
    params: { ...tmdb.params, page }
  })).data.results || [];

  if (!(DIGITAL_ONLY && tmdbType === 'movie')) return (await getPage(1)).slice(0, 10);

  // Walk down the trending list (up to 5 pages = 100 titles), keeping trending order
  const picked = [];
  for (let page = 1; page <= 5 && picked.length < 10; page++) {
    const results = await getPage(page);
    if (!results.length) break;
    const ok = await Promise.all(results.map(m => hasDigitalRelease(m.id)));
    results.forEach((m, i) => { if (ok[i] && picked.length < 10) picked.push(m); });
  }
  return picked;
}

const dailyCache = {}; // `${tmdbType}:${day}` -> items

async function getDailyTop10(tmdbType) {
  const key = `${tmdbType}:${dayKey()}`;
  if (dailyCache[key]) return dailyCache[key];
  let items;
  try {
    // Goes through Vercel's CDN, so every server instance gets the same frozen list
    const { data } = await axios.get(`${HOST_URL}/top10-list/${tmdbType}/${dayKey()}.json`, { timeout: 8000 });
    items = data.items;
  } catch (e) {
    // Don't keep this copy: other instances may get a different list from TMDB,
    // so try the shared list again on the next request.
    console.error('Shared top 10 list failed, asking TMDB directly:', e.message);
    return fetchTrendingFromTmdb(tmdbType);
  }
  dailyCache[key] = items;
  return items;
}

app.get('/top10-list/:type/:day.json', async (req, res) => {
  const { type, day } = req.params;
  if ((type !== 'movie' && type !== 'tv') || day !== dayKey()) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(404).json({ items: [] });
  }
  try {
    const items = await fetchTrendingFromTmdb(type);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400');
    res.json({ day, items });
  } catch (err) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(500).json({ items: [] });
  }
});

// ---------- Metadata for the hero banner (type • genre • year) ----------
function yearOf(dateStr) {
  return dateStr ? String(dateStr).slice(0, 4) : '';
}

// "2023-" for running shows, "2011-2014" for ended ones, "2024" for movies
function buildReleaseInfo(details, tmdbType) {
  const start = yearOf(details.release_date || details.first_air_date);
  if (!start) return '';
  if (tmdbType !== 'tv') return start;
  const ended = details.status === 'Ended' || details.status === 'Canceled';
  const end = yearOf(details.last_air_date);
  if (ended && end && end !== start) return `${start}-${end}`;
  if (ended) return start;
  return `${start}-`;
}

// Best English title logo from TMDB (most votes first), falling back to any language.
function pickLogo(details) {
  const logos = (details.images?.logos || []).filter(l => l.file_path && !l.file_path.endsWith('.svg'));
  const byVotes = (a, b) => (b.vote_average || 0) - (a.vote_average || 0);
  const en = logos.filter(l => l.iso_639_1 === 'en').sort(byVotes);
  const any = logos.filter(l => !l.iso_639_1).sort(byVotes);
  const best = en[0] || any[0];
  return best ? `https://image.tmdb.org/t/p/w500${best.file_path}` : undefined;
}

async function buildMeta(item, index, type, tmdbType) {
  let details = item; // fallback if the details call fails
  try {
    details = await fetchDetails(tmdbType, item.id);
  } catch (e) {
    console.error(`Details failed for ${item.id}:`, e.message);
  }

  const tag = determineTag(details, tmdbType);
  const imdbId = details.external_ids?.imdb_id || details.imdb_id;
  const genres = (details.genres || []).map(g => g.name);
  const year = yearOf(details.release_date || details.first_air_date);

  const query = `type=${tmdbType}&tmdbId=${item.id}&rank=${index + 1}&tag=${encodeURIComponent(tag)}&v=${IMG_VERSION}`;
  const meta = {
    id: USE_IMDB_IDS && imdbId ? imdbId : `tmdb:${item.id}`,
    type,
    // Separate ids like Cinemeta sends, so apps can fill {imdb_id} / {tmdb_id} in custom poster URLs
    imdb_id: imdbId || undefined,
    moviedb_id: item.id,
    name: item.title || item.name,
    poster: RANKED_ART || !details.poster_path
      ? `${HOST_URL}/render-poster?${query}`
      : `https://image.tmdb.org/t/p/w780${details.poster_path}`,
    posterShape: 'poster',
    genres,
    genre: genres, // older Stremio field; some apps (Nuvio hero) read this one
    // Newer Stremio-style genre list (some apps read this instead of "genres")
    links: genres.map(g => ({ name: g, category: 'Genres', url: `stremio:///search?search=${encodeURIComponent(g)}` })),
    releaseInfo: buildReleaseInfo(details, tmdbType),
    year,
    released: details.release_date || details.first_air_date || undefined,
    description: details.overview || item.overview || '',
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined
  };

  // Plain mode: clean TMDB backdrop, so hero banners look clean and Xperience can override it.
  if (RANKED_ART) meta.background = `${HOST_URL}/render-backdrop?${query}`;
  else if (details.backdrop_path) meta.background = `https://image.tmdb.org/t/p/original${details.backdrop_path}`;
  // TMDB title logo for the hero banner.
  const logo = pickLogo(details);
  if (SEND_LOGO && logo) meta.logo = logo;
  return meta;
}

// Redirect root URL to manifest.json
app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

// 1. Stremio Manifest Endpoint
app.get('/manifest.json', (req, res) => {
  res.json({
    id: 'com.english.posters.rank',
    version: '1.2.0',
    name: 'Top 10 Today (English Posters)',
    description: 'Top 10 Movies & TV Shows with original TMDB posters, rank numbers and status tags',
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: [
      { id: 'top10_movies', type: 'movie', name: 'Top 10 Movies Today' },
      { id: 'top10_series', type: 'series', name: 'Top 10 TV Shows Today' }
    ]
  });
});

// 2. Catalog Endpoint
app.get('/catalog/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const tmdbType = type === 'series' ? 'tv' : 'movie';

  try {
    const items = await getDailyTop10(tmdbType);
    const metas = await Promise.all(
      items.map((item, index) => buildMeta(item, index, type, tmdbType))
    );

    // Cache only until midnight, so a re-sync after the switch always gets the new day's list
    res.setHeader('Cache-Control', `public, s-maxage=${Math.min(3600, secondsUntilMidnight())}`);
    // cacheMaxAge tells apps how long to keep this list. Xperience re-syncs imported
    // catalogs on this value (minimum 1 hour), so the row picks up the new day's list
    // within an hour of midnight without a manual Re-sync.
    res.json({ metas, cacheMaxAge: 3600 });
  } catch (err) {
    console.error('Error fetching catalog:', err.message);
    res.status(500).json({ metas: [] });
  }
});

// maxAge = how long the app keeps it; cdnAge = how long Vercel's CDN keeps it
// (without s-maxage Vercel re-renders the image on every request).
function sendImage(res, buffer, maxAge = 86400, cdnAge = maxAge) {
  if (buffer) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', cdnAge > 0 ? `public, max-age=${maxAge}, s-maxage=${cdnAge}` : 'no-store');
    res.send(buffer);
  } else {
    res.setHeader('Cache-Control', 'no-store'); // never let apps cache a failure
    res.status(404).send('Image generation failed');
  }
}

// 3. Dynamic Poster Rendering Route (tall)
app.get('/render-poster', async (req, res) => {
  const { tmdbId, type, rank, tag } = req.query;
  sendImage(res, await generatePoster(tmdbId, type, rank, tag));
});

// 4. Dynamic Backdrop Rendering Route (wide)
app.get('/render-backdrop', async (req, res) => {
  const { tmdbId, type, rank, tag, debug } = req.query;
  if (debug) {
    // Open the URL with &debug=1 to see the real error text instead of a blank 404
    const started = Date.now();
    try {
      const buf = await generateBackdrop(tmdbId, type, rank, tag, { throwErrors: true });
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Render-Ms', String(Date.now() - started));
      res.setHeader('Content-Type', 'image/jpeg');
      return res.send(buf);
    } catch (err) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(500).type('text/plain').send(`Backdrop failed after ${Date.now() - started} ms\n\n${err.stack || err.message}`);
    }
  }
  sendImage(res, await generateBackdrop(tmdbId, type, rank, tag));
});

// 5. Poster Provider Endpoint (IMDb / TMDB id -> poster with status tag)
app.get('/poster/:id.jpg', async (req, res) => {
  const { id } = req.params;
  let tmdbId = id;
  let type = 'movie';

  try {
    if (id.startsWith('tt')) {
      const findRes = await axios.get(
        `https://api.themoviedb.org/3/find/${id}?external_source=imdb_id`,
        { headers: tmdb.headers, params: tmdb.params }
      );
      const movieMatch = findRes.data.movie_results?.[0];
      const tvMatch = findRes.data.tv_results?.[0];

      if (movieMatch) { tmdbId = movieMatch.id; type = 'movie'; }
      else if (tvMatch) { tmdbId = tvMatch.id; type = 'tv'; }
      else return res.status(404).send('Media not found');
    } else {
      try {
        await axios.get(`https://api.themoviedb.org/3/movie/${id}`, { headers: tmdb.headers, params: tmdb.params });
        type = 'movie';
      } catch (e) {
        type = 'tv';
      }
    }

    // Full details are needed for Premiere / Finale / New Episode tags
    const details = await fetchDetails(type, tmdbId);
    const tag = determineTag(details, type);
    sendImage(res, await generatePoster(tmdbId, type, null, tag));
  } catch (err) {
    console.error('Poster Provider Error:', err.message);
    res.status(500).send('Server Error');
  }
});

// ---------- Top 10 artwork provider (for Xperience / Nuvio "custom poster URL") ----------
// Nuvio/Xperience ask for art by title id, so we work out the rank ourselves
// by checking where that title sits in today's shared Top 10 list (same one the catalog uses).
async function getTop10Ids(tmdbType) {
  return (await getDailyTop10(tmdbType)).map(i => i.id);
}

function typeFromHint(hint) {
  const h = String(hint || '').toLowerCase();
  if (h === 'series' || h === 'tv' || h === 'show') return 'tv';
  if (h === 'movie' || h === 'film') return 'movie';
  return null;
}

// Accepts tt1234567, tt1234567:1:2 (episode), tmdb:123, or a plain number.
async function resolveTitle(rawId, typeHint, tmdbHint) {
  let id = String(rawId).trim();
  const hinted = typeFromHint(typeHint);

  // Fastest and most reliable: the app already told us the TMDB id
  const t = String(tmdbHint || '').replace(/^tmdb:/, '');
  if (/^\d+$/.test(t) && hinted) return { tmdbId: t, type: hinted };

  if (id.startsWith('tmdb:')) id = id.slice(5);

  if (id.startsWith('tt')) {
    id = id.split(':')[0];
    const { data } = await axios.get(`https://api.themoviedb.org/3/find/${id}`, {
      headers: tmdb.headers,
      params: { ...tmdb.params, external_source: 'imdb_id' }
    });
    const movie = data.movie_results?.[0];
    const tv = data.tv_results?.[0];
    if (hinted === 'tv' && tv) return { tmdbId: tv.id, type: 'tv' };
    if (hinted === 'movie' && movie) return { tmdbId: movie.id, type: 'movie' };
    if (movie) return { tmdbId: movie.id, type: 'movie' };
    if (tv) return { tmdbId: tv.id, type: 'tv' };
    return null;
  }

  if (/^\d+$/.test(id)) {
    const order = hinted ? [hinted] : ['movie', 'tv'];
    for (const type of order) {
      try {
        await axios.get(`https://api.themoviedb.org/3/${type}/${id}`, { headers: tmdb.headers, params: tmdb.params });
        return { tmdbId: id, type };
      } catch (e) { /* try the next type */ }
    }
  }
  return null;
}

// URL to paste in Xperience (Setup -> Custom URL):
//   https://YOUR-APP.vercel.app/top10/{shape}/{imdb_id}.jpg?type={type}&tmdb={tmdb_id}&ranks=all
//
// {shape}  landscape -> wide image (logo + pill), anything else -> tall poster (pill)
// ranks    all       -> rank number on titles in today's top 10, in EVERY shape
//          landscape -> rank number on landscape only (default)
//          none      -> never draw rank numbers
// debug=1  shows the real error text instead of a blank image
app.get('/top10/:shape/:id.jpg', async (req, res) => {
  const started = Date.now();
  const debug = !!req.query.debug;
  try {
    const { shape, id } = req.params;
    const resolved = await resolveTitle(id, req.query.type, req.query.tmdb);
    if (!resolved) throw new Error(`Could not find "${id}" on TMDB`);

    const { tmdbId, type } = resolved;
    const [details, top10] = await Promise.all([fetchDetails(type, tmdbId), getTop10Ids(type)]);
    const tag = determineTag(details, type);

    const landscape = String(shape).toLowerCase() === 'landscape';
    const ranks = String(req.query.ranks || 'landscape').toLowerCase();
    const pos = top10.indexOf(Number(tmdbId));
    const wantRank = ranks === 'all' || (ranks === 'landscape' && landscape);
    const rank = wantRank && pos >= 0 ? pos + 1 : null;

    // Reuse the images we already got with the details (one less TMDB call)
    const buffer = landscape
      ? await generateBackdrop(tmdbId, type, rank, tag, { throwErrors: debug, images: details.images })
      : await generatePoster(tmdbId, type, rank, tag, { images: details.images });
    if (!buffer) throw new Error('Image generation failed');

    if (debug) res.setHeader('X-Render-Ms', String(Date.now() - started));
    // At most 1 hour, and never past midnight when the ranks switch
    // Vercel's CDN keeps it until midnight (when ranks switch); the app re-checks hourly
    const untilMidnight = secondsUntilMidnight();
    sendImage(res, buffer, debug ? 0 : Math.min(3600, untilMidnight), debug ? 0 : untilMidnight);
  } catch (err) {
    console.error('Top10 art error:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    if (debug) {
      return res.status(500).type('text/plain')
        .send(`Failed after ${Date.now() - started} ms\n\n${err.stack || err.message}`);
    }
    res.status(500).send('Server Error');
  }
});

module.exports = app;