const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Point the server at a throwaway storage root before requiring it. The server
// reads its config and creates uploads/ and data/ at module load, so this has
// to happen first or the test would write into the real repo directories.
const STORAGE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "drop-harbor-test-"));
process.env.DROP_HARBOR_STORAGE_ROOT = STORAGE_ROOT;
process.env.UPLOAD_TOKEN = "test-token";
process.env.MAX_EXPIRY_HOURS = "8760";

const { app, sweep, parseNumericEnv, validateUploadAuth } = require("../server.js");

const UPLOAD_DIR = path.join(STORAGE_ROOT, "uploads");
const METADATA_PATH = path.join(STORAGE_ROOT, "data", "files.json");

let server;
let baseUrl;

test.before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.close();
  fs.rmSync(STORAGE_ROOT, { recursive: true, force: true });
});

function readMetadata() {
  return JSON.parse(fs.readFileSync(METADATA_PATH, "utf8"));
}

// expiryHours is optional so a caller can exercise the validation path.
function uploadBody(filename, contents, expiryHours) {
  const form = new FormData();
  form.set("files", new File([contents], filename));

  if (expiryHours !== undefined) {
    form.set("expiryHours", String(expiryHours));
  }

  return form;
}

function upload(filename, contents, expiryHours, token = "test-token") {
  return fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: token === null ? {} : { "x-upload-token": token },
    body: uploadBody(filename, contents, expiryHours)
  });
}

function uploadFiles(entries, expiryHours, token = "test-token") {
  const form = new FormData();
  for (const [filename, contents] of entries) {
    form.append("files", new File([contents], filename));
  }
  form.set("expiryHours", String(expiryHours));

  return fetch(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: token === null ? {} : { "x-upload-token": token },
    body: form
  });
}

test("health reports the upload is token protected", async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.strictEqual(response.status, 200);

  const body = await response.json();
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.uploadProtected, true);
  assert.strictEqual(body.maxExpiryHours, 8760);
});

test("upload, list, download, delete round trip", async () => {
  const contents = "harbor round trip\n";
  const created = await upload("round trip.txt", contents, 24);

  assert.strictEqual(created.status, 201);

  const createdBody = await created.json();
  assert.match(createdBody.message, /uploaded successfully/);
  assert.strictEqual(createdBody.files.length, 1);

  const entry = createdBody.files[0];
  assert.strictEqual(entry.originalName, "round trip.txt");
  assert.strictEqual(entry.size, Buffer.byteLength(contents));
  assert.strictEqual(entry.downloadPath, `/download/${entry.id}`);
  assert.ok(entry.expiresAt, "a 24 hour upload should carry an expiry");

  // storedName is internal, so confirm the write landed by reading the metadata.
  const stored = readMetadata().find((file) => file.id === entry.id);
  assert.ok(stored, "metadata should hold the new record");
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, stored.storedName)));

  const listed = await fetch(`${baseUrl}/api/files`);
  assert.strictEqual(listed.status, 200);
  assert.ok((await listed.json()).files.some((file) => file.id === entry.id));

  const downloaded = await fetch(`${baseUrl}${entry.downloadPath}`);
  assert.strictEqual(downloaded.status, 200);
  assert.strictEqual(await downloaded.text(), contents);
  // res.download sends the name the client supplied, not the sanitized one.
  assert.match(downloaded.headers.get("content-disposition"), /round trip\.txt/);

  const deleted = await fetch(`${baseUrl}/api/files/${entry.id}`, {
    method: "DELETE",
    headers: { "x-upload-token": "test-token" }
  });

  assert.strictEqual(deleted.status, 200);
  assert.strictEqual((await deleted.json()).id, entry.id);
  assert.strictEqual(fs.existsSync(path.join(UPLOAD_DIR, stored.storedName)), false);
  assert.strictEqual(readMetadata().some((file) => file.id === entry.id), false);
});

test("an expired link is gone on the next request", async () => {
  const created = await upload("expired.txt", "stale", 1);
  const entry = (await created.json()).files[0];

  // Backdate the expiry rather than waiting an hour for it.
  const files = readMetadata();
  const target = files.find((file) => file.id === entry.id);
  target.expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(METADATA_PATH, `${JSON.stringify(files, null, 2)}\n`, "utf8");

  const download = await fetch(`${baseUrl}${entry.downloadPath}`);
  assert.strictEqual(download.status, 410);
  assert.match(await download.text(), /expired/);

  const listed = await fetch(`${baseUrl}/api/files`);
  assert.strictEqual((await listed.json()).files.some((file) => file.id === entry.id), false);
  assert.strictEqual(readMetadata().some((file) => file.id === entry.id), false);
});

test("upload without the token is refused before anything reaches disk", async () => {
  const before = fs.readdirSync(UPLOAD_DIR);
  const response = await upload("sneaky.txt", "nope", 24, null);

  assert.strictEqual(response.status, 401);
  assert.match((await response.json()).error, /upload token is required/);
  assert.deepStrictEqual(fs.readdirSync(UPLOAD_DIR), before);
});

test("delete without the token leaves the file alone", async () => {
  const created = await upload("keep.txt", "keep me", 24);
  const entry = (await created.json()).files[0];
  const stored = readMetadata().find((file) => file.id === entry.id);

  const response = await fetch(`${baseUrl}/api/files/${entry.id}`, { method: "DELETE" });

  assert.strictEqual(response.status, 401);
  assert.ok(fs.existsSync(path.join(UPLOAD_DIR, stored.storedName)));
  assert.ok(readMetadata().some((file) => file.id === entry.id));
});

test("an out of range expiry is rejected and leaves no orphan behind", async () => {
  const before = fs.readdirSync(UPLOAD_DIR);
  const response = await upload("too-long.txt", "too long", 9999);

  assert.strictEqual(response.status, 400);
  assert.match((await response.json()).error, /Expiry must be 0 \(never\) or between 1 and 8760 hours\./);
  // multer writes before the expiry check runs, so the route has to clean up.
  assert.deepStrictEqual(fs.readdirSync(UPLOAD_DIR).sort(), before.sort());
});

test("a fractional expiry is rejected and leaves no orphan behind", async () => {
  const before = fs.readdirSync(UPLOAD_DIR);
  const response = await upload("fractional.txt", "not forever", 0.5);

  assert.strictEqual(response.status, 400);
  assert.match((await response.json()).error, /Expiry must be 0 \(never\) or between 1 and 8760 hours\./);
  assert.deepStrictEqual(fs.readdirSync(UPLOAD_DIR).sort(), before.sort());
});

test("whitespace expiry is rejected and leaves no orphan behind", async () => {
  const before = fs.readdirSync(UPLOAD_DIR);
  const response = await upload("whitespace.txt", "not forever", " ");

  assert.strictEqual(response.status, 400);
  assert.match((await response.json()).error, /Expiry must be 0 \(never\) or between 1 and 8760 hours\./);
  assert.deepStrictEqual(fs.readdirSync(UPLOAD_DIR).sort(), before.sort());
});

test("a batch upload stores and lists every file", async () => {
  const response = await uploadFiles([
    ["first.txt", "first payload"],
    ["second.bin", "second payload"]
  ], 24);

  assert.strictEqual(response.status, 201);
  const body = await response.json();
  assert.strictEqual(body.files.length, 2);
  assert.deepStrictEqual(body.files.map((file) => file.originalName), ["first.txt", "second.bin"]);

  const listed = await fetch(`${baseUrl}/api/files`);
  const listedIds = (await listed.json()).files.map((file) => file.id);
  assert.ok(body.files.every((file) => listedIds.includes(file.id)));
});

test("a sweep does not delete an upload whose metadata is not written yet", () => {
  // multer puts the file on disk before the route records it. A sweep landing
  // in that window used to delete the file as an orphan and lose it.
  const inFlight = path.join(UPLOAD_DIR, "in-flight-aaaaaaaaaaaa.txt");
  fs.writeFileSync(inFlight, "still uploading");

  sweep();

  assert.ok(fs.existsSync(inFlight), "a brand new unclaimed file must survive the sweep");
  fs.rmSync(inFlight, { force: true });
});

test("a sweep does delete an orphan left behind long ago", () => {
  const stale = path.join(UPLOAD_DIR, "stale-bbbbbbbbbbbb.txt");
  fs.writeFileSync(stale, "aborted upload");
  // Backdate past the grace period so it reads as a genuine orphan.
  const old = Date.now() - 25 * 60 * 60 * 1000;
  fs.utimesSync(stale, new Date(old), new Date(old));

  const result = sweep();

  assert.ok(!fs.existsSync(stale), "an old unclaimed file must be swept off disk");
  assert.ok(result.orphans >= 1);
});

test("malformed metadata entries are ignored by the API and sweep", async () => {
  fs.writeFileSync(METADATA_PATH, '[null, 7, {"id":"missing-fields"}]\n', "utf8");

  assert.doesNotThrow(() => sweep());

  const response = await fetch(`${baseUrl}/api/files`);
  assert.strictEqual(response.status, 200);
  assert.deepStrictEqual((await response.json()).files, []);

  fs.writeFileSync(METADATA_PATH, "[]\n", "utf8");
});

test("a traversal record cannot download a file outside uploads", async () => {
  const outside = path.join(STORAGE_ROOT, "metadata-neighbor.txt");
  fs.writeFileSync(outside, "must stay private", "utf8");
  fs.writeFileSync(METADATA_PATH, JSON.stringify([{
    id: "traversal-test",
    originalName: "metadata-neighbor.txt",
    storedName: "..\\metadata-neighbor.txt",
    mimeType: "text/plain",
    size: 16,
    sizeLabel: "16 B",
    uploadedAt: new Date().toISOString(),
    expiresAt: null,
    downloadPath: "/download/traversal-test"
  }]) + "\n", "utf8");

  try {
    const response = await fetch(`${baseUrl}/download/traversal-test`);
    assert.strictEqual(response.status, 410);
    assert.match(await response.text(), /no longer available/);
    assert.strictEqual(fs.readFileSync(outside, "utf8"), "must stay private");
  } finally {
    fs.rmSync(outside, { force: true });
    fs.writeFileSync(METADATA_PATH, "[]\n", "utf8");
  }
});

test("an old directory in uploads does not crash or get recursively removed", () => {
  const directory = path.join(UPLOAD_DIR, "orphan-directory");
  fs.mkdirSync(directory);
  const old = Date.now() - 25 * 60 * 60 * 1000;
  fs.utimesSync(directory, new Date(old), new Date(old));

  try {
    assert.doesNotThrow(() => sweep());
    assert.ok(fs.existsSync(directory), "cleanup must not recursively remove directories");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("file list rebuilds download paths from the record id", async () => {
  const created = await upload("canonical.txt", "canonical", 24);
  const entry = (await created.json()).files[0];
  const files = readMetadata();
  files.find((file) => file.id === entry.id).downloadPath = "javascript:alert(1)";
  fs.writeFileSync(METADATA_PATH, `${JSON.stringify(files, null, 2)}\n`, "utf8");

  const listed = await fetch(`${baseUrl}/api/files`);
  const listedEntry = (await listed.json()).files.find((file) => file.id === entry.id);
  assert.strictEqual(listedEntry.downloadPath, `/download/${entry.id}`);
});

test("invalid numeric configuration fails at startup", () => {
  for (const [name, value, options] of [
    ["MAX_FILE_SIZE_MB", "not-a-number", { min: Number.MIN_VALUE }],
    ["SWEEP_INTERVAL_MINUTES", "not-a-number", { min: Number.MIN_VALUE }],
    ["DEFAULT_EXPIRY_HOURS", "1.5", { integer: true, min: 0 }],
    ["MAX_EXPIRY_HOURS", "0", { integer: true, min: 1 }]
  ]) {
    assert.throws(
      () => parseNumericEnv(name, value, 1, options),
      new RegExp(name)
    );
  }
});

test("unauthenticated uploads require an explicit opt-in", () => {
  assert.throws(
    () => validateUploadAuth("", false),
    /UPLOAD_TOKEN must be set/
  );
  assert.throws(
    () => validateUploadAuth("YOUR_TOKEN", false),
    /UPLOAD_TOKEN must be set/
  );
  assert.doesNotThrow(() => validateUploadAuth("", true));
  assert.doesNotThrow(() => validateUploadAuth("real-test-token", false));
});
