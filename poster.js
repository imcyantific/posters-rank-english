const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const W = 600;
const H = 900;

try {
  GlobalFonts.registerFromPath(path.join(__dirname, 'BebasNeue-Regular.ttf'), 'BebasNeue');
} catch (e) {
  console.log('Font registration error:', e.message);
}

const auth = TMDB_API_KEY.startsWith('ey')
  ? { headers: { Authorization: `Bearer ${TMDB_API_KEY}` }, params: {} }
  : { headers: {}, params: { api_key: TMDB_API_KEY } };

// Pick the original TMDB poster (with its own title art): best-rated English one first.
async function getPosterPath(type, tmdbId) {
  const { data } = await axios.get(
    `https://api.themoviedb.org/3/${type}/${tmdbId}/images`,
    { ...auth, params: { ...auth.params, include_image_language: 'en,null' } }
  );
  const posters = data.posters || [];
  const byVotes = (a, b) => (b.vote_average || 0) - (a.vote_average || 0);
  const english = posters.filter(p => p.iso_639_1 === 'en').sort(byVotes);
  const textless = posters.filter(p => p.iso_639_1 === null).sort(byVotes);
  return (english[0] || textless[0] || posters[0])?.file_path;
}

function roundedTopRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// Frosted glass tab at the bottom: the poster is blurred *inside* the shape.
function drawTagPill(ctx, posterImg, text) {
  if (!text) return;
  const label = text.toUpperCase();

  ctx.save();
  ctx.font = '72px "BebasNeue"';
  try { ctx.letterSpacing = '2px'; } catch (_) {}
  const textWidth = ctx.measureText(label).width;

  const pillW = Math.min(W - 40, Math.max(textWidth + 90, 300));
  const pillH = 96;
  const x = (W - pillW) / 2;
  const y = H - pillH;
  const r = 22;

  // 1. Soft shadow above the tab so it lifts off the poster
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = -2;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  roundedTopRect(ctx, x, y, pillW, pillH, r);
  ctx.fill();
  ctx.restore();

  // 2. Real blur: redraw the poster blurred, clipped to the tab shape
  ctx.save();
  roundedTopRect(ctx, x, y, pillW, pillH, r);
  ctx.clip();
  ctx.filter = 'blur(18px)';
  ctx.drawImage(posterImg, -40, -40, W + 80, H + 80); // oversize to avoid transparent edges
  ctx.filter = 'none';

  // 3. Dark tint + glass sheen (light at top fading down)
  ctx.fillStyle = 'rgba(12, 12, 18, 0.55)';
  ctx.fillRect(x, y, pillW, pillH);
  const sheen = ctx.createLinearGradient(0, y, 0, y + pillH);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0.04)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, pillW, pillH);
  ctx.restore();

  // 4. Rim highlight along the top edge and sides
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = 2;
  roundedTopRect(ctx, x, y + 1, pillW, pillH, r);
  ctx.stroke();

  // 5. Text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.fillText(label, W / 2, y + pillH / 2 + 2);
  ctx.restore();
}

function drawRank(ctx, rank) {
  ctx.save();
  ctx.font = '220px "BebasNeue"';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText(`${rank}`, 20, 0);
  ctx.restore();
}

async function generatePoster(tmdbId, type = 'movie', rank = null, tag = null) {
  try {
    const posterPath = await getPosterPath(type, tmdbId);
    if (!posterPath) throw new Error('Poster not found');

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');

    const posterImg = await loadImage(`https://image.tmdb.org/t/p/w780${posterPath}`);
    ctx.drawImage(posterImg, 0, 0, W, H);

    if (rank) drawRank(ctx, rank);        // only passed for the top 10 catalog
    if (tag) drawTagPill(ctx, posterImg, tag);

    return canvas.toBuffer('image/jpeg', 90);
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };