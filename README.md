# Fermentation Log

A small self-hosted PWA for logging fermented chilli sauce batches from an iPhone. The spec is in [`SPEC.md`](SPEC.md).

It runs as one Docker container on Unraid and is reachable **only** through Tailscale Serve, on its own tailnet name, e.g. `https://ferment.<tailnet>.ts.net`.

## Local development

Requires Node 26 (`nvm use` picks it up from `.nvmrc`).

```sh
npm ci
npm run dev        # http://127.0.0.1:3000, acting as DEV_USER (default dev@example.com), data in ./data
npm test
npm run typecheck
```

`DEV_USER=<login>` makes the server act as that user without Tailscale headers. The server refuses to start when `DEV_USER` is set together with `NODE_ENV=production`.

npm 11 runs only allow-listed install scripts (`allowScripts` in `package.json`). If `npm ci` warns about a new one, review it, then use `npm install-scripts approve <pkg>`.

## Deploying

The image is **built on the Unraid server itself** from this repo's `Dockerfile`. No SSH and no registry are needed.

- Unraid is x86_64 and a Mac is usually arm64, so building on the NAS avoids slow emulated cross-builds.
- The repo is public, so the NAS needs no Git credentials.
- Unraid's updater recreates the container from its template, which keeps the "Use Tailscale" hook. A plain `docker run` would lose it.

Each deploy has two steps:

1. **On the Mac:** run `git push`.
2. **On the NAS:** run the **ferment-log deploy** user script.

The user script (`scripts/nas-bootstrap.sh`) makes a fresh shallow clone of `main` in `/tmp/ferment-log-build`, which is RAM-backed so nothing is written to the array. It then runs `scripts/deploy-nas.sh` from that clone. That script:

- builds `ferment-log:latest`, labelled with the commit, and keeps the image it replaced as `ferment-log:previous`;
- runs Unraid's `update_container`;
- checks that the container runs the new image and becomes healthy.

The deploy logic ships with the repo, so the user script itself never needs updating. Deploys are manual on purpose: nothing goes live in the middle of a weighing session.

Keep the image name unqualified (`ferment-log:latest`). Unraid's updater tries a pull first, and an unqualified name resolves to Docker Hub's reserved `library/` namespace, which nobody else can publish to.

**Never commit secrets or anything specific to your setup.** That covers `ALLOWED_LOGINS`, the real tailnet name and the VAPID keys: they go in the Unraid template's variables. Data stays in `/data` on the NAS.

## Unraid setup (first time)

1. **Tailnet DNS settings:** in the Tailscale admin console under **DNS**, enable **MagicDNS** and **HTTPS Certificates**. Without them, Serve can't get a certificate, and Unraid starts the container without Tailscale ("Enable MagicDNS and HTTPS on your Tailscale account"). Pick the tailnet name first if you want to change it, because the app's URL contains it. The certificates are publicly logged, so the tailnet name and the `ferment` hostname become public; the app itself stays reachable only from the tailnet.
2. **Check git:** in the web terminal (the `>_` icon), run `git --version`. Unraid 7 includes git in the base OS.
3. **User script:** install the **User Scripts** plugin from Community Applications. Then go to **Settings → User Scripts → Add New Script**, name it `ferment-log deploy`, and paste in the contents of `scripts/nas-bootstrap.sh`. Without the plugin, you can paste the same script into the web terminal instead.
4. **First build:** click **Run Script** on `ferment-log deploy`. It builds the image, then says there is no container yet.
5. **Create the container:** in the Unraid UI, go to **Docker → Add Container** and use these settings:

   | Setting | Value |
   |---|---|
   | Name | `ferment-log` |
   | Repository | `ferment-log:latest` |
   | Network Type | `bridge` |
   | Use Tailscale | **On** |
   | Tailscale Hostname | `ferment` |
   | Tailscale Serve | **Serve**, port `3000` |
   | Tailscale State Directory (advanced) | `/data/.tailscale_state` |
   | WebUI | `http://[IP]:[PORT:3000]/` |
   | Port mappings | **none.** Do not add one. |
   | Path | Container `/data` → Host `/mnt/user/appdata/ferment-log/` |
   | Variable `ALLOWED_LOGINS` | e.g. `you@example.com,friend@example.com` |
   | Variable `TZ` | `Europe/Bratislava` |

   Optional variables: `PUID` / `PGID` (default `99` / `100`, Unraid's nobody:users).
6. **Apply:** when the hook starts, it downloads Tailscale, so the first start needs outbound internet. The container log then shows a Tailscale login link. Open it and approve the device on your tailnet.
7. **Check the updater:** run the user script once more. It should finish with `ferment-log is healthy`. This confirms that Unraid's updater accepts a locally built image (see below).

### If the updater ignores local images

If the deploy stops with "still runs the old image", Unraid's `update_container` did not recreate the container from the local tag. In that case, run a registry on the NAS that is reachable only from the host itself. Docker allows plain HTTP for `localhost` registries without extra config.

- Add a `registry:2` container with Extra Parameters `-p 127.0.0.1:5000:5000`.
- Set the template's Repository to `localhost:5000/ferment-log:latest`.
- In `scripts/deploy-nas.sh`, set `IMAGE` to the same name and add a `docker push "$IMAGE"` after the build.

The updater's pull then succeeds.

### Rollback

In the web terminal:

```sh
docker tag ferment-log:previous ferment-log:latest
/usr/bin/php -q /usr/local/emhttp/plugins/dynamix.docker.manager/scripts/update_container ferment-log
```

You can also `git revert` the bad commit, push, and run the user script. A rollback past a migration also needs the matching database backup (see below).

## Milestone 0 checks

Run these once after the first deploy and record the results below.

1. **Loads over Tailscale:** open `https://ferment.<tailnet>.ts.net` on the iPhone with Tailscale on. The page shows your name and login.
2. **Identity header:** `https://ferment.<tailnet>.ts.net/api/me` returns `{"login": …, "name": …}`.
3. **Serve reaches a loopback-bound server, and the peer is loopback:** checks 1 and 2 already prove this. The server binds to `127.0.0.1`, and it returns 403 for identity headers from any non-loopback peer, so a successful `/api/me` means Serve runs in the container's network namespace and connects over loopback. Rejected peers are logged as `403 non-loopback peer <addr>`.
4. **Not reachable from the LAN or the Docker bridge:** in the Unraid web terminal:
   ```sh
   ip=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ferment-log)
   curl -m 5 "http://$ip:3000/healthz"     # expect: connection refused
   curl -m 5 http://tower:3000/healthz     # expect: connection refused (also try from another LAN machine)
   ```
5. **Record only:** with Tailscale switched off on the iPhone and VPN On Demand set for `*.ts.net`, does opening the Home Screen app bring Tailscale up?

**Results:** _(fill in)_

| Check | Result | Notes |
|---|---|---|
| 1 | | |
| 2 | | |
| 3 | | |
| 4 | | |
| 5 | | |
| `update_container` recreates from a local tag | | |

If check 3 or 4 fails, use the Compose fallback in SPEC §3.1 (a `tailscale/tailscale` sidecar with `network_mode: service:tailscale`) and document it here.

## iPhone

- Install the app from Safari: **Share → Add to Home Screen**.
- In the Tailscale app, enable **VPN On Demand** with a rule that connects automatically for `*.ts.net` hostnames.

## Troubleshooting

- **403 "no Tailscale identity":** first check whether the phone is a **tagged** device in the Tailscale admin console. Tailscale sends no identity headers for traffic from tagged devices.
- **403 "not in ALLOWED_LOGINS":** add the login shown in the message to `ALLOWED_LOGINS` and apply.
- **403 "only reachable through Tailscale Serve":** the request didn't come from Serve. Someone probably added a port mapping or changed `BIND_HOST`. Remove it.
- **"Can't reach the server":** Tailscale is off on the device.

## Data, backups and restore

Everything lives in `/data`, which is `/mnt/user/appdata/ferment-log/` on the host:

| Path | Contents |
|---|---|
| `ferment.db` | SQLite database (WAL mode) |
| `media/` | photos and voice notes |
| `exports/` | nightly Markdown + JSON export (M3) |
| `backups/ferment-startup-*.db` | `VACUUM INTO` snapshot taken on every container start, before migrations (last 10 kept) |
| `backups/ferment-YYYYMMDD.db` | nightly snapshot (M3, last 14 kept) |

Every deploy restarts the container, so it always has a fresh pre-migration snapshot. The Appdata Backup plugin can copy `backups/`, which holds consistent files, unlike the live `ferment.db` with its WAL.

**Restore:**

1. Stop the container.
2. Move `ferment.db`, `ferment.db-wal` and `ferment.db-shm` out of the way.
3. Copy the chosen snapshot to `ferment.db`.
4. Start the container.
