# Deploying Drop Harbor

The README covers running it with plain Node. This file covers the longer paths:
Docker, a Proxmox LXC, systemd, and a reverse proxy. Read the README first and get
it working locally before you reach for any of these.

## Docker

A `Dockerfile` is included. Docker packages the app and Node together, so you do not
install Node on the host.

1. Build the image:
   ```bash
   docker build -t drop-harbor .
   ```
   You should see build steps ending in `writing image sha256:...` with no errors.
2. Run it:
   ```bash
   docker run -d \
     -p 3000:3000 \
     -e UPLOAD_TOKEN=YOUR_TOKEN \
     -v $(pwd)/uploads:/app/uploads \
     -v $(pwd)/data:/app/data \
     --restart unless-stopped \
     --name drop-harbor \
     drop-harbor
   ```
   What the flags do:
   - `-d` runs it in the background, so it survives closing your terminal.
   - `-p 3000:3000` maps host port 3000 to container port 3000. Change the first
     number if 3000 is taken, for example `-p 8080:3000`.
   - `-e UPLOAD_TOKEN=YOUR_TOKEN` sets the token required to upload and delete.
     Generate a real one as the README step 4 shows.
   - The two `-v` flags keep uploaded files and metadata on the host. Without them,
     everything is gone the moment you remove the container.
   - `--restart unless-stopped` brings it back after a host reboot.
3. Check it:
   ```bash
   docker ps
   ```
   You should see a `drop-harbor` row with status `Up`.

Logs are `docker logs drop-harbor`. Stop it with `docker stop drop-harbor`.

## Proxmox LXC

An LXC is a lightweight Linux container Proxmox runs on the host, cheaper than a
full VM. This path assumes you already run Proxmox VE and can reach the container
over SSH as root.

1. In the Proxmox web UI, create a Debian or Ubuntu LXC with enough disk for the
   files you plan to keep, then start it.
2. Inside the container, install Node:
   ```bash
   apt update && apt install -y nodejs npm
   node -v
   ```
   You should see `v18` or higher.
3. Create the target folder:
   ```bash
   mkdir -p /opt/drop-harbor
   ```
4. From your own machine, run the included deploy script. It copies the app over SSH
   and restarts the service:
   ```powershell
   ./scripts/deploy-lxc.ps1 -SshTarget root@YOUR_LXC_IP -RemoteAppDir /opt/drop-harbor -ServiceName drop-harbor
   ```
   `-SshTarget` is required, there is no default. This needs PowerShell, which is
   built into Windows and installs on macOS or Linux from
   [the PowerShell repo](https://github.com/PowerShell/PowerShell). The first run
   fails to restart the service because the service does not exist yet. That is
   expected, step 6 creates it.
5. SSH in and finish the one-time setup:
   ```bash
   ssh root@YOUR_LXC_IP
   cd /opt/drop-harbor
   npm install
   cp .env.example .env
   ```
   Edit `.env` and set `UPLOAD_TOKEN`.
6. Create the systemd service below, then:
   ```bash
   systemctl daemon-reload
   systemctl enable --now drop-harbor
   ```
   `systemctl status drop-harbor` should show `Active: active (running)`.
7. After that, re-run the deploy script any time you update the code. It restarts
   the service for you.

## systemd service

Create `/etc/systemd/system/drop-harbor.service`:

```ini
[Unit]
Description=Drop Harbor file drop
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/drop-harbor
ExecStart=/usr/bin/npm start
Restart=always
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOST=0.0.0.0
Environment=MAX_FILE_SIZE_MB=1024
Environment=UPLOAD_TOKEN=YOUR_TOKEN

[Install]
WantedBy=multi-user.target
```

Then `systemctl daemon-reload && systemctl enable --now drop-harbor`.

If you prefer not to use systemd, `pm2 start server.js --name drop-harbor` works on
any OS with Node installed.

## Reverse proxy

Put a proxy in front if you want a real domain and HTTPS instead of `http://ip:3000`.

Nginx:

```nginx
server {
    listen 80;
    server_name files.example.com;

    client_max_body_size 1024M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Caddy, which gets you HTTPS certificates on its own:

```caddy
files.example.com {
    request_body {
        max_size 1024MB
    }
    reverse_proxy 127.0.0.1:3000
}
```

Keep `client_max_body_size` or `max_size` at or above `MAX_FILE_SIZE_MB`. If the proxy
limit is lower, it rejects large uploads before the app ever sees them.

## Before you expose it publicly

- Set `UPLOAD_TOKEN`. Without it, anyone who finds the URL can fill your disk.
- Terminate HTTPS at the proxy. The token travels in a request header.
- Set `DROP_HARBOR_STORAGE_ROOT` to a disk you can afford to fill, and keep
  `DEFAULT_EXPIRY_HOURS` short enough that old files clear themselves out.
