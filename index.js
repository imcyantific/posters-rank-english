require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { generatePoster } = require('./poster');

const app = express();
app.use(cors());

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const HOST_URL = process.env.HOST_URL || `http://localhost:${process.env.PORT || 3000}`;

// Redirect root URL to manifest.json
app.get('/', (req, res) => {
  res.redirect('/manifest.json');
});

// 1. Manifest Endpoint
app.get('/manifest.json', (req, res) => {
  res.json({
    id: "com.english.posters.rank",
    version: "1.0.0",
    name: "Top 10 Today (English Posters)",
    description: "Top Movies & TV Shows with guaranteed English logos",
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
    // Fetch Trending from TMDB
    const trendingRes = await axios.get(
      `https://api.themoviedb.org/3/trending/${tmdbType}/day`,
      { headers: { Authorization: `Bearer ${TMDB_API_KEY}` } }
    );

    const top10 = trendingRes.data.results.slice(0, 10);

    // Convert TMDB items into Stremio metadata objects
    const metas = await Promise.all(top10.map(async (item, index) => {
      // Get IMDb ID for Stremio/Xperience compatibility
      const externalRes = await axios.get(
        `https://api.themoviedb.org/3/${tmdbType}/${item.id}/external_ids`,
        { headers: { Authorization: `Bearer ${TMDB_API_KEY}` } }
      );
      
      const imdbId = externalRes.data.imdb_id || `tmdb:${item.id}`;

      return {
        id: imdbId,
        type: type,
        name: item.title || item.name,
        // Point the poster field to our dynamic rendering endpoint
        poster: `${HOST_URL}/render-poster?type=${tmdbType}&tmdbId=${item.id}&rank=${index + 1}&title=${encodeURIComponent(item.title || item.name)}&v=9`
      };
    }));

    res.json({ metas });
  } catch (err) {
    console.error(err);
    res.json({ metas: [] });
  }
});

// 3. Dynamic Poster Rendering Route
app.get('/render-poster', async (req, res) => {
  const { tmdbId, type, rank, title } = req.query;
  
  const imageBuffer = await generatePoster(tmdbId, type, rank, title);
  
  if (imageBuffer) {
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(imageBuffer);
  } else {
    res.status(404).send('Image generation failed');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Addon running on ${HOST_URL}/manifest.json`);
});