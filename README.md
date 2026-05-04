# Xiaomi Camera Playback

LAN playback for Xiaomi camera MP4 recordings. The server indexes filenames into SQLite, exposes protected playback APIs, and serves the built Vite frontend when `dist-web` is present.

## Local Development

```bash
npm install
cp config/cameras.example.yaml config/cameras.yaml
APP_PASSWORD=dev-password CAMERA_CONFIG_PATH=config/cameras.yaml DATA_DIR=app-data TZ=Asia/Shanghai npm run dev
```

Open `http://localhost:8080`. API routes require a session cookie except `GET /api/health` and `POST /api/session`. The current frontend does not include a login form yet; create a session through the API before using protected calls.

```bash
curl -i -c cookies.txt \
  -H "content-type: application/json" \
  -d '{"password":"dev-password"}' \
  http://localhost:8080/api/session
```

From the browser console on the same origin:

```js
await fetch("/api/session", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ password: "dev-password" }),
});
```

Build and run production output locally:

```bash
npm run build
APP_PASSWORD=dev-password CAMERA_CONFIG_PATH=config/cameras.yaml DATA_DIR=app-data node dist-server/server/main.js
```

## Docker / NAS Deployment

Edit `docker-compose.example.yml`, set a strong `APP_PASSWORD`, and make sure camera paths in `config/cameras.example.yaml` match the container path `/recordings`.

```bash
docker compose -f docker-compose.example.yml up -d --build
```

The example publishes `http://<nas-ip>:8088`, stores SQLite state in `./app-data`, mounts recordings read-only from `/tmp/zfsv3/sata14/15216702047/data` to `/recordings`, and uses `TZ=Asia/Shanghai`.

## Camera Config

Single-camera root:

```yaml
recordingRoots:
  - id: b888808a681c
    path: /recordings/XiaomiCamera_00_B888808A681C
    streams:
      - channel: "00"
        alias: "Front Door"
```

Dual-camera root sharing one directory:

```yaml
recordingRoots:
  - id: b888809544f6
    path: /recordings/xiaomi_camera_videos/B888809544F6
    streams:
      - channel: "00"
        alias: "Dual A"
      - channel: "10"
        alias: "Dual B"
```

## Filename Format

Recordings are expected to look like:

```text
00_20260504110024_20260504111027.mp4
10_20260504110500_20260504111500.mp4
```

The first field is the channel. The two timestamps are start and end times in `yyyyMMddHHmmss` format and are interpreted as Asia/Shanghai local time.

## Notes

Videos are served directly as MP4 files with byte-range support. Transcoding and HLS are not included yet, so browser playback depends on the recorded codec being supported by the client.

Indexing scans filenames and stores metadata in SQLite under `DATA_DIR`; the recordings mount can remain read-only. Very large libraries can make the first scan IO-heavy, so keep `SCAN_INTERVAL_SECONDS` conservative.

Keep this on a trusted LAN or behind a VPN/reverse proxy. The app requires `APP_PASSWORD` for API access and uses an HTTP-only session cookie, but it does not provide TLS by itself and should not be exposed directly to the internet.
