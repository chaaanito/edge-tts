import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { EdgeTTS } from "node-edge-tts";
import PocketBase from "pocketbase";

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const TEMP_DIR = path.join(process.cwd(), "tmp");
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

async function checkPbAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: Missing token" });
    }

    const token = authHeader.split(" ")[1];

    const collectionName = req.body.collectionName || "0_AUTH_ADMIN";

    const pb = new PocketBase("http://pocketbase:8090");
    pb.authStore.save(token, null);

    await pb.collection(collectionName).authRefresh();

    next();
  } catch (err) {
    return res
      .status(401)
      .json({ error: "Unauthorized: Invalid or expired token" });
  }
}

app.post("/api/tts", checkPbAuth, async (req, res) => {
  try {
    const {
      text,
      voice = "en-US-AriaNeural",
      lang = "en-US",
      rate = "default",
      pitch = "default",
      volume = "default",
      outputFormat = "audio-24khz-48kbitrate-mono-mp3",
      saveSubtitles = false,
      timeout = 10000,
      collectionName,
    } = req.body;

    if (!text || typeof text !== "string") {
      return res.status(400).json({ error: "text is required" });
    }

    const tts = new EdgeTTS({
      voice,
      lang,
      rate,
      pitch,
      volume,
      outputFormat,
      saveSubtitles,
      timeout,
    });

    const baseName = `tts-${Date.now()}`;
    const audioPath = path.join(TEMP_DIR, `${baseName}.mp3`);
    const subtitlePath = path.join(TEMP_DIR, `${baseName}.json`);

    await tts.ttsPromise(text, audioPath);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", 'inline; filename="speech.mp3"');

    const audioStream = fs.createReadStream(audioPath);
    audioStream.pipe(res);

    audioStream.on("close", () => {
      fs.unlink(audioPath, () => {});
      if (saveSubtitles && fs.existsSync(subtitlePath)) {
        fs.unlink(subtitlePath, () => {});
      }
    });
  } catch (err) {
    console.error("[TTS ERROR]", err);
    res.status(500).json({ error: "TTS generation failed" });
  }
});

app.listen(3000, () => {
  console.log("🚀 TTS API running at http://localhost:3000/api/tts");
});
