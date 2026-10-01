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

// Draw larger toptoday-style frosted glass bottom tag
function drawTagPill(ctx, text) {
  if (!text) return;
  
  ctx.save();
  // Bumped up font size from 32px to 38px
  ctx.font = '38px "BebasNeue"';
  const textMetrics = ctx.measureText(text.toUpperCase());
  
  const paddingX = 34;
  const pillWidth = Math.max(textMetrics.width + (paddingX * 2), 210);
  const pillHeight = 52;
  const x = (600 - pillWidth) / 2;
  const y = 848; // Anchored closer to the bottom edge

  const radius = 12;

  // 1. Outer Soft Glow / Shadow Layer for Depth
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;

  // 2. Base Dark Frosted Layer
  ctx.fillStyle = 'rgba(12, 12, 14, 0.75)';
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + pillWidth - radius, y);
  ctx.quadraticCurveTo(x + pillWidth, y, x + pillWidth, y + radius);
  ctx.lineTo(x + pillWidth, 900);
  ctx.lineTo(x, 900);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
  ctx.fill();

  // Reset shadow so it doesn't bleed into the text
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 3. Frosted Glass Top Tint Layer
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();

  // 4. Frosted Glass Top Rim Highlight Border
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + pillWidth - radius, y);
  ctx.stroke();

  // Subtle side edge borders
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + radius);
  ctx.lineTo(x, 900);
  ctx.moveTo(x + pillWidth, y + radius);
  ctx.lineTo(x + pillWidth, 900);
  ctx.stroke();

  // 5. Crisp White Bold Text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Text drop shadow for legibility over light backgrounds
  ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
  ctx.shadowBlur = 6;
  ctx.fillText(text.toUpperCase(), 300, y + (pillHeight / 2) - 1);

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