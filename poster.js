const { createCanvas, GlobalFonts, Path2D } = require('@napi-rs/canvas');
const path = require('path');
const { tmdbGet, fetchImage, byBest, sharpFirst, rankLogos } = require('./tmdb');

// Two layouts: tall poster and wide backdrop. Everything else is shared.
const LAYOUTS = {
  // S = output pixels per layout unit, so artwork is sharp but sizes stay the same.
  // Poster = 780x1170. Landscape S is set by IMAGE_QUALITY below.
  poster:   { S: 1.3, W: 600, H: 900, providerTop: 26, providerTopRanked: 210, providerSize: 60, metaFont: 30, metaChipH: 50, metaGap: 14, logoMaxW: 0.8, logoMaxH: 0.2, gradTop: 0.55, shiftForTopPill: true, rankFont: 220, rankX: 20, rankY: 0, pillH: 74, pillFont: 38, pillR: 22 },
  backdrop: { S: 2, W: 960, H: 540, providerTop: 24, providerTopRanked: 140, providerSize: 52, metaFont: 26, metaChipH: 44, metaGap: 12, logoMaxW: 0.5, logoMaxH: 0.3, gradTop: 0.35, rankFont: 150, rankX: 30, rankY: 8, pillH: 74, pillFont: 40, pillR: 22 }
};

// IMAGE_QUALITY: high (default) -> landscape 1920x1080, JPEG 92
//                balanced       -> landscape 1280x720, JPEG 85 (about 3x smaller files, for
//                                  when Vercel's free 10 GB "Fast Origin Transfer" runs low)
// Either way we start from TMDB's full-size originals; those downloads don't count toward
// that limit, only the finished image we send does. JPEG_QUALITY (60-95) overrides the JPEG part.
const IMAGE_QUALITY = String(process.env.IMAGE_QUALITY || 'high').toLowerCase() === 'balanced' ? 'balanced' : 'high';
LAYOUTS.backdrop.S = IMAGE_QUALITY === 'high' ? 2 : 4 / 3;

// PILL_SIZE scales the status pill ("Now Streaming"): 1 = original size, 0.8 = default
// (20% smaller so it covers less of the poster), 0.7 = smaller still.
const PILL_SIZE = Math.min(1.5, Math.max(0.5, Number(process.env.PILL_SIZE) || 0.8));
for (const L of Object.values(LAYOUTS)) {
  L.pillH = Math.round(L.pillH * PILL_SIZE);
  L.pillFont = Math.round(L.pillFont * PILL_SIZE);
  L.pillR = Math.round(L.pillR * PILL_SIZE);
}

// Inter SemiBold = pill text. Bebas Neue = rank numbers.
try {
  GlobalFonts.registerFromPath(path.join(__dirname, 'Inter-SemiBold.ttf'), 'Inter');
  GlobalFonts.registerFromPath(path.join(__dirname, 'BebasNeue-Regular.ttf'), 'BebasNeue');
} catch (e) {
  console.log('Font registration error:', e.message);
}

const getImages = (type, tmdbId) => tmdbGet(`/${type}/${tmdbId}/images`, { include_image_language: 'en,null' });

// POSTER_STYLE decides when to use a textless poster + our own logo above the pill:
//   logo (default) -> only on ranked posters (Top 10), so the rank number never covers a
//                     printed title. Other posters keep the normal English poster, because
//                     TMDB sometimes tags foreign-text posters as "no language".
//   always         -> on every poster (also unranked ones from the Custom URL).
//   original       -> never; always the normal poster.
// Normal poster = best English one, then one in the original language (has the title),
// then textless, then any.
// `images` can be passed in when we already have them (saves a TMDB call).
const POSTER_STYLE = String(process.env.POSTER_STYLE || 'logo').toLowerCase();

async function getPosterAssets(type, tmdbId, images, ranked = false) {
  const data = images || await getImages(type, tmdbId);
  const posters = sharpFirst(data.posters || [], 780); // we draw at 780 px wide
  const english = posters.filter(p => p.iso_639_1 === 'en').sort(byBest);
  const textless = posters.filter(p => p.iso_639_1 === null).sort(byBest);
  // Posters in another language (e.g. the Japanese poster of an anime) still show the title.
  const foreign = posters.filter(p => p.iso_639_1 && p.iso_639_1 !== 'en').sort(byBest);
  const logoPaths = logoCandidates(rankLogos(data.logos));

  const useTextless = POSTER_STYLE === 'always' || (POSTER_STYLE === 'logo' && ranked);
  if (useTextless && textless[0] && logoPaths.length) {
    return { posterPath: textless[0].file_path, logoPaths };
  }
  const found = (english[0] || foreign[0] || textless[0] || posters[0])?.file_path;
  if (found) return { posterPath: found, logoPaths: [] };

  const details = await tmdbGet(`/${type}/${tmdbId}`);
  return { posterPath: details.poster_path, logoPaths: [] };
}

// The best logo plus a few backups in the same language, in case the best one is too
// dark to read on the dark gradient (see loadLogo).
function logoCandidates(logos) {
  const lang = logos[0]?.iso_639_1 || null;
  return logos.filter(l => (l.iso_639_1 || null) === lang).slice(0, 4).map(l => l.file_path);
}

// Backdrop: if the title has an English logo, use a textless backdrop and draw
// the logo on top (looks like a landscape poster). Otherwise use a backdrop
// that already has text, then any backdrop.
async function getBackdropAssets(type, tmdbId, images) {
  const data = images || await getImages(type, tmdbId);
  const backdrops = sharpFirst(data.backdrops || [], 1280);
  const logos = rankLogos(data.logos);
  const textless = backdrops.filter(b => b.iso_639_1 === null).sort(byBest);
  const english = backdrops.filter(b => b.iso_639_1 === 'en').sort(byBest);
  const any = [...backdrops].sort(byBest);

  let backdropPath = null;
  let logoPaths = [];

  if (logos[0] && (textless[0] || any[0])) {
    backdropPath = (textless[0] || any[0]).file_path;
    logoPaths = logoCandidates(logos);
  } else {
    backdropPath = (english[0] || textless[0] || any[0])?.file_path || null;
  }

  if (!backdropPath) {
    const details = await tmdbGet(`/${type}/${tmdbId}`);
    backdropPath = details.backdrop_path;
  }
  return { backdropPath, logoPaths };
}

// PILL_POSITION=top puts the status pill (e.g. "Now Streaming") at the top of POSTERS,
// hanging from the top edge; bottom (default) keeps it at the bottom.
const PILL_POSITION = String(process.env.PILL_POSITION || 'bottom').toLowerCase() === 'top' ? 'top' : 'bottom';
// LANDSCAPE_PILL_POSITION does the same for landscape art; if unset it follows PILL_POSITION.
// META_CHIP=on puts the genre + rating line on a dark rounded background.
// Default (off) draws just the text with a soft shadow so it stays readable.
const META_CHIP = String(process.env.META_CHIP || 'off').toLowerCase() === 'on';
const LANDSCAPE_PILL_POSITION = process.env.LANDSCAPE_PILL_POSITION
  ? (String(process.env.LANDSCAPE_PILL_POSITION).toLowerCase() === 'top' ? 'top' : 'bottom')
  : PILL_POSITION;

function roundedBottomRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.closePath();
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

// Blur the pixels ALREADY on the canvas under the pill (downscale -> upscale).
function blurRegion(srcCanvas, L, x, y, w, h, pad = 40, shrink = 10) {
  const S = L.S || 1;
  const sx = Math.max(0, x - pad);
  const sy = Math.max(0, y - pad);
  const sw = Math.min(L.W - sx, w + pad * 2);
  const sh = Math.min(L.H - sy, h + pad * 2);
  const pw = Math.max(1, Math.round(sw * S));
  const ph = Math.max(1, Math.round(sh * S));

  const small = createCanvas(Math.max(1, Math.round(pw / (shrink * S))), Math.max(1, Math.round(ph / (shrink * S))));
  const sctx = small.getContext('2d');
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(srcCanvas, sx * S, sy * S, sw * S, sh * S, 0, 0, small.width, small.height);

  const big = createCanvas(pw, ph);
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, pw, ph);
  return { canvas: big, sx, sy, sw, sh };
}

// Frosted-glass tab at the bottom centre.
function drawTagPill(ctx, text, L, position = 'bottom') {
  if (!text) return;
  const label = String(text);

  ctx.save();
  ctx.font = `600 ${L.pillFont}px "Inter"`;
  const textW = ctx.measureText(label).width;

  const pillW = Math.min(L.W - 60, Math.max(textW + 72 * PILL_SIZE, 230 * PILL_SIZE));
  const pillH = L.pillH;
  const x = Math.round((L.W - pillW) / 2);
  const atTop = position === 'top';
  const y = atTop ? 0 : L.H - pillH;
  const r = L.pillR;
  const shape = atTop ? roundedBottomRect : roundedTopRect;

  // 1. Real blur of the image behind the pill
  const { canvas: blurred, sx, sy, sw, sh } = blurRegion(ctx.canvas, L, x, y, pillW, pillH);
  ctx.save();
  shape(ctx, x, y, pillW, pillH, r);
  ctx.clip();
  ctx.drawImage(blurred, sx, sy, sw, sh);

  // 2. Glass tint + sheen
  ctx.fillStyle = 'rgba(20, 20, 24, 0.38)';
  ctx.fillRect(x, y, pillW, pillH);
  const sheen = ctx.createLinearGradient(0, y, 0, y + pillH);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.20)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0.06)');
  ctx.fillStyle = sheen;
  ctx.fillRect(x, y, pillW, pillH);
  ctx.restore();

  // 3. Rim
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1.5;
  if (atTop) shape(ctx, x + 0.75, y - 0.75, pillW - 1.5, pillH, r);
  else shape(ctx, x + 0.75, y + 0.75, pillW - 1.5, pillH, r);
  ctx.stroke();

  // 4. Text
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fillText(label, L.W / 2, y + pillH / 2 + 1);
  ctx.restore();
}

// TMDB's logo (the stacked "THE MOVIE DB" mark) next to the rating, since the rating is
// TMDB's user score. Shape from the simple-icons set (CC0), on a 24 x 24 grid; drawn in
// TMDB's green-to-blue brand colours.
const TMDB_MARK = new Path2D('M6.62 12a2.291 2.291 0 0 1 2.292-2.295h-.013A2.291 2.291 0 0 1 11.189 12a2.291 2.291 0 0 1-2.29 2.291h.013A2.291 2.291 0 0 1 6.62 12zm10.72-4.062h4.266a2.291 2.291 0 0 0 2.29-2.291 2.291 2.291 0 0 0-2.29-2.296H17.34a2.291 2.291 0 0 0-2.291 2.296 2.291 2.291 0 0 0 2.29 2.29zM2.688 20.645h8.285a2.291 2.291 0 0 0 2.291-2.292 2.291 2.291 0 0 0-2.29-2.295H2.687a2.291 2.291 0 0 0-2.291 2.295 2.291 2.291 0 0 0 2.29 2.292zm10.881-6.354h.81l1.894-4.586H15.19l-1.154 3.008h-.013l-1.135-3.008h-1.154zm4.208 0h1.011V9.705h-1.011zm2.878 0h3.235v-.93h-2.223v-.933h1.99v-.934h-1.99v-.855h2.107v-.934h-3.112zM1.31 7.941h1.01V4.247h1.31v-.895H0v.895h1.31zm3.747 0h1.011V5.959h1.958v1.984h1.011v-4.59h-1.01v1.711H6.061V3.351H5.057zm5.348 0h3.242v-.933H11.41v-.934h1.99v-.933h-1.99v-.856h2.107v-.934h-3.112zM.162 14.296h1.005v-3.52h.013l1.167 3.52h.765l1.206-3.52h.013v3.52h1.011v-4.59H3.82L2.755 12.7h-.013L1.686 9.705H.156zm14.534 6.353h1.641a3.188 3.188 0 0 0 .98-.149 2.531 2.531 0 0 0 .824-.437 2.123 2.123 0 0 0 .567-.713 2.193 2.193 0 0 0 .223-.983 2.399 2.399 0 0 0-.218-1.07 1.958 1.958 0 0 0-.586-.716 2.405 2.405 0 0 0-.873-.392 4.349 4.349 0 0 0-1.046-.13h-1.519zm1.013-3.656h.596a2.26 2.26 0 0 1 .606.08 1.514 1.514 0 0 1 .503.244 1.167 1.167 0 0 1 .34.412 1.28 1.28 0 0 1 .13.587 1.546 1.546 0 0 1-.13.658 1.127 1.127 0 0 1-.347.433 1.41 1.41 0 0 1-.518.238 2.797 2.797 0 0 1-.649.07h-.538zm4.686 3.656h1.88a2.997 2.997 0 0 0 .613-.064 1.735 1.735 0 0 0 .554-.214 1.221 1.221 0 0 0 .402-.39 1.105 1.105 0 0 0 .155-.606 1.188 1.188 0 0 0-.071-.415 1.01 1.01 0 0 0-.204-.34 1.087 1.087 0 0 0-.317-.24 1.297 1.297 0 0 0-.413-.13v-.012a1.203 1.203 0 0 0 .575-.366.962.962 0 0 0 .216-.648 1.081 1.081 0 0 0-.149-.603 1.022 1.022 0 0 0-.389-.354 1.673 1.673 0 0 0-.54-.169 4.463 4.463 0 0 0-.6-.041h-1.712zm1.011-3.734h.687a1.4 1.4 0 0 1 .24.022.748.748 0 0 1 .22.075.432.432 0 0 1 .16.147.418.418 0 0 1 .061.236.47.47 0 0 1-.055.233.433.433 0 0 1-.146.156.62.62 0 0 1-.204.084 1.058 1.058 0 0 1-.23.026h-.745zm0 1.835h.765a1.96 1.96 0 0 1 .266.02 1.015 1.015 0 0 1 .26.07.519.519 0 0 1 .204.152.406.406 0 0 1 .08.26.481.481 0 0 1-.06.253.519.519 0 0 1-.16.168.62.62 0 0 1-.217.09 1.155 1.155 0 0 1-.237.027H21.4z');
function drawTmdbMark(ctx, x, cy, size) {
  const s = size / 24;
  ctx.save();
  ctx.translate(x, cy - size / 2);
  ctx.scale(s, s);
  const grad = ctx.createLinearGradient(0, 0, 24, 0);
  grad.addColorStop(0, '#90cea1');
  grad.addColorStop(1, '#01b4e4');
  ctx.fillStyle = grad;
  ctx.fill(TMDB_MARK);
  ctx.restore();
}

function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Streaming provider icon in the top-left: under the rank number when there is one,
// otherwise in the corner. (The top-right is left free for the app's "watched" tick.)
function drawProviderIcon(ctx, L, img, hasRank, offsetY = 0) {
  if (!img) return;
  const s = L.providerSize;
  const x = L.rankX + 10;
  const y = (hasRank ? L.providerTopRanked : L.providerTop) + offsetY;
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  roundedRectPath(ctx, x, y, s, s, s * 0.22);
  ctx.fill(); // shadow under the icon
  ctx.clip();
  ctx.shadowColor = 'transparent';
  ctx.drawImage(img, x, y, s, s);
  ctx.restore();
}

// Genre + rating ("Science Fiction  •  [TMDB logo] 8.4"), centred, optionally on a chip.
// bottomY = where the chip's bottom edge goes. Text is drawn slightly bold so it reads
// well on any artwork.
function drawMetaChip(ctx, L, info, bottomY) {
  if (!info || (!info.genre && !info.rating)) return;
  const f = L.metaFont;
  const h = L.metaChipH;
  const genre = info.genre ? String(info.genre) : '';
  const dot = genre && info.rating ? '  \u2022  ' : '';
  const rating = info.rating ? String(info.rating) : '';

  ctx.save();
  ctx.font = `600 ${f}px "Inter"`;
  const markSize = f * 1.5;                // TMDB logo, a bit taller than the text
  const markW = rating ? markSize + f * 0.3 : 0;
  const genreW = ctx.measureText(genre).width;
  const dotW = ctx.measureText(dot).width;
  const ratingW = ctx.measureText(rating).width;
  const contentW = genreW + dotW + markW + ratingW;
  const padX = 20;
  const w = Math.min(L.W - 40, contentW + padX * 2);
  const x0 = (L.W - w) / 2;
  const top = bottomY - h;

  if (META_CHIP) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(12, 12, 16, 0.62)';
    roundedRectPath(ctx, x0, top, w, h, h / 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    // no chip: a dark shadow behind the text keeps it readable on bright art
    ctx.shadowColor = 'rgba(0, 0, 0, 0.95)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
  }

  // text (faux-bold: fill + thin stroke in the same colour)
  let x = (L.W - contentW) / 2;
  const cy = top + h / 2 + 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 0.9;
  const boldText = (t, color) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.fillText(t, x, cy, L.W - 80);
    const shadow = ctx.shadowColor;
    ctx.shadowColor = 'transparent'; // shadow only once, from the fill
    ctx.strokeText(t, x, cy, L.W - 80);
    ctx.shadowColor = shadow;
  };
  if (genre) { boldText(genre, '#ffffff'); x += genreW; }
  if (dot) { boldText(dot, 'rgba(255, 255, 255, 0.7)'); x += dotW; }
  if (rating) {
    drawTmdbMark(ctx, x, cy - 1, markSize);
    x += markW;
    boldText(rating, '#ffffff');
  }
  ctx.restore();
}

function drawRank(ctx, rank, L, offsetY = 0) {
  ctx.save();
  ctx.font = `${L.rankFont}px "BebasNeue"`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.fillText(`${rank}`, L.rankX, L.rankY + offsetY);
  ctx.restore();
}

// Draws an image so it fills the whole canvas (crops the overflow).
function drawCover(ctx, img, L) {
  const scale = Math.max(L.W / img.width, L.H / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (L.W - w) / 2, (L.H - h) / 2, w, h);
}

// Title logo, centred above the pill, on a soft dark gradient so it stays readable.
function drawLogo(ctx, logoImg, L, hasTag, reserveBelow = 0) {
  const grad = ctx.createLinearGradient(0, L.H * L.gradTop, 0, L.H);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, L.W, L.H);

  const maxW = L.W * L.logoMaxW;
  const maxH = L.H * L.logoMaxH;
  const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height);
  const w = logoImg.width * scale;
  const h = logoImg.height * scale;
  const bottom = L.H - (hasTag ? L.pillH : 0) - 28 - reserveBelow;
  ctx.drawImage(logoImg, (L.W - w) / 2, bottom - h, w, h);
}

// Pure drawing step (also used by tests with fake images).
// Shared layout for posters and landscape art. Bottom stack, from the bottom edge up:
// [pill] -> [genre/rating chip] -> [title logo]. With the pill on top, the rank number and
// provider icon move down to clear it.
// RANK_STYLE: pill (default) -> the rank goes in the status pill as "Top 1 Today"
//                                (replacing the status text) and no big number is drawn.
//             number         -> big rank number on the side + the normal status pill.
const RANK_STYLE = String(process.env.RANK_STYLE || 'pill').toLowerCase() === 'number' ? 'number' : 'pill';

function drawOverlays(ctx, L, { rank, tag, logoImg, info, pillPosition }) {
  if (rank && RANK_STYLE === 'pill') {
    tag = `Top ${rank} Today`;
    rank = null; // no side number; the provider icon moves up into the corner
  }
  const pillTop = pillPosition === 'top' && !!tag;
  const pillBottom = !!tag && !pillTop;
  const hasMeta = !!(info && (info.genre || info.rating));
  const chipBottom = (pillBottom ? L.H - L.pillH : L.H) - L.metaGap;
  const aboveChip = hasMeta ? L.metaChipH + L.metaGap : 0;
  if (logoImg) drawLogo(ctx, logoImg, L, pillBottom, aboveChip + (pillBottom ? 0 : L.metaGap));
  if (hasMeta) drawMetaChip(ctx, L, info, chipBottom);

  // Only portrait posters are narrow enough for a 2-digit rank to hit a top pill,
  // and only the rank (with the icon under it) needs to move.
  const topOffset = pillTop && L.shiftForTopPill && rank ? L.pillH + 4 : 0;
  if (info) drawProviderIcon(ctx, L, info.providerImg, !!rank, topOffset);
  if (rank) drawRank(ctx, rank, L, topOffset);
  if (tag) drawTagPill(ctx, tag, L, pillTop ? 'top' : 'bottom');   // last, so it blurs the finished image
}

function composePoster(posterImg, rank, tag, logoImg = null, info = null) {
  const L = LAYOUTS.poster;
  const canvas = createCanvas(Math.round(L.W * L.S), Math.round(L.H * L.S));
  const ctx = canvas.getContext('2d');
  ctx.scale(L.S, L.S);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(posterImg, 0, 0, L.W, L.H);
  drawOverlays(ctx, L, { rank, tag, logoImg, info, pillPosition: PILL_POSITION });
  return canvas;
}

function composeBackdrop(backdropImg, logoImg, rank, tag, info = null) {
  const L = LAYOUTS.backdrop;
  const canvas = createCanvas(Math.round(L.W * L.S), Math.round(L.H * L.S));
  const ctx = canvas.getContext('2d');
  ctx.scale(L.S, L.S);
  ctx.imageSmoothingQuality = 'high';
  drawCover(ctx, backdropImg, L);
  drawOverlays(ctx, L, { rank, tag, logoImg, info, pillPosition: LANDSCAPE_PILL_POSITION });
  return canvas;
}

// Download the big version of an image, but if it's slow or fails use the smaller one,
// so a render never times out. Vercel caches the finished image, so this download only
// happens about once per title.
async function loadImageWithFallback(bigUrl, smallUrl, timeoutMs = 5000) {
  try {
    return await fetchImage(bigUrl, timeoutMs);
  } catch (e) {
    console.error('Large image slow/failed, using smaller one:', e.message);
    return fetchImage(smallUrl);
  }
}

// There are only a few dozen streaming services, so keep their icons in memory
// instead of downloading the same Netflix icon for every poster.
const providerIcons = new Map();
function loadProviderIcon(logoPath) {
  if (!logoPath) return null;
  if (!providerIcons.has(logoPath)) {
    const p = fetchImage(`https://image.tmdb.org/t/p/w154${logoPath}`)
      .catch(e => { console.error('Provider logo failed:', e.message); providerIcons.delete(logoPath); return null; });
    providerIcons.set(logoPath, p);
  }
  return providerIcons.get(logoPath);
}

function loadOneLogo(logoPath) {
  return loadImageWithFallback(
    `https://image.tmdb.org/t/p/original${logoPath}`,
    `https://image.tmdb.org/t/p/w500${logoPath}`
  ).catch(e => { console.error('Logo load failed:', e.message); return null; });
}

// A pixel counts as "coloured" when its strongest and weakest channels differ a lot
// (red, blue, ...); otherwise it's black, grey or white.
const isColoured = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b) >= 60;

// How the logo looks, measured on a small copy:
//   bright   (0-1) average of each visible pixel's brightest colour channel. Using the
//            brightest channel (not brightness as the eye sees it) means a strong red
//            counts as bright: Resident Evil's red logo scores 0.76, black scores 0.
//   coloured (0-1) share of visible pixels that are coloured: 0 for a plain black logo,
//            0.2 for Gachiakuta's black letters with a red outline.
function logoTone(img) {
  const w = 96;
  const h = Math.max(1, Math.round(img.height * w / img.width));
  const ctx = createCanvas(w, h).getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  let weight = 0, bright = 0, coloured = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < 0.15) continue;
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    bright += a * Math.max(r, g, b) / 255;
    if (isColoured(r, g, b)) coloured += a;
    weight += a;
  }
  return weight ? { bright: bright / weight, coloured: coloured / weight } : { bright: 1, coloured: 0 };
}
const isDark = tone => tone.bright < 0.3;

// A black/grey logo redrawn light: its black/grey parts are flipped to white/light grey,
// keeping their shading.
function lightenGreys(img) {
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, img.width, img.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]];
    if (!isColoured(r, g, b)) {
      px[i] = 255 - r; px[i + 1] = 255 - g; px[i + 2] = 255 - b;
    }
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

// Logos sit on a dark gradient, so a plain black logo is almost invisible. The best logo
// is kept as it is when it's bright (e.g. Resident Evil's red one) or when it's dark but
// has its own colours (e.g. Gachiakuta's black letters with a red outline). Only a plain
// black/grey logo is swapped for a light version of it when TMDB has one (e.g. Beast Race
// has black and white logos), or else redrawn light (see lightenGreys).
async function loadLogo(logoPaths) {
  if (!logoPaths?.length) return null;
  const [first, ...rest] = logoPaths;
  const img = await loadOneLogo(first);
  if (!img) return null;
  const tone = logoTone(img);
  if (!isDark(tone) || tone.coloured >= 0.05) return img;
  for (const other of await Promise.all(rest.map(loadOneLogo))) {
    if (other && !isDark(logoTone(other))) return other;
  }
  return lightenGreys(img);
}

// Encode in the background (doesn't block other renders running at the same time).
const JPEG_QUALITY = Math.min(95, Math.max(60,
  Number(process.env.JPEG_QUALITY) || (IMAGE_QUALITY === 'high' ? 92 : 85)));
const toJpeg = canvas => canvas.encode('jpeg', JPEG_QUALITY);

async function generatePoster(tmdbId, type = 'movie', rank = null, tag = null, opts = {}) {
  try {
    const { posterPath, logoPaths } = await getPosterAssets(type, tmdbId, opts.images, !!rank);
    if (!posterPath) throw new Error('Poster not found');
    const info = opts.info || null;
    const [posterImg, logoImg, providerImg] = await Promise.all([
      // Shrinking the full-size original gives a sharper poster than TMDB's w780 copy
      // (which is already compressed once). Falls back to w780 if it's slow.
      loadImageWithFallback(
        `https://image.tmdb.org/t/p/original${posterPath}`,
        `https://image.tmdb.org/t/p/w780${posterPath}`
      ),
      loadLogo(logoPaths),
      loadProviderIcon(info?.providerLogoPath)
    ]);
    const infoForDraw = info ? { genre: info.genre, rating: info.rating, providerImg } : null;
    return await toJpeg(composePoster(posterImg, rank, tag, logoImg, infoForDraw));
  } catch (err) {
    console.error('Error generating poster:', err.message);
    return null;
  }
}

async function generateBackdrop(tmdbId, type = 'movie', rank = null, tag = null, opts = {}) {
  try {
    const { backdropPath, logoPaths } = await getBackdropAssets(type, tmdbId, opts.images);
    if (!backdropPath) throw new Error('Backdrop not found');
    const info = opts.info || null;
    const [backdropImg, logoImg, providerImg] = await Promise.all([
      // Full-size original, shrunk to our size; falls back to w1280 if slow.
      loadImageWithFallback(
        `https://image.tmdb.org/t/p/original${backdropPath}`,
        `https://image.tmdb.org/t/p/w1280${backdropPath}`
      ),
      loadLogo(logoPaths),
      loadProviderIcon(info?.providerLogoPath)
    ]);
    const infoForDraw = info ? { genre: info.genre, rating: info.rating, providerImg } : null;
    return await toJpeg(composeBackdrop(backdropImg, logoImg, rank, tag, infoForDraw));
  } catch (err) {
    console.error('Error generating backdrop:', err.message);
    if (opts.throwErrors) throw err;   // used by ?debug=1 so you can see the real error
    return null;
  }
}

module.exports = { generatePoster, generateBackdrop, composePoster, composeBackdrop };