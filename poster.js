const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Register a built-in clean sans-serif/impact font buffer
// (If font registration fails in any edge case, canvas uses clean fallback fill)
try {
  // Try registering system/default font aliases
  GlobalFonts.register({
    family: 'RankFont',
    weight: 'bold'
  });
} catch (e) {
  // Fallback silent
}

async function generatePoster(tmdbId, type = 'movie', rank = null, fallbackTitle = '') {
  try {
    const imagesRes = await axios.get(
      `https://api.themoviedb.org/3/${type}/${tmdbId}/images?include_image_language=en,null`,
      { 
        headers: TMDB_API_KEY.startsWith('ey') 
          ? { Authorization: `Bearer ${TMDB_API_KEY}` } 
          : {},
        params: !TMDB_API_KEY.startsWith('ey') ? { api_key: TMDB_API_KEY } : {}
      }
    );

    const posters = imagesRes.data.posters || [];
    const logos = imagesRes.data.logos || [];

    const textlessPoster = posters.find(p => p.iso_639_1 === null);
    const englishPoster = posters.find(p => p.iso_639_1 === 'en');
    const posterPath = textlessPoster?.file_path || englishPoster?.file_path || posters[0]?.file_path;

    const englishLogo = logos.find(l => l.iso_639_1 === 'en');
    const logoPath = englishLogo?.file_path;

    if (!posterPath) throw new Error("Poster not found");

    const canvas = createCanvas(600, 900);
    const ctx = canvas.getContext('2d');

    const posterImg = await loadImage(`https://image.tmdb.org/t/p/w500${posterPath}`);
    ctx.drawImage(posterImg, 0, 0, 600, 900);

    // 1. Overlay English Logo
    if (logoPath) {
      const logoImg = await loadImage(`https://image.tmdb.org/t/p/w500${logoPath}`);
      const logoWidth = 450;
      const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
      ctx.drawImage(logoImg, (600 - logoWidth) / 2, 720 - logoHeight / 2, logoWidth, logoHeight);
    }

    // 2. Draw Clean Large Semi-Transparent Rank Overlay (Toptoday Style)
    if (rank) {
      ctx.save();
      
      // Large bold typography
      ctx.font = '900 220px "Impact", "Arial Black", "DejaVu Sans", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';

      // Drop shadow for legibility over light posters
      ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;

      // Semi-transparent light fill matching toptoday.llmayu.com
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';

      // Draw number at top-left
      ctx.fillText(`${rank}`, 25, 10);

      ctx.restore();
    }

    return canvas.toBuffer('image/jpeg');
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };