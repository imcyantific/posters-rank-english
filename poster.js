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

// Draw authentic toptoday-style frosted glass pill overlay
function drawTagPill(ctx, text) {
  if (!text) return;
  
  ctx.save();
  // Scaled up font for high visibility and readability
  ctx.font = '44px "BebasNeue"';
  const textMetrics = ctx.measureText(text.toUpperCase());
  
  const paddingX = 36;
  const pillWidth = Math.max(textMetrics.width + (paddingX * 2), 240);
  const pillHeight = 58;
  const x = (600 - pillWidth) / 2;
  const y = 842; // Anchored directly at bottom edge
  const radius = 10;

  // 1. Heavy Outer Drop Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;

  // 2. Dark Frosted Glass Base
  ctx.fillStyle = 'rgba(12, 12, 15, 0.82)';
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

  // Reset shadow to avoid blur distortion on lines/text
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 3. Subtle Glass Surface Sheen
  ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.fill();

  // 4. Bright Top Rim Highlight Line (Creates the liquid glass edge effect)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + pillWidth - radius, y);
  ctx.stroke();

  // Subtle vertical side borders
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y + radius);
  ctx.lineTo(x, 900);
  ctx.moveTo(x + pillWidth, y + radius);
  ctx.lineTo(x + pillWidth, 900);
  ctx.stroke();

  // 5. Crisp White Text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  
  // Text drop shadow for maximum legibility over light posters
  ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  
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

    // 1. Overlay English Logo (Shifted higher to leave clear room for tag)
    if (logoPath) {
      const logoImg = await loadImage(`https://image.tmdb.org/t/p/w500${logoPath}`);
      const logoWidth = 450;
      const logoHeight = (logoImg.height / logoImg.width) * logoWidth;
      const logoY = tag ? 660 : 720;
      ctx.drawImage(logoImg, (600 - logoWidth) / 2, logoY - logoHeight / 2, logoWidth, logoHeight);
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