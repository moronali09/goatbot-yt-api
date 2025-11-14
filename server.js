const express = require('express');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');

const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL;  
if (!REDIS_URL) console.warn('Warning: REDIS_URL not set - worker queue disabled');

const redis = REDIS_URL ? new Redis(REDIS_URL) : null;
const app = express();
app.use(express.json());

app.get('/ping', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.post('/download', async (req, res) => {
  const { videoID, format='mp4', callbackUrl } = req.body;
  if (!videoID) return res.status(400).json({ error: 'videoID required' });
  const job = { id: uuidv4(), videoID, format, callbackUrl, createdAt: Date.now() };
  if (redis) {
    await redis.lpush('yt_jobs', JSON.stringify(job));
    return res.json({ enqueued: true, job });
  } else {
    return res.status(503).json({ error: 'Worker queue not configured (set REDIS_URL)' });
  }
});

app.listen(PORT, () => console.log('API listening on', PORT));
