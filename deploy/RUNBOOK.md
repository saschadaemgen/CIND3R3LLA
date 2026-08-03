# Cinderella — deployment runbook (VPS)

One process (in-process SimpleX core + Fastify admin) as a non-root systemd
service behind nginx TLS. Debian, PostgreSQL, Node ≥ 20.

> **Shared host discipline:** this VPS may run other services. Everything below is
> **additive** — a new user, a new database, a new nginx vhost, an unused admin
> port. Do **not** modify neighbouring services, databases, or nginx configs, and
> do **not** impose a host-wide firewall that could break them.

## Paths & identity

- App code: `/opt/cinderella` (git checkout).
- Runtime data: `/var/lib/cinderella` (owned by `cinderella:cinderella`, `0750`)
  — `state/` (SimpleX SQLite DB), `files/` (XFTP downloads), `media/` (media store).
- Secrets: `/etc/cinderella/cinderella.env` (`0600 root:root`; systemd reads it as
  root before dropping to the service user).
- Service user: `cinderella` (system, non-root, `nologin`).

## First install

```bash
# 1) Native-addon build deps (the simplex-chat addon compiles its wrapper)
apt-get update && apt-get install -y build-essential python3

# 2) Service user + code
useradd --system --home-dir /var/lib/cinderella --shell /usr/sbin/nologin cinderella
git clone https://github.com/saschadaemgen/cinderella.git /opt/cinderella
cd /opt/cinderella
npm ci
npm run build          # tsc + Tailwind/htmx assets

# 3) PostgreSQL: least-privilege role + owned database
DB_PW="$(openssl rand -hex 24)"
sudo -u postgres psql -c "CREATE ROLE cinderella LOGIN PASSWORD '${DB_PW}';"
sudo -u postgres psql -c "CREATE DATABASE cinderella OWNER cinderella;"

# 4) Secrets + env file (root-owned, 0600)
SESSION_SECRET="$(openssl rand -hex 32)"
ADMIN_PW="$(openssl rand -base64 18)"                        # give this to the operator once
ADMIN_HASH="$(printf '%s\n%s\n' "$ADMIN_PW" "$ADMIN_PW" | npm run --silent hash-password | grep ADMIN_PASSWORD_HASH | sed "s/ADMIN_PASSWORD_HASH=//; s/'//g")"
install -d -m 0700 /etc/cinderella
cat > /etc/cinderella/cinderella.env <<ENV
DATABASE_URL=postgres://cinderella:${DB_PW}@127.0.0.1:5432/cinderella
BOT_DISPLAY_NAME=Cinderella
SIMPLEX_DB_PREFIX=/var/lib/cinderella/state/simplex/cinderella
SIMPLEX_FILES_FOLDER=/var/lib/cinderella/files
MEDIA_ROOT=/var/lib/cinderella/media
# Quarantined media (CCB-S3-013). Defaults to a sibling of MEDIA_ROOT, so this
# line is optional. It must NOT be inside MEDIA_ROOT: quarantined bytes are moved
# out of the served tree on purpose, and nesting them there would leave them
# fetchable. The service user needs write access to it, exactly as for MEDIA_ROOT.
# QUARANTINE_ROOT=/var/lib/cinderella/quarantine
# Encryption of original media at rest (CCB-S3-012). Generate with
# `openssl rand -base64 48`. NO KEY HISTORY: rotating or losing this makes every
# encrypted original permanently unreadable. backup.sh DOES capture it, because it
# copies the whole env file, which means the key sits in the same backup directory as
# the media it decrypts: copy the env archive somewhere else than the media archive if
# backups leave the host, or the encryption is decorative. See deploy/BACKUP.md.
# After setting it, backfill existing plaintext media as the service user:
#   sudo -u cinderella env $(grep -v '^#' /etc/cinderella/cinderella.env | xargs) #     npx tsx scripts/encrypt-media.ts
MEDIA_SECRET=<openssl rand -base64 48>
GROUP_NAME=
ADMIN_PORT=8787
ADMIN_USERNAME=operator
ADMIN_PASSWORD_HASH=${ADMIN_HASH}
SESSION_SECRET=${SESSION_SECRET}
PUBLIC_ORIGIN=https://<admin-hostname>
LOG_LEVEL=info
ENV
chmod 600 /etc/cinderella/cinderella.env

# 5) Runtime dirs (systemd StateDirectory also creates /var/lib/cinderella)
install -d -m 0750 -o cinderella -g cinderella \
  /var/lib/cinderella/state/simplex /var/lib/cinderella/files /var/lib/cinderella/media

# 6) Migrate the archive schema
cd /opt/cinderella
env $(grep -v '^#' /etc/cinderella/cinderella.env | xargs) node dist/db/migrate.js

# 7) systemd unit
cp deploy/cinderella.service /etc/systemd/system/cinderella.service
systemctl daemon-reload
systemctl enable --now cinderella
systemctl status cinderella --no-pager
curl -fsS http://127.0.0.1:8787/healthz     # -> {"ok":true}
```

## Admin access — public, appless, passkeys (Addendum 4)

The console is public at the admin hostname over real Let's Encrypt TLS, secured
by **passkeys** (WebAuthn) — not by network location. nginx terminates TLS and
proxies to Fastify on `127.0.0.1:8787`.

```bash
# DNS A-record for the admin hostname must already point at the VPS.
certbot certonly --nginx -d <admin-hostname>          # reuses the existing ACME account
# Set the real hostname in the vhost, then enable it:
sed -i "s/cinderella.example.org/<admin-hostname>/g" deploy/nginx-admin.conf   # or edit by hand
cp deploy/nginx-admin.conf /etc/nginx/sites-available/cinderella-admin
ln -sf ../sites-available/cinderella-admin /etc/nginx/sites-enabled/cinderella-admin
nginx -t && systemctl reload nginx                    # reload, never restart (shared host)
```

Set the WebAuthn env (RP id/origin derive from `PUBLIC_ORIGIN`, so usually just):

```
PUBLIC_ORIGIN=https://<admin-hostname>
```

**First login (bootstrap):** break-glass is enabled by default. Log in with the
Argon2id password, open **Security → Passkeys**, register passkeys on **≥2
devices** (phone + desktop, ideally a hardware key too), then disable break-glass
if you wish. Every A4.5 control (session, rate-limit, step-up, IP access, headers,
etc.) is configured on the Security page.

> Retires Addendum 3's WireGuard-interface vhost — remove
> `/etc/nginx/sites-enabled/cinderella-admin`'s WG version before installing this.
> WireGuard stays installed but is no longer on the admin path. See
> [deploy/wireguard.md](wireguard.md) (now optional defense-in-depth).

## Group onboarding

The operator provides the real SimpleX group link. Stop the service (single-writer
SimpleX DB), join, then restart:

```bash
systemctl stop cinderella
cd /opt/cinderella
env $(grep -v '^#' /etc/cinderella/cinderella.env | xargs) npm run connect -- "<simplex group link>"
# wait for "Joined group" + welcome message, then Ctrl+C
systemctl start cinderella
```

## Set the bot avatar

The avatar is carried **in the boot profile**: on startup the bot loads the image
at `AVATAR_PATH` (default `/var/lib/cinderella/avatar.jpg`), auto-downscales it to
a small square JPEG (SimpleX profile images ride inside the profile message
envelope — a full-size photo is silently never applied), and the SDK applies /
self-heals it. So the whole flow is **place the file, then restart** — no need to
stop the service first (the DB is never opened by the avatar tooling):

```bash
# 1. Put the image where the bot reads it, owned by the cinderella user.
sudo install -o cinderella -g cinderella -m 0644 avatar.jpg /var/lib/cinderella/avatar.jpg

# 2. Apply it: restart picks up the new image and the boot-time group flush
#    pushes it to existing members (one small group message, once per image).
systemctl restart cinderella
```

Optional — validate the downscale and copy in one step with the helper (it only
reads the image and writes it to `AVATAR_PATH`; it does **not** open the SimpleX
core, so the service can stay running — then restart as above):

```bash
cd /opt/cinderella
sudo -u cinderella env AVATAR_PATH=/var/lib/cinderella/avatar.jpg \
  node dist/bot/set-avatar.js /path/to/source-image.jpg
```

Admin sessions persist in PostgreSQL (`admin_sessions`), so the restart does not
log the operator out.

## Update

> **Stale until CCB-S3-044: this repository is PUBLIC and the VPS pulls it
> anonymously.** `/opt/cinderella` is an ordinary checkout with
> `https://github.com/saschadaemgen/CIND3R3LLA.git` as its origin, and `deploy.sh`
> pulls without a credential. The deploy-key and git-bundle workarounds this note
> used to prescribe are for a private repository and are not needed here. (They *are*
> the situation for the site repository, which is why it is pushed instead of pulled;
> see the marketing-site section below.)

**One command** (pull → install → build → migrate → restart → poll `/healthz`
until it answers, then print one result line). Run as root:

```bash
cd /opt/cinderella && sudo bash deploy.sh
```

`deploy.sh` prints `DEPLOY OK — cinderella live at rev <sha>: {"ok":true}` on
success, or `DEPLOY FAILED …` plus the last 25 log lines and a non-zero exit on
failure. It polls health with a retry loop + deadline (`HEALTH_TIMEOUT`, default
90s) rather than a fixed sleep. Paths/service/port are overridable via
`CINDERELLA_DIR` / `CINDERELLA_ENV` / `CINDERELLA_SERVICE` / `ADMIN_PORT`.

The manual equivalent, if you need to run a step by hand:

```bash
cd /opt/cinderella
git pull            # (needs a deploy key; else use the bundle above)
npm ci && npm run build
env $(grep -v '^#' /etc/cinderella/cinderella.env | xargs) node dist/db/migrate.js
systemctl restart cinderella   # sessions survive this now
```

### The onboarding wizard can now create the contact address (CCB-S4-022, D-126)

`src/` changed, so this is an ordinary `sudo bash deploy.sh`. After it, the AI Bot Setup
page has the control it has been describing: for the bot marked as the primary runtime
bot, in state `configured`, a **Create the contact address** button.

Pressing it asks the running SimpleX core for the bot's contact link, stores it with the
SimpleX user it was created on, and moves the page to the Contact step showing the link
and what it is waiting for. The operator then adds the bot as a contact from their own
SimpleX app using that link. **Accepting the request is not built yet**, so the page waits
there; that is the next briefing and the page says so rather than implying otherwise.

Two things to expect rather than be surprised by:

- **Right after a restart the button reports that the core is still starting up.** That is
  the readiness gate of D-125, not a fault; it settles in about ten seconds.
- **Pressing it twice is safe.** The second press reads the existing address back rather
  than creating a second one, and the log line says which path it took
  (`contact address created` versus `contact address already existed, showing it`).

Nothing else changes, and the migration (`024`) only adds three nullable columns.

### The bot now starts differently (CCB-S4-021, D-125)

This is the first deploy that changes **how the bot starts**: it boots on the
multi-profile runtime with one profile hosted, instead of on the SDK's `bot.run`.

**Watch the first boot reach readiness.** `start()` returning is not readiness, and the
log says so at every step:

```bash
journalctl -u cinderella -n 60 --no-pager | grep -E "runtime:|Bot is live"
```

Expect, in order: `hosting profile ... how: 'adopted the core active user'` (adopted, not
created - a *created* profile on a host that already had one would mean the bot is now a
stranger with no group membership), then `startChat returned, subscribing`, then
`runtime: ready` with `readyReason: 'quiet'` roughly ten seconds later, then
`Bot is live`. **`readyReason: 'ceiling'` is a fault signal**, not a milestone: it means
the core never went quiet, and it also raises an entry on the admin dashboard.

**The bot is deliberately mute for those ten seconds.** It receives and archives
normally throughout; only replies wait, and a question asked during the window is
answered once the core settles rather than dropped.

**Rollback, in order of cost.** If the first live boot misbehaves, add
`BOT_RUNTIME_HOSTING=false` to `/etc/cinderella/cinderella.env` and
`systemctl restart cinderella`: that returns the bot to the pre-runtime path with no
rebuild and no checkout change. Only if that also fails is the previous revision the
answer (`git checkout <sha> && npm ci && npm run build && systemctl restart cinderella`).
No migration is involved either way, so nothing has to be undone in the database.

> **Migration 013 rewrites the `messages` table.** It drops and recreates the
> generated `search` column and its GIN index, which takes an `ACCESS EXCLUSIVE`
> lock for the duration — the public archive is unavailable while it runs. That is
> seconds on an archive of this size, but check the row count before running it on
> a large one: `psql "$DATABASE_URL" -tAc 'SELECT count(*) FROM messages'`.

## The marketing site is a SEPARATE service (D-089)

Since D-089 the website is not part of this application. It has its own repository,
directory, unit, port and delivery path, and updating one does not touch the other.

**The two are delivered differently, and that is deliberate.** This repository is
public, so the VPS clones and pulls it. `cind3r3lla-site` is private on purpose (a
faithful clone of a marketing site is a phishing kit), the server holds no GitHub
credential, and `/opt/cinderella-site` is therefore **not a git checkout at all**. The
site is **pushed** from the operator's machine. Do not try to make it a checkout; that
route was considered and deliberately dropped.

| | product (this repo) | marketing site |
|---|---|---|
| on the VPS | `/opt/cinderella` (git checkout) | `/opt/cinderella-site` (**not** git; pushed tree) |
| unit | `cinderella.service` | `cinderella-site.service` |
| port | `127.0.0.1:8787` | `127.0.0.1:8788` |
| env | `/etc/cinderella/cinderella.env` | `/etc/cinderella-site/site.env` |
| delivery | `ssh vps "cd /opt/cinderella && bash deploy.sh"` (pull) | `bash deploy/push.sh` **from the site repo on the operator's machine** (push) |
| what is deployed | `git log -1` on the VPS | the `REVISION` file, written by `push.sh` |
| database | PostgreSQL | none |

`push.sh` packs the working tree, copies it over SSH, stamps `REVISION`, and then runs
every remote step itself over ssh: install, build, restart, health, and a render check
that the page actually returns HTML. **There is deliberately no deploy script on the
server** and none should be written: one would have to deploy *from* something, and
the only candidates are a git checkout there (a deploy key on a shared host, and the
pull path back) or the files already on disk, which is what `push.sh` already does
after copying. See D-091.

First install of the site, from the site repository on the operator's machine:

```bash
install -d -m 0755 /etc/cinderella-site        # on the VPS
# copy .env.example across, edit it, then from the site repo locally:
bash deploy/push.sh                            # delivers the tree and runs deploy.sh
# then, on the VPS, once the tree is there:
cp /opt/cinderella-site/deploy/cinderella-site.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now cinderella-site
```

The site runs under systemd's `DynamicUser`, so there is **no account to create** and
no state directory to own: it reads its code and writes nothing. `site.env` holds no
secrets (origins, a log level, three feature toggles), but keep it `0640` for
consistency with the product's env file.

Point the marketing vhost at `:8788` — the current config is committed in the site
repository at `deploy/nginx-site.conf`. The console vhost
([`nginx-admin.conf`](nginx-admin.conf)) and the shared SNI splitter
([`nginx-stream-splitter.conf`](nginx-stream-splitter.conf)) are committed here.
Reload, never restart, on this shared host.

## Media remediation — run it AS THE SERVICE USER

`scripts/remediate-media.ts` writes into `MEDIA_ROOT/derived`. Running it as root creates that
tree owned by root, and the service (which runs as `cinderella`) then cannot write new
derivatives — every new image is withheld by the metadata gate and the public stream silently
loses its photographs.

```bash
sudo -u cinderella env MEDIA_ROOT=... DATABASE_URL=... npx tsx scripts/remediate-media.ts
```

If it has already happened: `chown -R cinderella:cinderella /var/lib/cinderella/media/derived`.
The boot check reports how many published items are unservable, and the service regenerates
missing derivatives on demand once it can write.

## Backup

**See [`BACKUP.md`](BACKUP.md).** It is the authority; this is the summary.

`cinderella-backup.timer` runs `deploy/backup.sh` daily at 03:30 (`Persistent=true`,
so a host that was off catches up on boot). Five archives, 14 generations each: the
archive database, `media/`, the **quarantine**, the **messaging-core SQLite** (her
SimpleX identity, and unencrypted content, so `0600` in a `0700` directory), and the
env file. Installing and enabling the units is an operator step, documented in
`BACKUP.md` §3.

**A restore is not finished when the data is back.** Re-applying deletions made after
the dump is a mandatory step, because a dump predates them and restoring it silently
resurrects content a member deleted. `BACKUP.md` §5 has the procedure, the three cases
that behave differently, and the honest limit: deletions made after the newest
surviving dump cannot be recovered from backups at all.

## Firewall

Cinderella's own surface is localhost-only (admin `127.0.0.1:8787`, Postgres
`127.0.0.1:5432`). On a shared host, review any host-wide firewall change against
the other services first — do not blanket-close ports they rely on.

## Logs

`journalctl -u cinderella -f`. Journald handles rotation. The dashboard surfaces
capture errors and failed file receipts (react before the ~48h XFTP expiry).
