# Xiaomi Camera Playback

LAN playback for Xiaomi camera MP4 recordings. The server indexes filenames into SQLite, exposes protected playback APIs, and serves the built Vite frontend when `dist-web` is present.

## Local Development

```bash
npm install
APP_PASSWORD=dev-password DATA_DIR=app-data RECORDINGS_DIR=/path/to/recordings TZ=Asia/Shanghai npm run dev
```

Open `http://localhost:8080` and sign in with `APP_PASSWORD`. When `CAMERA_CONFIG_PATH` is not set, the app discovers Xiaomi MP4 folders under `RECORDINGS_DIR` and writes the editable camera config to `DATA_DIR/cameras.yaml`.

Build and run production output locally:

```bash
npm run build
APP_PASSWORD=dev-password DATA_DIR=app-data RECORDINGS_DIR=/path/to/recordings node dist-server/server/main.js
```

## Fixture Smoke Test

The repository includes a small fixture camera config for local smoke checks. Create MP4-named placeholder files before starting the app; zero-byte placeholders are enough to exercise indexing, timelines, and plan APIs, while real MP4 content is required for browser video decoding.

```bash
mkdir -p tests/fixtures/recordings/XiaomiCamera_00_B888808A681C
mkdir -p tests/fixtures/recordings/xiaomi_camera_videos/B888809544F6
touch tests/fixtures/recordings/XiaomiCamera_00_B888808A681C/00_20260504110024_20260504111027.mp4
touch tests/fixtures/recordings/xiaomi_camera_videos/B888809544F6/00_20260504110500_20260504111500.mp4
touch tests/fixtures/recordings/xiaomi_camera_videos/B888809544F6/10_20260504110600_20260504111600.mp4
```

Run the app against the fixture config:

```bash
APP_PASSWORD=dev DATA_DIR=app-data RECORDINGS_DIR=tests/fixtures/recordings npm run dev
```

Open `http://localhost:8080` and log in with password `dev`.

Smoke checklist:

- Refresh the index and confirm three camera streams appear for the single-camera and dual-camera fixture folders.
- Confirm timeline spans are shown for the placeholder file windows.
- Request a playback plan from a visible timeline span.
- Play or seek the video and confirm the Day timeline playhead follows the current time.
- Try the playback speed controls.
- Check the layout at a mobile viewport width.

## Docker / NAS Deployment

Edit `docker-compose.example.yml`, set a strong `APP_PASSWORD`, and mount one or more recording directories under `/recordings`.

```bash
docker compose -f docker-compose.example.yml up -d --build
```

The example publishes `http://<nas-ip>:8088`, stores SQLite state and the generated camera config in `./app-data`, mounts recordings read-only from `/tmp/zfsv3/sata14/15216702047/data` to `/recordings`, and uses `TZ=Asia/Shanghai`.

## GitHub Actions Image Publish

Pushing image-related changes to `main`, pushing a tag like `v0.1.0`, or manually running `Docker Publish` builds and pushes a multi-arch Docker image to Docker Hub:

```text
${DOCKERHUB_USERNAME}/xiaomi-camera-smb-playback
```

Configure the `BuildImage` environment, repository secrets, or repository variables with Docker Hub credentials:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Configure optional Telegram secrets or variables to receive build success notifications:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`

When Telegram settings are present, the workflow sends a success notification with the image tag, commit, run URL, and recent changelog.

## Camera Config

By default the container generates and updates `DATA_DIR/cameras.yaml` from mounted recording folders. Existing aliases in that internal config are preserved, and newly mounted camera folders are appended on restart. Set `CAMERA_CONFIG_PATH` only if you want to provide a fixed YAML file yourself.

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
