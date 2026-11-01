# Drop Harbor, current implementation

Drop Harbor is a self-hosted Node and Express file drop. It stores uploaded files
and a JSON metadata index on local disk.

## Features

- Upload up to 12 files per request.
- Enforce a configured maximum size per file.
- Give each file a random UUID download path.
- Search the file library in the browser.
- Expire files at a selected hour limit or keep them without expiry.
- Delete files with the same upload token.
- Sweep expired files and old unclaimed files from disk.

## Runtime

- Node.js 18 or newer.
- CommonJS JavaScript with no build step.
- Dependencies are Express, Multer, and dotenv.
- `npm test` runs the built-in Node test runner.

## HTTP endpoints

- `GET /api/health` returns the active upload and expiry settings.
- `GET /api/files` returns the non-expired public file list.
- `POST /api/upload` accepts multipart files and an `expiryHours` field.
- `DELETE /api/files/:id` removes a file when the upload token is valid.
- `GET /download/:id` serves a non-expired file as a download.

## Security behavior

- Uploads and deletes require `UPLOAD_TOKEN` by default.
- `ALLOW_UNAUTHENTICATED_UPLOADS=true` is an explicit opt-in for trusted networks.
- The placeholder token `YOUR_TOKEN` is rejected unless unauthenticated mode is enabled.
- Numeric settings fail startup when they are non-finite, fractional where an integer
  is required, or outside their supported range.
- Stored paths are resolved and checked to remain under `uploads/`.
- Downloads rebuild their public path from the record ID instead of trusting stored
  URL text.
- Cleanup only removes regular files or symbolic links. It does not recursively remove
  directories under `uploads/`.
- Invalid metadata records are ignored instead of crashing list or cleanup requests.
- Responses include `X-Content-Type-Options: nosniff`.

## Limitations

- There is no database, account system, rate limiter, or disk quota.
- Downloads are public when the UUID link is known.
- An interrupted upload may remain until the orphan grace period has passed.
- The JSON metadata file is intended for one running application instance. Back up the
  `data/` and `uploads/` directories together.

## Configuration

See `.env.example` and the configuration table in the README. Set a real upload token
before exposing the service beyond the local machine. The deployment guide covers
Docker, Proxmox LXC, systemd, and reverse proxies.
