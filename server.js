const express = require("express");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const TMP = path.join(__dirname, "tmp");
if (!fs.existsSync(TMP)) fs.mkdirSync(TMP, { recursive: true });

const PORT = process.env.PORT || 3000;
const S3_BUCKET = process.env.S3_BUCKET || "";
const AWS_REGION = process.env.AWS_REGION || "";
const PRESIGN_EXP = parseInt(process.env.PRESIGN_EXP || "3600", 10);
const API_SECRET = process.env.YT_API_SECRET || ""; // optional
const API_SECRET_HEADER = process.env.YT_API_SECRET_HEADER || "x-api-key";

let s3 = null;
if (S3_BUCKET && AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  s3 = new S3Client({ region: AWS_REGION });
}

function runCmd(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", d => out += d.toString());
    p.stderr.on("data", d => err += d.toString());
    p.on("close", code => code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`)));
    p.on("error", reject);
    if (opts.timeout && opts.timeout > 0) {
      setTimeout(() => {
        p.kill("SIGKILL");
        reject(new Error("process timeout"));
      }, opts.timeout);
    }
  });
}

async function ytInfo(videoId) {
  const out = await runCmd("yt-dlp", ["-j", `https://youtube.com/watch?v=${videoId}`], { timeout: 120000 });
  return JSON.parse(out);
}

async function ytSearch(q, max = 6) {
  const out = await runCmd("yt-dlp", ["--dump-json", `ytsearch${max}:${q}`], { timeout: 120000 });
  return out.split(/\r?\n/).filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

async function downloadWithYtDlp(videoId, format, destPath) {
  if (format === "mp3") {
    await runCmd("yt-dlp", ["-x", "--audio-format", "mp3", "-o", destPath, `https://youtube.com/watch?v=${videoId}`], { timeout: 0 });
  } else {
    await runCmd("yt-dlp", ["-f", "best[ext=mp4]/best", "-o", destPath, `https://youtube.com/watch?v=${videoId}`], { timeout: 0 });
  }
  if (!fs.existsSync(destPath)) throw new Error("download failed: file missing");
  return destPath;
}

async function uploadToS3(localPath, key) {
  const fileStream = fs.createReadStream(localPath);
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: fileStream,
    ContentType: key.endsWith(".mp3") ? "audio/mpeg" : "video/mp4"
  }));
  const cmd = new PutObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return await getSignedUrl(s3, cmd, { expiresIn: PRESIGN_EXP });
}

const app = express();
app.use(express.json());

// simple auth middleware (optional)
app.use((req, res, next) => {
  if (!API_SECRET) return next();
  const val = req.headers[API_SECRET_HEADER];
  if (!val || val !== API_SECRET) return res.status(401).json({ error: "unauthorized" });
  next();
});

app.get("/ping", (req, res) => res.json({ ok: true, ts: Date.now() }));

app.get("/ytFullSearch", async (req, res) => {
  try {
    const q = req.query.songName || req.query.q;
    if (!q) return res.status(400).json([]);
    const max = Math.min(12, parseInt(req.query.max || "6", 10));
    const items = await ytSearch(q, max);
    const mapped = items.map(i => ({
      id: i.id,
      title: i.title,
      thumbnail: i.thumbnail,
      duration: i.duration,
      uploader: i.uploader
    }));
    return res.json(mapped);
  } catch (e) {
    console.error("ytFullSearch error:", e && e.message ? e.message : e);
    return res.status(500).json([]);
  }
});

app.get("/ytfullinfo", async (req, res) => {
  try {
    const id = req.query.videoID || req.query.id;
    if (!id) return res.status(400).json({ error: "videoID required" });
    const info = await ytInfo(id);
    return res.json({
      id: info.id,
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration,
      uploader: info.uploader,
      formats: info.formats || []
    });
  } catch (e) {
    console.error("ytfullinfo error:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "failed to get info", detail: e && e.message ? e.message : String(e) });
  }
});

app.get("/ytDl3", async (req, res) => {
  try {
    const link = req.query.link;
    const format = (req.query.format || "mp4").toLowerCase();
    if (!link) return res.status(400).json({ error: "link required" });

    const id = (link.length === 11 && /^[A-Za-z0-9_-]{11}$/.test(link)) ? link : link;
    const outName = `out_${Date.now()}_${uuidv4()}.${format}`;
    const outPath = path.join(TMP, outName);

    await downloadWithYtDlp(id, format, outPath);

    if (s3) {
      const key = `yt/${outName}`;
      const presigned = await uploadToS3(outPath, key);
      try { fs.unlinkSync(outPath); } catch (e) {}
      return res.json({ downloadLink: presigned, storage: "s3" });
    } else {
      return res.json({ downloadLink: `${req.protocol}://${req.get("host")}/download/${outName}`, storage: "local" });
    }
  } catch (e) {
    console.error("ytDl3 error:", e && e.message ? e.message : e);
    return res.status(500).json({ error: "failed to prepare download", detail: e && e.message ? e.message : String(e) });
  }
});

app.get("/download/:name", (req, res) => {
  try {
    const name = req.params.name;
    const p = path.join(TMP, name);
    if (!fs.existsSync(p)) return res.status(404).send("Not found");
    res.download(p, name, err => {
      if (err) console.error("download send error:", err);
      try { fs.unlinkSync(p); } catch (e) {}
    });
  } catch (e) {
    console.error("download route error:", e && e.message ? e.message : e);
    res.status(500).send("error");
  }
});

app.listen(PORT, () => console.log("listening on", PORT));
