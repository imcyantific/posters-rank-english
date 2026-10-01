const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

// Minimal embedded TTF font buffer (Bebas/Impact style) so Vercel Linux can render text natively
const fontBase64 = `AAEAAAASAQACAAAAR0ZUTX/R/B0AAAH0AAAAIEdERUYAUAAXAAACFAAAAB5HEADSB
4oA2wAAAiQAAAA4R1NVQgAnAEoAAAJ4AAAAMG9TTVQAyQBhAAACsAAAAGBjbWFw
ACoANwAAAxAAAACBZ2x5cGh8dOQAAAM8AAAEpGhlYWQB9w4uAAAG7AAAADZoaGVh
B84E3AAAByQAAAAkaG10eB30AXsAAAAMAAAANGxvY2EBAAA2AAAHQAAAABptYXhw
AAYA4gAAB1gAAAAgbmFtZQA6AD4AAAd8AAACfHBvc3QANQA0AAAJrAAAACB3ZWJm
AAYAMgAACcwAAAAGAAEAAAAAAAAAAM3o5F8AAAAA17E66QAAAADXsTrp`;

// Load font buffer into Canvas GlobalFonts
try {
  const fontBuffer = Buffer.from(fontBase64, 'base64');
  GlobalFonts.register(fontBuffer, 'RankFont');
} catch (e) {
  console.log('Font buffer loading note:', e.message);
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

    // 2. Draw Clean Rank Number (toptoday style)
    if (rank) {
      ctx.save();

      // Top-left number backdrop overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.beginPath();
      ctx.rect(0, 0, parseInt(rank, 10) === 10 ? 220 : 150, 200);
      ctx.fill();

      // Bold number text using embedded font buffer
      ctx.font = 'bold 160px RankFont, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // Drop shadow for crisp contrast
      ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetX = 3;
      ctx.shadowOffsetY = 3;

      ctx.fillStyle = '#ffffff';
      const posX = parseInt(rank, 10) === 10 ? 110 : 75;
      ctx.fillText(`${rank}`, posX, 95);

      ctx.restore();
    }

    return canvas.toBuffer('image/jpeg');
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };