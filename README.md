<p align="center"><a href="https://kitsunetechnologies.org/work"><img src="https://raw.githubusercontent.com/KitsuneTech1/.github/main/assets/kitsune-banner.svg" alt="Built by Kitsune Technologies" width="760"></a></p>

# Drop Harbor

Self-hosted file drop: upload a file, share a link, search your library, let it expire.

![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-339933?logo=node.js&logoColor=white)

## What it does

- Upload up to 12 files at once, with a size cap you set.
- Give every file a public download link, a random UUID, no accounts.
- Search your file library by filename as you type.
- Pick a lifetime at upload. The link stops working and the file is deleted off disk on time.
- Delete any file on demand, using the same token that guards uploads.

## What you need

- **Node.js 18 or newer.** Check with `node -v`. Download it from [nodejs.org](https://nodejs.org) (pick the LTS build). On Debian or Ubuntu, `sudo apt install nodejs npm` works too.
- **A machine to run it on.** Your own PC, a spare box, a VPS, or a container. Anything that runs Node.js.
- **Git**, to get the code. Check with `git --version`. If you do not have it, download the ZIP from the GitHub page instead.

That is all. There is no database and no build step.

## Install

1. Get the code:
   ```bash
   git clone https://github.com/KitsuneTech1/drop-harbor.git
   cd drop-harbor
   ```
   You should now see `server.js` and `package.json` in the folder.
2. Install the three dependencies:
   ```bash
   npm install
   ```
   You should see a `node_modules` folder appear and a line like `added 80 packages`, with no red error text.
3. Copy the example settings to a real settings file:
   ```bash
   cp .env.example .env
   ```
   On Windows PowerShell, use `Copy-Item .env.example .env`.
4. Open `.env` in a text editor and set an upload token. Generate one with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
   ```
   Paste the output as the `UPLOAD_TOKEN` value, replacing `YOUR_TOKEN`. If you leave it blank, anyone who can reach the server can upload files and fill your disk.
5. Start it:
   ```bash
   npm start
   ```
   You should see:
   ```
   Drop Harbor running on http://0.0.0.0:3000
   ```

## Use it

Open `http://localhost:3000` in a browser. If the server is on another machine, use `http://<that-machine-ip>:3000`.

1. Drag a small file onto the drop zone, or click it and pick one.
2. Leave the lifetime on `7 days`, or choose another one.
3. Paste your upload token into the token field.
4. Click the upload button.

The file shows up under "Shared downloads" with a size, an expiry, and three buttons: Download, Copy link, and Delete. Click Copy link and you have a URL anyone can use, like `http://localhost:3000/download/174932ed-9d55-4f65-84ae-439324e55571`.

To check the same thing from a terminal:

```bash
curl -H "x-upload-token: YOUR_TOKEN" -F "files=@hello.txt" -F "expiryHours=1" \
  http://localhost:3000/api/upload
```

You should get back a `201` and JSON like this:

```json
{
  "message": "1 file uploaded successfully.",
  "files": [{
    "id": "174932ed-9d55-4f65-84ae-439324e55571",
    "originalName": "hello.txt",
    "sizeLabel": "27 B",
    "expiresAt": "2026-10-12T15:00:27.575Z",
    "downloadPath": "/download/174932ed-9d55-4f65-84ae-439324e55571"
  }]
}
```

## It worked if ...

- `npm start` printed `Drop Harbor running on http://0.0.0.0:3000` and did not exit.
- The page at `http://localhost:3000` loads with a styled upload panel, not plain text.
- You uploaded a file, opened the copied link in a new tab, and got the same file back.
- Typing part of the filename in the search box narrows the library down to it.
- Clicking Delete removes the row, and the copied link then returns `File not found.`
- `npm test` ends with `pass 10` and `fail 0`.

## Troubleshooting

- **`Error: listen EADDRINUSE: address already in use 0.0.0.0:3000`** Something else already holds port 3000. Change `PORT` in `.env` to a free port such as `3001` and start it again.
- **`{"error":"A valid upload token is required."}` with a 401** The token you sent does not match `UPLOAD_TOKEN` in `.env`. It must match exactly, with no quotes and no trailing spaces. Restart the server after editing `.env`, since the file is read only at startup.
- **`{"error":"That file is too large. Max size is 1024 MB."}`** The file is over `MAX_FILE_SIZE_MB`. Raise that value in `.env` and restart. If you put Nginx in front, raise `client_max_body_size` to match, or Nginx rejects the upload before it reaches the app.
- **`This link has expired.` with a 410** The lifetime you picked ran out, and the file was deleted off disk. That is the feature working. Upload it again with a longer lifetime, or `0` for never.
- **The page loads but has no styling** The `public/` folder is missing or was not copied. Run the app from inside the repo folder so it can find `public/`.

## Config

Set these in `.env`, or as real environment variables.

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3000` | Port the web server listens on |
| `HOST` | `0.0.0.0` | Bind address |
| `MAX_FILE_SIZE_MB` | `1024` | Largest single file accepted, in MB |
| `UPLOAD_TOKEN` | (blank) | Shared token required to upload and to delete. Blank means anyone can upload. Downloads are always public |
| `DEFAULT_EXPIRY_HOURS` | `168` | Lifetime used when an upload does not pick one. 168 is 7 days |
| `MAX_EXPIRY_HOURS` | `8760` | Longest lifetime an upload may ask for. 8760 is 1 year |
| `SWEEP_INTERVAL_MINUTES` | `5` | How often expired files and orphans are deleted off disk. An unclaimed file is left alone for its first hour, so a sweep cannot delete an upload still in progress |
| `DROP_HARBOR_STORAGE_ROOT` | (app folder) | Parent folder for `uploads/` and `data/`. Point this at a bigger disk if you want |

Uploaded files live in `uploads/`. The metadata index lives in `data/files.json`. Back up or mount both if you want files to survive a rebuild.

Deploying to Docker or a Proxmox LXC, running it under systemd, and putting Nginx or Caddy in front are covered in [docs/DEPLOY.md](docs/DEPLOY.md).

## Running the tests

```bash
npm test
```

The suite uses the `node:test` runner built into Node, so there is nothing extra to install. It starts the server on a random port against a temporary folder, so your real `uploads/` and `data/` are left alone.

## License

MIT. See [LICENSE](LICENSE).
