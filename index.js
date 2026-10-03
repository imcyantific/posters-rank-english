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
const IMG_VERSION = 20;

// true  = use the IMDb id (tt1234567) when TMDB knows it, like Cinemeta does.
// false = always use tmdb:<id>.
const USE_IMDB_IDS = true;

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

async function buildMeta(item, index, type, tmdbType, landscape) {
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
  const portraitUrl = `${HOST_URL}/render-poster?${query}`;
  const landscapeUrl = `${HOST_URL}/render-backdrop?${query}`;
  const meta = {
    id: USE_IMDB_IDS && imdbId ? imdbId : `tmdb:${item.id}`,
    type,
    name: item.title || item.name,
    poster: landscape ? landscapeUrl : portraitUrl,
    posterShape: landscape ? 'landscape' : 'poster',
    genres,
    // Newer Stremio-style genre list (some apps read this instead of "genres")
    links: genres.map(g => ({ name: g, category: 'Genres', url: `stremio:///search?search=${encodeURIComponent(g)}` })),
    releaseInfo: buildReleaseInfo(details, tmdbType),
    year,
    released: details.release_date || details.first_air_date || undefined,
    description: details.overview || item.overview || '',
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined
  };

  // Apps draw PORTRAIT tiles from "poster" and LANDSCAPE tiles from "background",
  // so both carry the ranked artwork. That way the row can switch shape freely
  // while Poster art is set to "Original".
  meta.background = landscapeUrl;
  // No "logo" field on purpose: our artwork already has the title logo drawn in,
  // and Nuvio overlays meta.logo on landscape tiles, which doubled the logo.
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
    version: '1.1.0',
    name: 'Top 10 Today (English Posters)',
    description: 'Top 10 Movies & TV Shows with original TMDB posters, rank numbers and status tags',
    resources: ['catalog'],
    types: ['movie', 'series'],
    catalogs: [
      { id: 'top10_movies', type: 'movie', name: 'Top 10 Movies Today' },
      { id: 'top10_series', type: 'series', name: 'Top 10 TV Shows Today' },
      { id: 'top10_movies_landscape', type: 'movie', name: 'Top 10 Movies Today (Landscape)' },
      { id: 'top10_series_landscape', type: 'series', name: 'Top 10 TV Shows Today (Landscape)' }
    ]
  });
});

// 2. Catalog Endpoint (poster + landscape variants)
app.get('/catalog/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const tmdbType = type === 'series' ? 'tv' : 'movie';
  const landscape = id.endsWith('_landscape');

  try {
    const response = await axios.get(`https://api.themoviedb.org/3/trending/${tmdbType}/day`, {
      headers: tmdb.headers,
      params: tmdb.params
    });

    const items = response.data.results.slice(0, 10);
    const metas = await Promise.all(
      items.map((item, index) => buildMeta(item, index, type, tmdbType, landscape))
    );

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    res.json({ metas });
  } catch (err) {
    console.error('Error fetching catalog:', err.message);
    res.status(500).json({ metas: [] });
  }
});

function sendImage(res, buffer, maxAge = 86400) {
  if (buffer) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', `public, max-age=${maxAge}`);
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
//   https://YOUR-APP.vercel.app/top10/{shape}/{imdb_id}.jpg?type={type}&tmdb={tmdb_id}
//
// Used by every row set to "Providers". It never draws rank numbers;
// ranks only come from the Top 10 catalogs themselves ("Original").
// {shape}  landscape -> wide image (logo + pill), anything else -> tall poster (pill)
// debug=1  shows the real error text instead of a blank image
app.get('/top10/:shape/:id.jpg', async (req, res) => {
  const started = Date.now();
  const debug = !!req.query.debug;
  try {
    const { shape, id } = req.params;
    const resolved = await resolveTitle(id, req.query.type, req.query.tmdb);
    if (!resolved) throw new Error(`Could not find "${id}" on TMDB`);

    const { tmdbId, type } = resolved;
    const details = await fetchDetails(type, tmdbId);
    const tag = determineTag(details, type);

    const landscape = String(shape).toLowerCase() === 'landscape';
    const buffer = landscape
      ? await generateBackdrop(tmdbId, type, null, tag, { throwErrors: debug })
      : await generatePoster(tmdbId, type, null, tag);
    if (!buffer) throw new Error('Image generation failed');

    if (debug) res.setHeader('X-Render-Ms', String(Date.now() - started));
    sendImage(res, buffer, debug ? 0 : 86400);
  } catch (err) {
    console.error('Provider art error:', err.message);
    res.setHeader('Cache-Control', 'no-store');
    if (debug) {
      return res.status(500).type('text/plain')
        .send(`Failed after ${Date.now() - started} ms\n\n${err.stack || err.message}`);
    }
    res.status(500).send('Server Error');
  }
});

module.exports = app;