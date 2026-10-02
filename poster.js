const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const axios = require('axios');
const path = require('path');

const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const W = 600;
const H = 900;

// Inter SemiBold = pill text (clean, readable). Bebas Neue = rank numbers.
try {
  GlobalFonts.registerFromPath(path.join(__dirname, 'Inter-SemiBold.ttf'), 'Inter');
  GlobalFonts.registerFromPath(path.join(__dirname, 'BebasNeue-Regular.ttf'), 'BebasNeue');
} catch (e) {
  console.log('Font registration error:', e.message);
}

const auth = TMDB_API_KEY.startsWith('ey')
  ? { headers: { Authorization: `Bearer ${TMDB_API_KEY}` }, params: {} }
  : { headers: {}, params: { api_key: TMDB_API_KEY } };

// Pick the original TMDB poster: best-rated English one first, then textless,
// then ANY language, then the title's default poster.
async function getPosterPath(type, tmdbId) {
  const byVotes = (a, b) => (b.vote_average || 0) - (a.vote_average || 0);

  const { data } = await axios.get(
    `https://api.themoviedb.org/3/${type}/${tmdbId}/images`,
    { ...auth, params: { ...auth.params, include_image_language: 'en,null' } }
  );
  const posters = data.posters || [];
  const english = posters.filter(p => p.iso_639_1 === 'en').sort(byVotes);
  const textless = posters.filter(p => p.iso_639_1 === null).sort(byVotes);
  const found = (english[0] || textless[0] || posters[0])?.file_path;
  if (found) return found;

  const { data: details } = await axios.get(
    `https://api.themoviedb.org/3/${type}/${tmdbId}`,
    auth
  );
  return details.poster_path;
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

// Blur the pixels ALREADY on the canvas under the pill, so the blur lines up
// perfectly with the poster. Uses downscale -> upscale, which works on every
// canvas build (ctx.filter is unreliable on some serverless runtimes).
function blurRegion(srcCanvas, x, y, w, h, pad = 40, shrink = 10) {
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sw = Math.min(W - sx, w + pad * 2);
  const sh = Math.min(H - sy, h + pad * 2);

  const small = createCanvas(Math.max(1, Math.round(sw / shrink)), Math.max(1, Math.round(sh / shrink)));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, small.width, small.height);

  const big = createCanvas(sw, sh);
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, sw, sh);
  return { canvas: big, sx, sy };
}

// Frosted-glass tab at the bottom of the poster.
function drawTagPill(ctx, text) {
  if (!text) return;
  const label = String(text); // keep mixed case, like "Finale Oct 6"

  ctx.save();
  ctx.font = '600 38px "Inter"';
  const textW = ctx.measureText(label).width;

  const pillW = Math.min(W - 60, Math.max(textW + 72, 230));
  const pillH = 74;
  const x = Math.round((W - pillW) / 2);
  const y = H - pillH;
  const r = 22;

  // 1. Real blur of the poster behind the pill, clipped to the pill shape
  const { canvas: blurred, sx, sy } = blurRegion(ctx.canvas, x, y, pillW, pillH);
  ctx.save();
  roundedTopRect(ctx, x, y, pillW, pillH, r);
  ctx.clip();
  ctx.drawImage(blurred, sx, sy);

  // 2. Glass tint: dark base so white text always reads + light sheen on top
  ctx.fillStyle = 'rgba(20, 20, 24, 0.38)';
  ctx.fillRect(x, y, pillW, pillH);
  const sheen = ctx.createLinearGradient(0, y, 0, y + pillH);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0.06)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, pillW, pillH);
  ctx.restore();

  // 3. Thin glass rim (top + sides)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5;
  roundedTopRect(ctx, x + 0.75, y + 0.75, pillW - 1.5, pillH, r);
  ctx.stroke();

  // 4. Text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText(label, W / 2, y + pillH / 2 + 1);
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

    if (rank) drawRank(ctx, rank);   // only passed for the top 10 catalog
    if (tag) drawTagPill(ctx, tag);  // drawn last so it blurs the final poster

    return canvas.toBuffer('image/jpeg', 90);
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

module.exports = { generatePoster };