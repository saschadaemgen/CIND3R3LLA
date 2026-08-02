# Backups: what runs, what it captures, and how to restore without breaking a promise

Companion to [`RUNBOOK.md`](RUNBOOK.md). Introduced by CCB-S4-011, which turned an
unrun script into a schedule. Decisions behind the scope are **D-118**.

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
| Destination | `/var/backups/cinderella`, created `0700` |
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

**The messaging-core archive holds UNENCRYPTED message content.** The archive PostgreSQL is
the consent-governed store; the SimpleX core's own SQLite is not, and it is plaintext. That
archive is written `0600` in a `0700` directory and must stay that way. Anyone arguing for
looser permissions on the backup directory is arguing to publish member messages.

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

### 5.1 Database, into an EMPTY database

`pg_restore` into a database that already has rows will not give you the dump's state.

```bash
sudo -u postgres psql -c "DROP DATABASE cinderella;"
sudo -u postgres psql -c "CREATE DATABASE cinderella OWNER cinderella;"
sudo -u postgres pg_restore -d cinderella --no-owner /var/backups/cinderella/cinderella-db-<stamp>.dump
```

### 5.2 Media, quarantine, messaging core

```bash
sudo tar -xzf /var/backups/cinderella/cinderella-media-<stamp>.tar.gz      -C /var/lib/cinderella/media
sudo tar -xzf /var/backups/cinderella/cinderella-quarantine-<stamp>.tar.gz -C /var/lib/cinderella/quarantine
sudo tar -xzf /var/backups/cinderella/cinderella-core-<stamp>.tar.gz       -C /var/lib/cinderella/state/simplex
sudo chown -R cinderella:cinderella /var/lib/cinderella
```

### 5.3 Env file

```bash
sudo install -m600 -o root -g root /var/backups/cinderella/cinderella-env-<stamp>.env /etc/cinderella/cinderella.env
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
deletion right is not a one-time event if a restore can undo it, and the policy should say
that a restore re-applies subsequent deletions and name the window it cannot cover. The
policy is member-facing copy, so its wording is the operator's to confirm before it ships.

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
