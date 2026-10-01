const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY;

try {
  const fontPath = path.join(__dirname, 'BebasNeue-Regular.ttf');
  GlobalFonts.registerFromPath(fontPath, 'BebasNeue');
} catch (e) {
  console.log('Font registration error:', e.message);
}

// Draw toptoday style bottom liquid glass tag
function drawTagPill(ctx, text) {
  if (!text) return;
  
  ctx.save();
  ctx.font = '32px "BebasNeue"';
  const textMetrics = ctx.measureText(text.toUpperCase());
  
  const paddingX = 28;
  const pillWidth = Math.max(textMetrics.width + (paddingX * 2), 180);
  const pillHeight = 45;
  const x = (600 - pillWidth) / 2;
  const y = 855; // Anchored at the bottom edge

  // Glassmorphic / Liquid Dark Background
  ctx.fillStyle = 'rgba(15, 15, 15, 0.78)';
  ctx.beginPath();
  
  // Rounded top corners, square bottom anchored to canvas edge
  const radius = 10;
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + pillWidth - radius, y);
  ctx.quadraticCurveTo(x + pillWidth, y, x + pillWidth, y + radius);
  ctx.lineTo(x + pillWidth, 900);
  ctx.lineTo(x, 900);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();

  // Subtle frosted glass highlight border on top
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + pillWidth - radius, y);
  ctx.stroke();

  // White text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.toUpperCase(), 300, y + (pillHeight / 2) - 2);

  ctx.restore();
}

async function generatePoster(tmdbId, type = 'movie', rank = null, tag = null) {
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
      ctx.drawImage(logoImg, (600 - logoWidth) / 2, 700 - logoHeight / 2, logoWidth, logoHeight);
    }

    // 2. Overlay Top-Left Rank Number
    if (rank) {
      ctx.save();
      ctx.font = '220px "BebasNeue"';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 15;
      ctx.shadowOffsetX = 4;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.fillText(`${rank}`, 20, 0);
      ctx.restore();
    }

    // 3. Overlay Bottom Liquid Glass Tag
    if (tag) {
      drawTagPill(ctx, tag);
    }

    return canvas.toBuffer('image/jpeg');
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };