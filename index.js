require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { generatePoster } = require('./poster');

const app = express();
app.use(cors());

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const HOST_URL = process.env.HOST_URL || `http://localhost:${process.env.PORT || 3000}`;

// Helper: Determine dynamic tag (Just Added, New Season, Now Streaming, etc.)
function determineTag(item, type) {
  const releaseDateStr = item.release_date || item.first_air_date;
  if (!releaseDateStr) return 'Now Streaming';

  const releaseDate = new Date(releaseDateStr);
  const now = new Date();
  const diffDays = Math.floor((now - releaseDate) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 'Coming Soon';
  } else if (diffDays >= 0 && diffDays <= 30) {
    return 'Just Added';
  } else if (type === 'tv' && diffDays <= 90) {
    return 'New Season';
  } else if (type === 'movie' && diffDays <= 60) {
    return 'In Theaters';
  }

  return 'Now Streaming';
}


// ---------- Metadata for the hero banner (type • genre • year) ----------
// true  = use the IMDb id (tt1234567) when TMDB knows it. Apps like Nuvio then
//         pull full info (type, genre, year) the same way they do for Cinemeta.
// false = always use tmdb:<id>.
const USE_IMDB_IDS = true;

const tmdbAuth = {
  headers: TMDB_API_KEY.startsWith('ey') ? { Authorization: `Bearer ${TMDB_API_KEY}` } : {},
  params: TMDB_API_KEY.startsWith('ey') ? {} : { api_key: TMDB_API_KEY }
};

function yearOf(dateStr) {
  return dateStr ? String(dateStr).slice(0, 4) : '';
}

// "2023-" for running shows, "2011-2019" for ended ones, "2024" for movies
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

function pickLogo(details) {
  const logos = details.images?.logos || [];
  const best = logos
    .filter(l => l.iso_639_1 === 'en' || l.iso_639_1 === null)
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0))[0];
  return best ? `https://image.tmdb.org/t/p/w500${best.file_path}` : undefined;
}

async function buildMeta(item, index, type, tmdbType) {
  const tag = determineTag(item, tmdbType);
  let details = item; // fallback if the details call fails

  try {
    const { data } = await axios.get(`https://api.themoviedb.org/3/${tmdbType}/${item.id}`, {
      headers: tmdbAuth.headers,
      params: {
        ...tmdbAuth.params,
        append_to_response: 'external_ids,images',
        include_image_language: 'en,null'
      }
    });
    details = data;
  } catch (e) {
    console.error(`Details failed for ${item.id}:`, e.message);
  }

  const imdbId = details.external_ids?.imdb_id || details.imdb_id;
  const genres = (details.genres || []).map(g => g.name);
  const releaseInfo = buildReleaseInfo(details, tmdbType);
  const year = yearOf(details.release_date || details.first_air_date);

  const meta = {
    id: USE_IMDB_IDS && imdbId ? imdbId : `tmdb:${item.id}`,
    type,
    name: item.title || item.name,
    poster: `${HOST_URL}/render-poster?type=${tmdbType}&tmdbId=${item.id}&rank=${index + 1}&tag=${encodeURIComponent(tag)}&v=17`,
    posterShape: 'poster',
    genres,
    releaseInfo,
    year,
    released: details.release_date || details.first_air_date || undefined,
    description: details.overview || item.overview || '',
    imdbRating: item.vote_average ? item.vote_average.toFixed(1) : undefined
  };

  if (details.backdrop_path) meta.background = `https://image.tmdb.org/t/p/w1280${details.backdrop_path}`;
  const logo = pickLogo(details);
  if (logo) meta.logo = logo;
  return meta;
}

// Redirect root URL to manifest.json
app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

// 1. Stremio Manifest Endpoint
app.get('/manifest.json', (req, res) => {
  res.json({
    id: "com.english.posters.rank",
    version: "1.0.0",
    name: "Top 10 Today (English Posters)",
    description: "Top 10 Movies & TV Shows with original TMDB posters and rank numbers",
    resources: ["catalog"],
    types: ["movie", "series"],
    catalogs: [
      { id: "top10_movies", type: "movie", name: "Top 10 Movies Today" },
      { id: "top10_series", type: "series", name: "Top 10 TV Shows Today" }
    ]
  });
});

// 2. Catalog Endpoint
app.get('/catalog/:type/:id.json', async (req, res) => {
  const { type, id } = req.params;
  const tmdbType = type === 'series' ? 'tv' : 'movie';

  try {
    const tmdbUrl = `https://api.themoviedb.org/3/trending/${tmdbType}/day`;
    const response = await axios.get(tmdbUrl, {
      headers: TMDB_API_KEY.startsWith('ey') 
        ? { Authorization: `Bearer ${TMDB_API_KEY}` } 
        : {},
      params: !TMDB_API_KEY.startsWith('ey') ? { api_key: TMDB_API_KEY } : {}
    });

    const items = response.data.results.slice(0, 10);

    const metas = await Promise.all(
      items.map((item, index) => buildMeta(item, index, type, tmdbType))
    );

    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=600');
    res.json({ metas });
  } catch (err) {
    console.error('Error fetching catalog:', err.message);
    res.status(500).json({ metas: [] });
  }
});

// 3. Dynamic Poster Rendering Route
app.get('/render-poster', async (req, res) => {
  const { tmdbId, type, rank, tag } = req.query;

  const imageBuffer = await generatePoster(tmdbId, type, rank, tag);

  if (imageBuffer) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(imageBuffer);
  } else {
    res.setHeader('Cache-Control', 'no-store'); // never let apps cache a failure
    res.status(404).send('Image generation failed');
  }
});

// Poster Provider Endpoint
app.get('/poster/:id.jpg', async (req, res) => {
  const { id } = req.params;
  let tmdbId = id;
  let type = 'movie';
  let itemData = null;

  try {
    const authHeaders = TMDB_API_KEY.startsWith('ey') 
      ? { Authorization: `Bearer ${TMDB_API_KEY}` } 
      : {};
    const authParams = !TMDB_API_KEY.startsWith('ey') 
      ? { api_key: TMDB_API_KEY } 
      : {};

    // 1. Resolve IMDb ID to TMDB ID if needed
    if (id.startsWith('tt')) {
      const findRes = await axios.get(
        `https://api.themoviedb.org/3/find/${id}?external_source=imdb_id`,
        { headers: authHeaders, params: authParams }
      );

      const movieMatch = findRes.data.movie_results?.[0];
      const tvMatch = findRes.data.tv_results?.[0];

      if (movieMatch) {
        tmdbId = movieMatch.id;
        type = 'movie';
        itemData = movieMatch;
      } else if (tvMatch) {
        tmdbId = tvMatch.id;
        type = 'tv';
        itemData = tvMatch;
      } else {
        return res.status(404).send('Media not found');
      }
    } else {
      // Numerical TMDB ID fallback: fetch details
      try {
        const detailRes = await axios.get(
          `https://api.themoviedb.org/3/movie/${id}`,
          { headers: authHeaders, params: authParams }
        );
        itemData = detailRes.data;
        type = 'movie';
      } catch (e) {
        const tvDetailRes = await axios.get(
          `https://api.themoviedb.org/3/tv/${id}`,
          { headers: authHeaders, params: authParams }
        );
        itemData = tvDetailRes.data;
        type = 'tv';
      }
    }

    // 2. Dynamically determine the context-aware tag
    const dynamicTag = determineTag(itemData, type);

    // 3. Generate artwork with larger frosted pill and dynamic tag
    const imageBuffer = await generatePoster(tmdbId, type, null, dynamicTag);

    if (imageBuffer) {
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(imageBuffer);
    } else {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).send('Image generation failed');
    }
  } catch (err) {
    console.error('Poster Provider Error:', err.message);
    res.status(500).send('Server Error');
  }
});

module.exports = app;