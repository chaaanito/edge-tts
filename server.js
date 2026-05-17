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
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// Initialize PocketBase once globally
const PB_URL = "http://pocketbase:8090";
const pb = new PocketBase(PB_URL);

async function checkPbAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized: Missing token" });
    }

    const token = authHeader.split(" ")[1];
    const collectionName = req.body.collectionName || "users"; // Avoid defaulting blindly to ADMIN collections if unsafe

    // Use a separate auth store state per request to avoid race conditions between simultaneous requests
    pb.authStore.save(token, null);
    await pb.collection(collectionName).authRefresh();

    next();
  } catch (err) {
    // Clear auth store on failure
    pb.authStore.clear();
    return res
      .status(401)
      .json({ error: "Unauthorized: Invalid or expired token" });
  }
}

app.post("/api/tts", checkPbAuth, async (req, res) => {
  let audioPath = "";
  let subtitlePath = "";

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

    const baseName = `tts-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    audioPath = path.join(TEMP_DIR, `${baseName}.mp3`);
    subtitlePath = path.join(TEMP_DIR, `${baseName}.json`);

    // Generate the TTS file
    await tts.ttsPromise(text, audioPath);

    if (!fs.existsSync(audioPath)) {
      throw new Error("TTS file was not created by the engine.");
    }

    // Set headers for file streaming
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Disposition", 'inline; filename="speech.mp3"');

    const audioStream = fs.createReadStream(audioPath);

    // Handle stream reading errors safely
    audioStream.on("error", (streamErr) => {
      console.error("[Stream Error]", streamErr);
      if (!res.headersSent) {
        res.status(500).json({ error: "Read stream failed" });
      }
      cleanupFiles(audioPath, subtitlePath);
    });

    audioStream.pipe(res);

    // Clean up ONLY after response has finished sending over the network
    res.on("finish", () => {
      cleanupFiles(audioPath, subtitlePath);
    });
  } catch (err) {
    console.error("[TTS ERROR]", err);
    cleanupFiles(audioPath, subtitlePath);
    if (!res.headersSent) {
      res.status(500).json({ error: "TTS generation failed" });
    }
  }
});

// Helper function to safely delete files without blocking or throwing unhandled rejections
function cleanupFiles(audio, subtitle) {
  if (audio && fs.existsSync(audio)) {
    fs.unlink(audio, (err) => {
      if (err) console.error(`Failed to delete ${audio}`, err);
    });
  }
  if (subtitle && fs.existsSync(subtitle)) {
    fs.unlink(subtitle, (err) => {
      if (err) console.error(`Failed to delete ${subtitle}`, err);
    });
  }
}

app.listen(3000, () => {
  console.log("🚀 TTS API running at http://localhost:3000/api/tts");
});
