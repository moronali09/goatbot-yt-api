const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Redis = require('ioredis');
const { uploadToS3 } = require('./upload-s3');

const TMP = path.join(__dirname, 'tmp');
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

const redis = new Redis(process.env.REDIS_URL);
async function popJob() {
  while (true) {
    try {
      const raw = await redis.brpop('yt_jobs', 0);  
      if (!raw) continue;
      const job = JSON.parse(raw[1]);
      console.log('got job', job.id, job.videoID);
      await handleJob(job);
    } catch (e) {
      console.error('worker error', e);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

async function handleJob(job) {
  const id = job.id;
  const format = job.format === 'mp3' ? 'mp3' : 'mp4';
  const outName = `${id}.${format}`;
  const outPath = path.join(TMP, outName);

  const args = format === 'mp3'
    ? ['-x','--audio-format','mp3','-o', outPath, `https://youtube.com/watch?v=${job.videoID}`]
    : ['-f','best[ext=mp4]/best','-o', outPath, `https://youtube.com/watch?v=${job.videoID}`];

  await runCmd('yt-dlp', args, { timeout: 0 });

  if (process.env.S3_BUCKET) {
    const s3Url = await uploadToS3(outPath, outName);
    console.log('uploaded', s3Url);
    if (job.callbackUrl) {
      try { await fetch(job.callbackUrl, { method:'POST', body: JSON.stringify({ jobId: id, url: s3Url }), headers: {'content-type':'application/json'} }); } catch(e){ console.warn('callback failed', e); }
    }
    fs.unlinkSync(outPath);
  } else {
  }
}

function runCmd(cmd, args, opts={}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit' });
    p.on('close', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)));
    p.on('error', reject);
  });
}

popJob();
