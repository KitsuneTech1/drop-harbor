# Drop Harbor, release spec

Self-hosted file drop: upload, share a link, search, expire.

## 1. What exists today

Node/Express app, 13 tracked files, 4 commits. Checked on the build machine with Node
v25.2.1.

- **Language and build:** JavaScript (CommonJS), Node >=18, npm only, no bundler or
  build step. Deps: express 4.21.2, multer 2.0.2, dotenv 16.6.1.
- **Code:** `server.js` (219 lines); `public/` index.html + app.js + styles.css, vanilla
  JS, no framework.
- **Tests:** none. No test script, no test dir, no CI.
- **README:** 261 lines, install guide for Node, Docker, and Proxmox LXC.
- **LICENSE:** MIT, says "Copyright (c) 2026 Kitsune Technologies LLC". Correct already.
- **Packaging:** `Dockerfile` (node:22-alpine), `scripts/deploy-lxc.ps1` (PowerShell
  over SSH).
- **Endpoints:** `GET /api/health`, `/api/files`, `/api/websites`, `POST /api/upload`,
  `GET /download/:id`. Boot check passed, health and files return 200.

### Gap between the pitch and the code

Upload works. Share a link works (`/download/<uuid>`). Search works but is client-side
only: `/api/files` returns every record and the browser filters, fine at this scale and
just needs documenting. Expire **does not exist**: no expiry field, no TTL check, no
cleanup job. There is also no delete, which the README admits, so the repo is honest, but
the pitch is not deliverable without expiry.

The app also ships a "websites panel" (`/api/websites`, `data/websites.json`) rendering
cards for other services on the owner's Proxmox box. Not in the pitch, a leftover from
this being a personal homepage.

## 2. Smallest honest version
1. Multi-file upload, up to 12 per request, with a per-file size cap.
2. A public download link per file, random UUID, no accounts.
3. Client-side search over the file library.
4. Expiry: pick a lifetime at upload, the file stops serving and gets deleted on time.
5. Delete a file on demand, authorized by the same admin token as upload.

Cut: the websites panel. Out of scope for a file drop, it carries the only remaining
user-controlled `href` sink, and keeping it means documenting a second JSON config nobody
asked for. Removing it deletes an endpoint and an attack surface.

**Runtime:** JavaScript, Node >=18, CommonJS. **Deps:** express, multer, dotenv. Expiry
needs no new dependency; a `setInterval` sweep plus an `expiresAt` check on download does
it with the stdlib. **Install:** `npm ci`. **Demo:** `npm start`, open
`http://localhost:3000`, drop a file in, set it to expire, copy the link.

**Testing:** `npm test`, using the built-in `node:test` runner and `node:assert`, no test
framework added. Tests boot the app on an ephemeral port and drive real HTTP: upload
returns 201 with a working link; unknown id returns 404; a wrong token returns 401 **and
writes nothing to disk**; delete without the token returns 401, with it 200 and the link
then 404; an already-expired file returns 410 and gets swept off disk; hostile filenames
(`../../etc/passwd`, a long extension, a `:` stream suffix) stay inside `uploads/`.

## 3. Release blockers

**B1. Private LAN IP committed.** `scripts/deploy-lxc.ps1` line 2 defaulted `$SshTarget`
to a private LAN address, in the working tree and in git history. Resolved: the parameter
is now required with no default, and the history was rewritten before any push, so the
address is absent from every commit and from the object database. A full history scan for
tokens, keys, `.env` contents, Windows user paths and personal domains came back clean.
**B2. Four npm advisories, all fixable by `npm audit fix`.** multer <=2.2.0 HIGH (DoS via
nested field names; incomplete cleanup of aborted uploads), proxy-addr CRITICAL
(IPv4-mapped IPv6 trust-subnet spoofing), qs MODERATE, body-parser LOW. The multer one
sits directly on this app's upload path.

Security pass on the upload/auth/download surfaces, as July asked. 27 candidates across
four lenses, adversarially verified: 19 refuted, 8 confirmed.

- **B3. Token checked after multer writes the files.** HIGH. `upload.array()` runs as
  middleware before the handler, so an unauthenticated request writes up to 12 files to
  `uploads/` and only then gets a 401 and a cleanup. Fix: check the token in middleware
  placed **before** multer, so a bad token never touches disk.
- **B4. No boundary check on the resolved download path.** HIGH.
  `path.join(UPLOAD_DIR, file.storedName)` is served with no check that the result is
  still inside `uploads/`. Not reachable from an upload today (checked: `path.basename`
  strips directories before sanitizing, and 22 hostile filenames all stayed in bounds),
  but it is all that stands between a hand-edited `files.json` and arbitrary file read.
  Fix: resolve, verify the prefix, then serve.
- **B5. The extension is never sanitized.** MEDIUM. `sanitizeName` covers the basename
  only; `path.extname` output is concatenated raw. Checked: `test.txt:$DATA` stores as
  `test-<hex>.txt:$DATA`, an NTFS alternate data stream, and a 200-character extension
  survives whole. Fix: sanitize and length-cap the extension.
- **B6. No disk quota, no rate limit.** HIGH. Default config is an open upload
  (`UPLOAD_TOKEN` blank in `.env.example`), 1 GB per file, unlimited concurrent requests,
  nothing reclaiming space. Anyone who finds the URL can fill the disk. Fix: expiry plus
  a documented storage cap, and a safe default config instead of an open one.
- **B7. Orphan files from aborted uploads.** MEDIUM. multer 2.0.2 leaves partials when a
  client disconnects mid-upload, loopable for disk fill. Mostly covered by B2; the sweep
  should also drop `uploads/` entries no metadata record claims.
- **B8. `javascript:` URL executes from the websites panel.** MEDIUM. `app.js` line 101
  assigns `link.href = website.url` unvalidated. Config-controlled, not remote, and
  resolved outright by cutting the panel.
- **B9. No `nosniff` header.** LOW. Checked that `res.download` does send
  `Content-Disposition: attachment` and escapes quotes properly, so stored HTML does not
  execute and there is no header injection. `nosniff` closes the sniffing edge case.
- **B10. No delete endpoint.** Low as a vulnerability, blocking as a feature. The
  operator cannot remove a file through the app. Covered by feature 5.

Refuted, recorded so phase 3 does not chase them: traversal from a normal upload,
`Content-Disposition` header injection, enumerable UUIDs, token timing attack, the
read-modify-write race on `files.json` (tested at 10-way concurrency, zero entries lost),
DOM XSS in the library (every user string goes through `textContent`).

**B11.** `package.json` says `"name": "uploaddownloadsite"`, `"author": ""`, and a
description that does not match the pitch. Rename to `drop-harbor`. **B12.** `.gitignore`
is uncommitted: the working tree adds `.oss31/`, correct and required, but unstaged;
house rules also want `.venv`, `target`, build artifacts. **B13.** No tests, no CI, so a
stranger cloning this cannot check it works (see section 2). **B14.** README documents the
websites panel and says "no delete UI right now"; both need rewriting once features 4 and
5 land and the panel is cut.
Left alone on purpose: `docs/screenshot.png` needs retaking after the panel goes, and
`express.json()` is mounted though no endpoint reads a JSON body.

## 4. Phase plan

Build: B1, B2, B11, B12, features 4 and 5, cut the websites panel. Review: B3, B4, B5,
B6, B7, B9. Test: the suite in section 2. Docs: B14, retake the screenshot.
