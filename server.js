require("dotenv").config();

const express = require("express");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
// Storage lives next to the app unless DROP_HARBOR_STORAGE_ROOT points elsewhere.
const STORAGE_ROOT = process.env.DROP_HARBOR_STORAGE_ROOT || __dirname;
const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
const DATA_DIR = path.join(STORAGE_ROOT, "data");
const METADATA_PATH = path.join(DATA_DIR, "files.json");
const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB || 1024);
const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN || "";
const SWEEP_INTERVAL_MINUTES = Number(process.env.SWEEP_INTERVAL_MINUTES || 5);
const DEFAULT_EXPIRY_HOURS = Number(process.env.DEFAULT_EXPIRY_HOURS || 168);
const MAX_EXPIRY_HOURS = Number(process.env.MAX_EXPIRY_HOURS || 8760);
const MAX_FILES_PER_UPLOAD = 12;
// An upload is on disk before its metadata record is written. Orphan cleanup
// ignores anything younger than this so a sweep cannot delete a live upload.
const ORPHAN_GRACE_MS = 60 * 60 * 1000;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

if (!fs.existsSync(METADATA_PATH)) {
  fs.writeFileSync(METADATA_PATH, "[]\n", "utf8");
}

function readMetadata() {
  try {
    const parsed = JSON.parse(fs.readFileSync(METADATA_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("Failed to read file metadata:", error);
    return [];
  }
}

function writeMetadata(files) {
  fs.writeFileSync(METADATA_PATH, `${JSON.stringify(files, null, 2)}\n`, "utf8");
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function sanitizeName(filename) {
  return filename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 120) || "file";
}

// path.extname returns whatever the client sent, including NTFS stream
// suffixes and 200 character tails. Cut it down to a short safe token.
function sanitizeExtension(extension) {
  const cleaned = extension.replace(/[^\w.]+/g, "").replace(/\.+/g, ".").slice(0, 16);
  return /^\.\w+$/.test(cleaned) ? cleaned.toLowerCase() : "";
}

// Resolve a stored name against the upload directory and refuse anything that
// lands outside it, whatever the metadata file claims.
function resolveStoredPath(storedName) {
  if (typeof storedName !== "string" || !storedName) {
    return null;
  }

  const absolutePath = path.resolve(UPLOAD_DIR, storedName);
  const root = path.resolve(UPLOAD_DIR) + path.sep;
  return absolutePath.startsWith(root) ? absolutePath : null;
}

function hoursToExpiry(rawHours) {
  const hours = Number(rawHours);

  if (!Number.isInteger(hours) || hours < 0) {
    return { ok: false };
  }

  if (hours === 0) {
    return { ok: true, expiresAt: null };
  }

  if (hours > MAX_EXPIRY_HOURS) {
    return { ok: false };
  }

  return { ok: true, expiresAt: new Date(Date.now() + hours * 3600 * 1000).toISOString() };
}

function isExpired(file, now = Date.now()) {
  if (!file.expiresAt) {
    return false;
  }

  const expiry = new Date(file.expiresAt).getTime();
  return Number.isFinite(expiry) && expiry <= now;
}

function deleteStoredFile(storedName) {
  const absolutePath = resolveStoredPath(storedName);

  if (absolutePath) {
    fs.rmSync(absolutePath, { force: true });
  }
}

// Drop expired records and their files, then drop any file in uploads/ that no
// record claims. Aborted uploads leave those orphans behind.
function sweep() {
  const now = Date.now();
  const files = readMetadata();
  const live = files.filter((file) => !isExpired(file, now));
  const removed = files.length - live.length;

  for (const file of files) {
    if (isExpired(file, now)) {
      deleteStoredFile(file.storedName);
    }
  }

  if (removed > 0) {
    writeMetadata(live);
  }

  const claimed = new Set(live.map((file) => file.storedName));
  let orphans = 0;

  for (const entry of fs.readdirSync(UPLOAD_DIR)) {
    if (claimed.has(entry)) {
      continue;
    }

    // A file this new may be an upload still in flight, with its metadata
    // record not written yet. Leave it for the next sweep.
    const absolutePath = resolveStoredPath(entry);
    if (absolutePath) {
      try {
        if (now - fs.statSync(absolutePath).mtimeMs < ORPHAN_GRACE_MS) {
          continue;
        }
      } catch {
        continue;
      }
    }

    deleteStoredFile(entry);
    orphans += 1;
  }

  if (removed > 0 || orphans > 0) {
    console.log(`Sweep removed ${removed} expired file(s) and ${orphans} orphan(s).`);
  }

  return { removed, orphans };
}

function publicFile(file) {
  return {
    id: file.id,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    sizeLabel: file.sizeLabel,
    uploadedAt: file.uploadedAt,
    expiresAt: file.expiresAt || null,
    downloadPath: file.downloadPath
  };
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const rawExtension = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, rawExtension);
    const safeName = sanitizeName(baseName);
    const extension = sanitizeExtension(rawExtension);
    const uniqueSuffix = crypto.randomBytes(6).toString("hex");
    cb(null, `${safeName}-${uniqueSuffix}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    files: MAX_FILES_PER_UPLOAD,
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024
  }
});

// Runs before multer, so a request with a bad token never writes to disk.
function requireToken(req, res, next) {
  if (!UPLOAD_TOKEN) {
    return next();
  }

  const provided = req.get("x-upload-token") || "";
  const expected = Buffer.from(UPLOAD_TOKEN);
  const actual = Buffer.from(provided);

  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return res.status(401).json({ error: "A valid upload token is required." });
  }

  return next();
}

app.disable("x-powered-by");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    uploadProtected: Boolean(UPLOAD_TOKEN),
    maxFileSizeMb: MAX_FILE_SIZE_MB,
    defaultExpiryHours: DEFAULT_EXPIRY_HOURS,
    maxExpiryHours: MAX_EXPIRY_HOURS
  });
});

app.get("/api/files", (_req, res) => {
  const now = Date.now();
  const files = readMetadata()
    .filter((file) => !isExpired(file, now))
    .sort((left, right) => new Date(right.uploadedAt).getTime() - new Date(left.uploadedAt).getTime())
    .map(publicFile);

  res.json({
    files,
    uploadProtected: Boolean(UPLOAD_TOKEN),
    maxFileSizeMb: MAX_FILE_SIZE_MB,
    defaultExpiryHours: DEFAULT_EXPIRY_HOURS,
    maxExpiryHours: MAX_EXPIRY_HOURS
  });
});

app.post("/api/upload", requireToken, upload.array("files", MAX_FILES_PER_UPLOAD), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "Select at least one file to upload." });
  }

  const requested = req.body.expiryHours;
  const expiry = hoursToExpiry(
    requested === undefined || requested === "" ? DEFAULT_EXPIRY_HOURS : requested
  );

  if (!expiry.ok) {
    for (const file of req.files) {
      deleteStoredFile(file.filename);
    }

    return res.status(400).json({
      error: `Expiry must be 0 (never) or between 1 and ${MAX_EXPIRY_HOURS} hours.`
    });
  }

  const uploadedAt = new Date().toISOString();
  const createdEntries = req.files.map((file) => {
    const id = crypto.randomUUID();

    return {
      id,
      originalName: file.originalname,
      storedName: file.filename,
      mimeType: file.mimetype || "application/octet-stream",
      size: file.size,
      sizeLabel: formatBytes(file.size),
      uploadedAt,
      expiresAt: expiry.expiresAt,
      downloadPath: `/download/${id}`
    };
  });

  writeMetadata([...createdEntries, ...readMetadata()]);

  res.status(201).json({
    message: `${createdEntries.length} file${createdEntries.length === 1 ? "" : "s"} uploaded successfully.`,
    files: createdEntries.map(publicFile)
  });
});

app.delete("/api/files/:id", requireToken, (req, res) => {
  const files = readMetadata();
  const file = files.find((entry) => entry.id === req.params.id);

  if (!file) {
    return res.status(404).json({ error: "File not found." });
  }

  deleteStoredFile(file.storedName);
  writeMetadata(files.filter((entry) => entry.id !== file.id));

  res.json({ message: `Deleted ${file.originalName}.`, id: file.id });
});

app.get("/download/:id", (req, res) => {
  const files = readMetadata();
  const file = files.find((entry) => entry.id === req.params.id);

  if (!file) {
    return res.status(404).send("File not found.");
  }

  if (isExpired(file)) {
    deleteStoredFile(file.storedName);
    writeMetadata(files.filter((entry) => entry.id !== file.id));
    return res.status(410).send("This link has expired.");
  }

  const absolutePath = resolveStoredPath(file.storedName);

  if (!absolutePath || !fs.existsSync(absolutePath)) {
    return res.status(410).send("File is no longer available.");
  }

  return res.download(absolutePath, file.originalName);
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? `That file is too large. Max size is ${MAX_FILE_SIZE_MB} MB.`
      : error.message;

    return res.status(400).json({ error: message });
  }

  console.error("Unhandled error:", error);
  return res.status(500).json({ error: "Something went wrong on the server." });
});

function start() {
  sweep();
  const timer = setInterval(sweep, Math.max(1, SWEEP_INTERVAL_MINUTES) * 60 * 1000);
  timer.unref();

  return app.listen(PORT, HOST, () => {
    console.log(`Drop Harbor running on http://${HOST}:${PORT}`);

    if (!UPLOAD_TOKEN) {
      console.warn("UPLOAD_TOKEN is not set. Anyone who can reach this server can upload.");
    }
  });
}

if (require.main === module) {
  start();
}

module.exports = { app, start, sweep };
