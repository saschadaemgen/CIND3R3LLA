# Backups: what runs, what it captures, and how to restore without breaking a promise

Companion to [`RUNBOOK.md`](RUNBOOK.md). Introduced by CCB-S4-011, which turned an
unrun script into a schedule. Decisions behind the scope are **D-118**.

> **Every archive is encrypted (CCB-S4-016, D-121). Without the passphrase they are
> unrecoverable.** There is no recovery path, no escrow and no backdoor: that is what
> real encryption costs. Keep the passphrase somewhere you will still have it when the
> host is gone, and NOT in the backup directory. See [section 2b](#2b-encryption).
>
> **A restore is not finished when the data is back.** The last step, re-applying
> deletions made after the dump, is what keeps the deletion promise. It is
> [below](#5-mandatory-re-apply-deletions-made-after-the-dump) and it is not optional.

---

## 1. What runs, and when

| | |
|---|---|
| Unit | `cinderella-backup.service` (oneshot, root) |
| Trigger | `cinderella-backup.timer`, daily at **03:30** host time, `RandomizedDelaySec=15min` |
| Missed runs | `Persistent=true`, so a host that was off at 03:30 runs the backup on next boot |
| Script | `/opt/cinderella/deploy/backup.sh` |
| Destination | `/var/backups/cinderella`, `0750 root:cinderella-backup` |
| Retention | the newest **14** generations of each kind, pruned every run |

Root is required and is not incidental: the env file is `0600` root-owned and
`pg_dump` needs the credentials inside it.

## 2. What is captured

Five kinds, each with its own 14 generations.

| Archive | Contains | Why it is in the set |
|---|---|---|
| `cinderella-db-<stamp>.dump` | The archive PostgreSQL, `pg_dump --format=custom` | Messages, consent, audit, settings. The product |
| `cinderella-media-<stamp>.tar.gz` | `MEDIA_ROOT` | Originals (encrypted at rest) and stripped derivatives |
| `cinderella-quarantine-<stamp>.tar.gz` | `QUARANTINE_ROOT` | **D-118 decision 1.** Quarantined bytes are MOVED out of `MEDIA_ROOT`, so they are in no other archive. A custody obligation that a disk failure can erase is not a custody obligation |
| `cinderella-core-<stamp>.tar.gz` | `<SIMPLEX_DB_PREFIX>_chat.db` and `_agent.db` | **D-118 decision 2.** Her SimpleX **identity** and group membership. Without it a restore is a bot that has to be reintroduced to every group |
| `cinderella-env-<stamp>.env` | The env file | Configuration **and `MEDIA_SECRET`** |

`QUARANTINE_ROOT` is derived exactly as `resolveQuarantineRoot()` in
[`src/config.ts`](../src/config.ts) derives it: the configured value when set, otherwise a
**sibling** of `MEDIA_ROOT` named `quarantine`. The script does not hardcode a path, so a
host that moved the quarantine is still covered.

### Two things about these files that must not be loosened

**The messaging-core archive holds UNENCRYPTED message content**, before this layer. The
archive PostgreSQL is the consent-governed store; the SimpleX core's own SQLite is not.
Since CCB-S4-016 that archive is encrypted like the rest, which is the only reason it can
be `0640` group-readable instead of `0600`. If encryption is ever turned off, this file
goes back to root-only or the read-group starts handing out member messages.

**The env archive is the key to the media archive sitting next to it.** `MEDIA_SECRET`
decrypts every original in `cinderella-media-*.tar.gz`, and both live in the same directory.
Encryption at rest buys nothing against someone who has that directory. If backups are ever
copied off-host, **copy the env archive somewhere else than the media archive**, or the
encryption is decorative.

> `RUNBOOK.md` previously said `backup.sh` does not copy `MEDIA_SECRET`. That was wrong: the
> script copies the whole env file, which contains it. Corrected under CCB-S4-011. The
> advice to keep the key separate from the media is still right, for the reason above.

### Prerequisite: `sqlite3`

Install it (`apt install sqlite3`). The script uses `sqlite3 .backup` to take a
**consistent** snapshot of the messaging-core database while the service is running. Without
it the script still runs, still takes a plain copy, and prints a `WARNING` to the journal on
every run saying the copy may be torn. It does not fail the unit, because a weaker
messaging-core copy is not worth losing that night's database dump over, but the warning is
there to be acted on rather than lived with.

## 2b. Encryption

Every one of the five archives is encrypted before it is finalised, so the finished names
end in `.enc` (`cinderella-db-<stamp>.dump.enc`). A backup that leaves this host carries
**no plaintext anywhere**, which is the point: filesystem permissions are access control,
not encryption, and they protect nothing once an archive is copied off the machine.

| | |
|---|---|
| Cipher | **AES-256-GCM**, authenticated |
| Key derivation | **scrypt**, N=32768 r=8 p=1, random 32-byte salt per archive |
| IV | random 12 bytes per archive, stored in the header |
| Implementation | [`scripts/backup-crypt.mjs`](../scripts/backup-crypt.mjs), Node's own `crypto`, streaming |

**Why a 256-bit symmetric cipher.** It is quantum-resistant in the sense that matters for
an archive that must stay secret for years: Grover only halves the effective strength, so
256 bits leaves a ~128-bit margin. An asymmetric layer was rejected deliberately, because
a self-encrypted, self-restored backup gains nothing from one and a key-agreement step
would be the part a future quantum adversary breaks. A backup is the textbook
harvest-now-decrypt-later target.

**Why not `age`.** `age` was the first choice and implements exactly this scheme in
passphrase mode, but **`age -p` reads the passphrase from the terminal by design** and
cannot be driven from a systemd timer: piping it, setting an environment variable and
redirecting stdin all hang. `age -i` is scriptable but is X25519, which would have given
up the quantum property while looking like it had not. See **D-121**.

**Why not raw `openssl enc`.** GCM here is authenticated, so a wrong key **fails** instead
of emitting plausible garbage; the IV is random per archive and stored; and there is no
padding to get wrong. Those are precisely the traps that make hand-rolled `openssl enc`
pipelines dangerous. It is the same construction the project already trusts for media at
rest (D-075).

### The passphrase, and where it lives

```bash
sudo install -m 0600 -o root -g root /dev/null /etc/cinderella/backup-passphrase
sudo sh -c 'openssl rand -base64 48 > /etc/cinderella/backup-passphrase'
sudo chmod 0600 /etc/cinderella/backup-passphrase
```

**It is deliberately NOT in `cinderella.env`.** That file is itself archived, so a key
stored inside the backup it unlocks is not a key. It also lives outside the backup
directory, so the read-group below can never read it.

**Copy it somewhere off this host now.** A password manager, a printed sheet in a safe,
anywhere that survives the machine. Losing it loses every backup.

### The read-group (operator step)

The admin console runs unprivileged and could not read `/var/backups/cinderella` at all
while it was `0700 root`. A dedicated group gives it **read access only**:

```bash
sudo groupadd -f cinderella-backup
sudo usermod -aG cinderella-backup cinderella
sudo systemctl restart cinderella
```

The restart matters: the app only picks up a new group membership when its process is
replaced.

After the next run the directory is `0750 root:cinderella-backup` and each archive is
`0640 root:cinderella-backup`. **Read and traverse, never write.** Creating and deleting
archives stay root-only, through the request-unit path from CCB-S4-014, so a compromised
web process could download a backup but never alter or destroy one.

**Group-readability is safe only because the archives are now encrypted**, and the two
decisions ship together for that reason. The env archive is `0640` like the rest, which
would have been unacceptable while it was plaintext with `MEDIA_SECRET` inside it.

**If the group does not exist the backup fails rather than running.** Writing archives the
console cannot read would silently undo this, so the script refuses and says what to run.

## 3. Installing and enabling the timer (operator step)

This repository ships the units. Installing them on the VPS is an operator action.

```bash
sudo install -m 0644 /opt/cinderella/deploy/cinderella-backup.service /etc/systemd/system/
sudo install -m 0644 /opt/cinderella/deploy/cinderella-backup.timer /etc/systemd/system/
sudo apt install -y sqlite3
sudo systemctl daemon-reload
sudo systemctl enable --now cinderella-backup.timer
```

Verify it is scheduled, then force one run and read the result:

```bash
systemctl list-timers cinderella-backup.timer
sudo systemctl start cinderella-backup.service
systemctl status cinderella-backup.service
```

## 3b. The admin console, and the two request units (CCB-S4-014, D-120)

The console has a **Backups** page under System. It is **read plus trigger only**: it shows
what the last run recorded and offers a run-now button. It does not edit the schedule or
retention, because that would mean a web request rewriting a root-owned unit.

**It cannot see `/var/backups/cinderella`, and that is deliberate.** The app runs as the
unprivileged `cinderella` user with `ProtectSystem=strict` and `NoNewPrivileges=true`; the
backup directory is `0700 root`. So `backup.sh` leaves a JSON record at
`/var/lib/cinderella/backup-status.json` on **every** run, successful or failed, and the
page renders that and nothing else. The record carries names, sizes, counts, the stage a
failure reached and any warnings. **It carries no secret**: the env archive appears as an
existence and a size, never as contents.

**Run-now needs two more units.** The console cannot start a service and cannot `sudo`, so
the request travels as data: it writes `/var/lib/cinderella/backup-request`, and a
root-side path unit notices and starts the ordinary backup service.

```bash
sudo install -m 0644 /opt/cinderella/deploy/cinderella-backup-request.path /etc/systemd/system/
sudo install -m 0644 /opt/cinderella/deploy/cinderella-backup-request.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cinderella-backup-request.path
```

**Until those are installed the button writes a marker that nothing consumes.** The page
detects exactly that: a request still sitting there after two minutes is shown as **not
picked up**, naming the unit. It will not pretend a backup ran.

Verify the boundary end to end after installing:

```bash
sudo -u cinderella touch /var/lib/cinderella/backup-request
journalctl -u cinderella-backup.service -n 20 --no-pager
```

## 4. Reading the last result

```bash
journalctl -u cinderella-backup.service -n 50 --no-pager
```

A successful run ends with `Backup complete: ...`. A failed `pg_dump` exits non-zero, so
the unit result is `failed` and `systemctl status` says so. **A failed run leaves no
artifact at all**: every file is written to a dotted `.part` name and renamed only on
success, so a failure can never leave a zero-byte dump that counts as a generation and
pushes a good one out of retention.

To see when it last succeeded, and what is on disk:

```bash
systemctl show cinderella-backup.service -p ExecMainStatus -p ExecMainExitTimestamp
sudo ls -la /var/backups/cinderella
```

## 5. Restoring

Stop the service first, so nothing writes while you work.

```bash
sudo systemctl stop cinderella
```

### 5.0 Decrypt first

Nothing below works on a `.enc` file. Decrypt each archive you need, using the passphrase
you kept off this host:

```bash
cd /opt/cinderella
sudo node scripts/backup-crypt.mjs decrypt   /var/backups/cinderella/cinderella-db-<stamp>.dump.enc /tmp/cinderella-db.dump   /etc/cinderella/backup-passphrase
```

Repeat for `media`, `quarantine`, `core` and `env`, then use the decrypted paths below.

**A wrong passphrase fails and writes nothing.** The cipher is authenticated, so you get
an error rather than a file full of garbage that looks restorable. Decrypt to somewhere
that is not the backup directory, and delete the plaintext when the restore is done.

### 5.1 Database, into an EMPTY database

`pg_restore` into a database that already has rows will not give you the dump's state.

```bash
sudo -u postgres psql -c "DROP DATABASE cinderella;"
sudo -u postgres psql -c "CREATE DATABASE cinderella OWNER cinderella;"
sudo -u postgres pg_restore -d cinderella --no-owner /tmp/cinderella-db.dump
```

### 5.2 Media, quarantine, messaging core

```bash
sudo tar -xzf /tmp/cinderella-media.tar.gz      -C /var/lib/cinderella/media
sudo tar -xzf /tmp/cinderella-quarantine.tar.gz -C /var/lib/cinderella/quarantine
sudo tar -xzf /tmp/cinderella-core.tar.gz       -C /var/lib/cinderella/state/simplex
sudo chown -R cinderella:cinderella /var/lib/cinderella
```

### 5.3 Env file

```bash
sudo install -m600 -o root -g root /tmp/cinderella-env.env /etc/cinderella/cinderella.env
```

**`MEDIA_SECRET` must be the one that encrypted the media you just restored.** There is no
key history. A restore that pairs this media with a different key gives you unreadable
originals and no error saying so.

### 5.4 Start, and let the sweeper run

```bash
sudo systemctl start cinderella
journalctl -u cinderella -n 50 --no-pager
```

The deferred-destruction sweeper starts with the service and processes
`pending_destructions`. **Any destruction that had been requested before the dump and
completed after it is therefore re-applied automatically**, because the durable record of
intent is inside the dump and the sweeper acts on it. That is one of the three cases below,
and the only one that needs nothing from you.

---

## 5 (mandatory). Re-apply deletions made after the dump

A dump is a photograph. Restoring it brings back everything that was true then, **including
content a member has since deleted**. Doing nothing here silently resurrects it, and the
member is never told. This is the step that keeps the deletion promise.

Three things count as "a deletion since the dump", and they behave differently.

| What happened after the dump | Restored state | What you must do |
|---|---|---|
| **A destruction that was already requested before the dump** (`pending_destructions` row is in the dump) | Message rows are back, and so is the request | **Nothing.** The sweeper re-applies it on start. Confirm in the journal |
| **A member deleted, or the operator destroyed, entirely after the dump** | Message rows are back; nothing records that they should not be | **Re-apply by hand.** Mechanism below |
| **A member revoked consent after the dump** (`hide` or `delete`) | `consent.revoked_at` and `revocation_mode` are back to their older values, so the member reads as opted in and their content **republishes** | **Re-apply by hand.** This is the most dangerous of the three, because nothing is missing: content simply becomes public again |

### The mechanism, and its honest limit

The record of what was deleted lives in the database that was lost, so it cannot be read from
the restore. It can only come from a **newer dump**. Retention keeps 14, so unless you are
restoring the newest generation there is usually one.

Compare the restored generation against the newest generation you still have:

```bash
# Load the newer generation beside the restored one, read-only, to diff against.
sudo -u postgres psql -c "CREATE DATABASE cinderella_newer OWNER cinderella;"
sudo -u postgres pg_restore -d cinderella_newer --no-owner /var/backups/cinderella/cinderella-db-<newer-stamp>.dump
```

Then, as `cinderella`, in `cinderella_newer`:

- **Messages destroyed between the two:** ids present in the restored database and absent
  from the newer one. Destruction is a real `DELETE FROM messages`, so absence is the signal.
- **Consent revoked between the two:** rows in `consent` whose `revoked_at` is set in the
  newer database and null in the restored one, together with their `revocation_mode`.

Re-apply both to the restored database: set `revoked_at` and `revocation_mode` to the newer
values first (that hides the content immediately, because publication is derived), then
destroy the message ids that the newer generation no longer has. Drop `cinderella_newer`
when finished.

**The limit, stated plainly: deletions made after the newest surviving dump cannot be
recovered from backups at all.** Nothing in this system records them anywhere else. If a
member deleted content an hour before the disk failed and the last dump is from that
morning, the restore brings that content back and no procedure here will know. The exposure
window is the time since the last successful backup, which is the strongest operational
argument for the daily timer actually being enabled.

**This obligation belongs in the privacy policy as well as here** (D-118). A member's
deletion right is not a one-time event if a restore can undo it. The operator confirmed the
binding German wording on 2026-08-02, and it is recorded verbatim in **D-118**.

It ships in the **site repository**, not this one: the legal texts left here with the
marketing site (D-089), and the clause belongs in `src/pages/legal.ts` under the existing
section "Grenzen der Löschung, ehrlich benannt", which already tells members that copies
persist in backups until those backups expire. That edit is a **site briefing**, tracked
there rather than here.

---

## 6. Verified round trip

**A backup that has never been restored is a hope, not a backup.** This procedure was
executed end to end, not merely written.

**Verified 2026-08-02** (CCB-S4-011), on PostgreSQL 16.13 against scratch databases and
scratch directories, using the commands in section 5:

| Checked | Result |
|---|---|
| All five archive kinds produced, exit 0 | pass |
| `pg_restore` into an empty database | row counts and cell values identical for `messages` and `consent` |
| `tar -xzf` media | tree byte-for-byte identical |
| `tar -xzf` quarantine | tree byte-for-byte identical |
| `tar -xzf` messaging core | SQLite identity row read back intact from both `_chat.db` and `_agent.db` |
| `install -m600` env | file content identical |
| Retention prune | 15 generations of **each** of the five kinds reduced to 14; the oldest removed |
| Failed dump | non-zero exit, and **zero files left behind** |
| Old redirect form, for contrast | exited non-zero but left a **0-byte** `.dump` that would have counted as a generation. This is the defect the `--file` + rename change removes |
| `sqlite3 .backup` branch | produced a readable consistent copy |
| Fallback branch (no `sqlite3`) | copied, and printed the WARNING on every file |

**What that run could NOT verify, and is owed on the VPS:**

- **File modes.** The workstation is Windows/NTFS, where `install -m600` reports success and
  leaves mode `0644`. The `0600`/`0700` requirements are therefore unproven here. Confirm on
  the VPS with `ls -la /var/backups/cinderella` after the first real run.
- **The timer.** systemd is not present on the workstation. That `OnCalendar` fires, that
  `Persistent=true` catches a missed run, and that a failed unit shows as `failed` are
  unverified until the units are installed. Section 3 is how to check them.
- **A restore of real production data.** Everything above used seeded scratch data.
