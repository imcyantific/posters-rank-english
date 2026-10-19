// Disk cache for rendered images, for running on your own server (no Vercel CDN).
// Turned on by setting CACHE_DIR (e.g. /cache in Docker). CACHE_MAX_GB (default 2) caps
// how much disk space it may use.
//
// Works like the CDN did: each image is saved under its exact URL and kept for the
// response's s-maxage. After that, if the response allowed stale-while-revalidate, the
// old copy is still served instantly while a fresh one is drawn in the background.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');

function parseCacheControl(value) {
  const get = name => {
    const m = new RegExp(`${name}=(\\d+)`).exec(value || '');
    return m ? Number(m[1]) : 0;
  };
  return { sMaxAge: get('s-maxage'), swr: get('stale-while-revalidate') };
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

function diskCache(dir, { selfUrl, maxGB = 2 }) {
  const maxBytes = maxGB * 1e9;
  fs.mkdirSync(dir, { recursive: true });
  const refreshing = new Set();
  const files = url => {
    const key = crypto.createHash('sha1').update(url).digest('hex');
    return { img: path.join(dir, `${key}.img`), meta: path.join(dir, `${key}.json`) };
  };

  // Draw a fresh copy in the background (the request goes back into this same server).
  function refresh(url) {
    if (refreshing.has(url)) return;
    refreshing.add(url);
    axios.get(`${selfUrl()}${url}`, { headers: { 'x-cache-refresh': '1' }, responseType: 'arraybuffer', timeout: 60000 })
      .catch(e => console.error('Background refresh failed:', url, e.message))
      .finally(() => refreshing.delete(url));
  }

  // Clean-up, at start and every hour:
  //  1. delete images whose stale time has passed,
  //  2. if the cache is still bigger than CACHE_MAX_GB, delete the ones closest to
  //     expiring until it's under 90% of the limit, so the disk can never fill up.
  async function prune() {
    const now = Date.now();
    const entries = [];
    let expired = 0;
    for (const name of await fsp.readdir(dir).catch(() => [])) {
      const full = path.join(dir, name);
      if (name.endsWith('.tmp')) { // leftover from a crash
        const st = await fsp.stat(full).catch(() => null);
        if (st && now - st.mtimeMs > 3600 * 1000) await fsp.rm(full, { force: true });
        continue;
      }
      if (!name.endsWith('.json')) continue;
      const img = full.replace(/\.json$/, '.img');
      try {
        const meta = JSON.parse(await fsp.readFile(full, 'utf8'));
        if (meta.staleUntil < now) {
          await fsp.rm(full, { force: true });
          await fsp.rm(img, { force: true });
          expired++;
        } else {
          const st = await fsp.stat(img);
          entries.push({ meta: full, img, size: st.size, staleUntil: meta.staleUntil });
        }
      } catch (e) { /* half-written file: ignore */ }
    }
    let total = entries.reduce((sum, e) => sum + e.size, 0);
    let trimmed = 0;
    if (total > maxBytes) {
      entries.sort((a, b) => a.staleUntil - b.staleUntil);
      for (const e of entries) {
        if (total <= maxBytes * 0.9) break;
        await fsp.rm(e.meta, { force: true });
        await fsp.rm(e.img, { force: true });
        total -= e.size;
        trimmed++;
      }
    }
    if (expired || trimmed) {
      console.log(`Disk cache: removed ${expired} expired + ${trimmed} to stay under the size limit; now ${(total / 1e9).toFixed(2)} GB`);
    }
  }
  prune();
  setInterval(prune, 3600 * 1000).unref();

  return async function diskCacheMiddleware(req, res, next) {
    if (req.method !== 'GET' || req.query.debug) return next();
    const url = req.originalUrl;
    const f = files(url);

    // Serve from disk if we have it
    if (!req.headers['x-cache-refresh']) {
      try {
        const meta = JSON.parse(await fsp.readFile(f.meta, 'utf8'));
        const now = Date.now();
        if (now < meta.staleUntil) {
          const body = await fsp.readFile(f.img);
          const fresh = now < meta.expires;
          if (!fresh) refresh(url);
          res.setHeader('Content-Type', meta.type);
          res.setHeader('Cache-Control', meta.cacheControl);
          res.setHeader('X-Disk-Cache', fresh ? 'HIT' : 'STALE');
          return res.send(body);
        }
      } catch (e) { /* not cached yet */ }
    }

    // Not cached: let the route draw it, then save the result
    const send = res.send.bind(res);
    res.send = body => {
      const type = String(res.getHeader('Content-Type') || '');
      const cacheControl = String(res.getHeader('Cache-Control') || '');
      const { sMaxAge, swr } = parseCacheControl(cacheControl);
      if (res.statusCode === 200 && type.startsWith('image/') && sMaxAge > 0 && Buffer.isBuffer(body)) {
        const now = Date.now();
        const meta = { url, type, cacheControl, expires: now + sMaxAge * 1000, staleUntil: now + (sMaxAge + swr) * 1000 };
        // Image first, then meta, each written to a temp file and renamed, so a
        // half-written file is never served
        writeAtomic(f.img, body)
          .then(() => writeAtomic(f.meta, JSON.stringify(meta)))
          .catch(e => console.error('Disk cache write failed:', e.message));
        res.setHeader('X-Disk-Cache', 'MISS');
      }
      return send(body);
    };
    next();
  };
}

module.exports = { diskCache };
