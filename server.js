// Starts the addon as a normal server (for Docker / your own VPS).
// On Vercel this file isn't used: Vercel runs index.js itself.
const axios = require('axios');
const app = require('./index.js');

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => console.log(`Addon running on port ${PORT}`));

// Daily warm-up (replaces the Vercel cron in vercel.json): just after the Top 10 list
// switches at midnight, draw every Top 10 image once so the app opens fast.
// WARM_AT=HH:MM in RANK_TZ (default 00:10). WARM_AT=off turns it off.
const WARM_AT = process.env.WARM_AT || '00:10';
const RANK_TZ = process.env.RANK_TZ || 'Pacific/Auckland';
let lastWarmDay = '';

async function warm() {
  const headers = process.env.CRON_SECRET ? { Authorization: `Bearer ${process.env.CRON_SECRET}` } : {};
  for (const type of ['movie', 'series']) {
    try {
      const { data } = await axios.get(`http://127.0.0.1:${PORT}/warm?type=${type}`, { headers, timeout: 10 * 60 * 1000 });
      console.log(`Warm-up ${type}: ${data.ok}/${data.images} images in ${data.ms} ms`);
    } catch (e) {
      console.error(`Warm-up ${type} failed:`, e.message);
    }
  }
}

if (WARM_AT !== 'off') {
  setInterval(() => {
    const now = new Date();
    const day = now.toLocaleDateString('en-CA', { timeZone: RANK_TZ });
    const time = now.toLocaleTimeString('en-GB', { timeZone: RANK_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    if (time === WARM_AT && day !== lastWarmDay) {
      lastWarmDay = day;
      warm();
    }
  }, 30 * 1000).unref();
}
