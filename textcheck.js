// Spots posters that TMDB tags as "textless" but that really have a printed title
// (often a Russian or other foreign one). Used before we draw our own logo on top.
//
// How: OCR (tesseract.js) can't read text on busy artwork, so we first make two
// black-and-white copies of the poster, one keeping only near-white pixels and one
// keeping only near-black pixels. Titles are usually bright or dark, so they
// survive while the artwork mostly disappears. If OCR finds real words in either
// copy, the poster has text.
//
// TEXTLESS_CHECK=off in Vercel turns this off.
const path = require('path');
const axios = require('axios');
const { createCanvas, loadImage } = require('@napi-rs/canvas');

const ENABLED = String(process.env.TEXTLESS_CHECK || 'on').toLowerCase() !== 'off';

let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = require('tesseract.js');
      const worker = await createWorker(['eng', 'rus'], 1, {
        langPath: path.join(__dirname, 'tessdata'),
        gzip: true,
        cacheMethod: 'none'
      });
      await worker.setParameters({ tessedit_pageseg_mode: '11' }); // sparse text: words anywhere
      return worker;
    })().catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// Keep only near-white (mode 'bright') or near-black (mode 'dark') pixels, drawn
// as black text on white, which is what OCR reads best.
function isolate(img, mode) {
  const W = img.width, H = img.height;
  const c = createCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, W, H);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const light = 0.3 * r + 0.59 * g + 0.11 * b;
    const keep = mode === 'bright'
      ? light > 215 && Math.max(r, g, b) - Math.min(r, g, b) < 40
      : light < 35;
    const v = keep ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return c.toBuffer('image/png');
}

// Real words only: confident, with at least 3 letters. Random art gives short junk.
function realWords(data) {
  const words = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        for (const w of line.words || []) {
          if (w.confidence >= 70 && /\p{L}{3,}/u.test(w.text)) words.push(w.text);
        }
      }
    }
  }
  return words;
}

async function findWords(buffer) {
  const worker = await getWorker();
  const img = await loadImage(buffer);
  const words = [];
  for (const mode of ['bright', 'dark']) {
    const { data } = await worker.recognize(isolate(img, mode), {}, { blocks: true });
    words.push(...realWords(data));
  }
  return words;
}

// One long word (4+ letters) or two shorter ones = the poster has text.
function looksLikeText(words) {
  return words.some(w => w.replace(/[^\p{L}]/gu, '').length >= 4) || words.length >= 2;
}

const cache = new Map(); // file_path -> true/false, kept while the server is warm

// true = has text, false = clean. Errors count as clean, so a broken check
// never breaks an image (it just behaves like before).
async function posterHasText(filePath) {
  if (!ENABLED) return false;
  if (cache.has(filePath)) return cache.get(filePath);
  let result = false;
  try {
    const { data } = await axios.get(`https://image.tmdb.org/t/p/w500${filePath}`, {
      responseType: 'arraybuffer', timeout: 5000
    });
    const words = await findWords(Buffer.from(data));
    result = looksLikeText(words);
    if (result) console.log('Textless poster has text, skipping:', filePath, words.slice(0, 5));
  } catch (e) {
    console.error('Text check failed, using poster anyway:', e.message);
    return false; // not cached, so it's tried again next time
  }
  if (cache.size > 2000) cache.clear();
  cache.set(filePath, result);
  return result;
}

module.exports = { posterHasText, findWords, looksLikeText };
