#!/usr/bin/env bash
# Cinderella backup — archive DB dump + media + quarantine + messaging-core DB + env.
# Scheduled by cinderella-backup.timer. Run as root (reads the 0600 env file).
#
#   /opt/cinderella/deploy/backup.sh [/backup/dir]
#
# Restore is documented in deploy/BACKUP.md, which also carries the mandatory
# deletion-replay step. Do not restore from these instructions alone.

set -euo pipefail

ENV_FILE="${CINDERELLA_ENV:-/etc/cinderella/cinderella.env}"
BACKUP_DIR="${1:-/var/backups/cinderella}"
KEEP=14
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

# WHY A STATUS FILE EXISTS AT ALL (CCB-S4-014, D-120).
#
# The admin console runs as the unprivileged `cinderella` user and CANNOT read
# `$BACKUP_DIR`: that directory is 0700 root by design, and the app's unit sets
# `ProtectSystem=strict` with an empty `CapabilityBoundingSet`. A status page that
# listed archives it cannot see would be a display that lies.
#
# So the privileged side leaves a record on the way past, in the one directory the app
# can read. It carries names, sizes and counts. It NEVER carries a value out of the env
# file: the env archive appears as an existence and a size, never as contents.
STATUS_PATH="${BACKUP_STATUS_PATH:-/var/lib/cinderella/backup-status.json}"
STATUS_OWNER="${BACKUP_STATUS_OWNER:-cinderella}"
# Updated as the run progresses, so a failure records HOW FAR it got rather than only
# that it failed.
STAGE="starting"

# Minimal JSON string escaping: backslash and quote, and control characters dropped.
# Values here are paths, stamps and our own warning strings, never member content.
jstr() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/[[:cntrl:]]//g'
}

# One line per kind: newest archive, its size, and how many generations are retained.
kind_json() {
  local prefix="$1" files=() f newest="" size=0
  shopt -s nullglob
  for f in "$BACKUP_DIR/$prefix-"*; do files+=("$f"); done
  shopt -u nullglob
  if [ ${#files[@]} -gt 0 ]; then
    newest="$(printf '%s\n' "${files[@]}" | sort -r | head -n 1)"
    size="$(wc -c <"$newest" 2>/dev/null || echo 0)"
  fi
  printf '{"kind":"%s","newest":"%s","bytes":%s,"generations":%s}' \
    "$(jstr "${prefix#cinderella-}")" "$(jstr "$(basename "$newest")")" \
    "${size:-0}" "${#files[@]}"
}

# Written on EVERY exit path, success or failure, so the console can show a red last
# run rather than silence. A backup that fails invisibly is the failure this whole
# briefing exists to make impossible.
write_status() {
  local code="$1" result="ok" tmp
  [ "$code" -eq 0 ] || result="failed"
  tmp="$STATUS_PATH.tmp"
  mkdir -p "$(dirname "$STATUS_PATH")" 2>/dev/null || true
  {
    printf '{\n'
    printf '  "stamp": "%s",\n' "$(jstr "$STAMP")"
    printf '  "finishedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "result": "%s",\n' "$result"
    printf '  "exitCode": %s,\n' "$code"
    printf '  "stage": "%s",\n' "$(jstr "$STAGE")"
    printf '  "backupDir": "%s",\n' "$(jstr "$BACKUP_DIR")"
    printf '  "retain": %s,\n' "$KEEP"
    printf '  "archives": [\n    %s,\n    %s,\n    %s,\n    %s,\n    %s\n  ],\n' \
      "$(kind_json cinderella-db)" "$(kind_json cinderella-media)" \
      "$(kind_json cinderella-quarantine)" "$(kind_json cinderella-core)" \
      "$(kind_json cinderella-env)"
    printf '  "warnings": [%s]\n' "$WARNINGS_JSON"
    printf '}\n'
  } >"$tmp" 2>/dev/null || return 0
  mv -f "$tmp" "$STATUS_PATH" 2>/dev/null || return 0
  # No secrets in it, so it may be world-readable; tightened to the app's user where
  # that user exists. A failed chown must never fail the backup.
  chmod 0644 "$STATUS_PATH" 2>/dev/null || true
  chown "$STATUS_OWNER":"$STATUS_OWNER" "$STATUS_PATH" 2>/dev/null || true
  return 0
}

# Warnings go to the journal AND into the status file, so a condition an operator would
# only have seen by reading logs is visible in the console too. Written with `if` rather
# than a `&&` list so `set -e` has nothing to trip over on the first warning.
WARNINGS_JSON=""
warn() {
  echo "$1" >&2
  if [ -n "$WARNINGS_JSON" ]; then
    WARNINGS_JSON="$WARNINGS_JSON,"
  fi
  WARNINGS_JSON="$WARNINGS_JSON\"$(jstr "$1")\""
}

# A partial artifact must never be mistaken for a generation. Everything is
# written to a dotted `.part` first and renamed only on success; the prune globs
# never match a dotted name, and a crash leaves nothing that looks complete.
on_exit() {
  local code=$?
  rm -f "$BACKUP_DIR"/.cinderella-*.part
  write_status "$code"
}
trap on_exit EXIT
rm -f "$BACKUP_DIR"/.cinderella-*.part

# Every artifact here is sensitive: the env file carries MEDIA_SECRET, and the
# messaging-core database holds unencrypted content. 077 makes that the default
# rather than something each line has to remember.
umask 077

# THE ENV FILE IS READ AS DATA, NEVER EXECUTED.
#
# `set -a && . "$ENV_FILE"` was wrong and failed on the real host. Sourcing runs the
# file as shell, so a value is parsed for expansions: the admin password's Argon2 hash
# begins `$argon2id$v=19$...`, which under `set -u` is a reference to an unset variable
# and aborted the whole unit with `argon2id: unbound variable` before anything was
# written. Every secret in that file is a hostile string to a parser, and the backup has
# no business evaluating any of them.
#
# Same principle as `deploy.sh`, which reads the file with `grep` and hands it to `env`
# precisely so an Argon2 `$` stays literal. This script needs the values in its OWN
# shell rather than in a child's environment, so it extracts the four keys it actually
# uses. Command-substitution output is not re-expanded, so the value arrives verbatim.
env_value() {
  local key="$1" line
  [ -f "$ENV_FILE" ] || return 0
  # Last assignment wins, which is what sourcing would have done. `export KEY=` and
  # leading whitespace are both accepted; comments never match because of the anchor.
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n 1)" || return 0
  [ -n "$line" ] || return 0
  line="${line#*=}"
  line="${line%$'\r'}" # tolerate a file saved with CRLF
  # Strip ONE matching quote pair, as sourcing would.
  case "$line" in
    \"*\") line="${line#\"}"; line="${line%\"}" ;;
    \'*\') line="${line#\'}"; line="${line%\'}" ;;
  esac
  printf '%s' "$line"
}

# Precedence is unchanged from sourcing: the file wins, then anything already in the
# environment, then the default.
file_dburl="$(env_value DATABASE_URL)"
DATABASE_URL="${file_dburl:-${DATABASE_URL:-}}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL not set (check $ENV_FILE)" >&2
  exit 1
fi

file_media="$(env_value MEDIA_ROOT)"
MEDIA_ROOT="${file_media:-${MEDIA_ROOT:-/var/lib/cinderella/media}}"
# Derived EXACTLY as resolveQuarantineRoot() in src/config.ts derives it: the
# configured value when set, otherwise a SIBLING of the media store. Hardcoding
# a path here would silently miss the quarantine on any host that moved it.
file_quarantine="$(env_value QUARANTINE_ROOT)"
QUARANTINE_ROOT="${file_quarantine:-${QUARANTINE_ROOT:-$(dirname "$MEDIA_ROOT")/quarantine}}"
# The SimpleX core writes <prefix>_chat.db and <prefix>_agent.db (src/config.ts).
file_prefix="$(env_value SIMPLEX_DB_PREFIX)"
SIMPLEX_DB_PREFIX="${file_prefix:-${SIMPLEX_DB_PREFIX:-/var/lib/cinderella/state/simplex/cinderella}}"

# `mkdir -p` + `chmod` rather than `install -d -m 0700`: identical result, and it is
# what let the round trip in BACKUP.md be proven on a non-Linux workstation instead of
# being owed. `umask 077` above already creates the directory restricted, so the chmod
# closes no window; it is there to also correct a directory that predates this script.
mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"


# 1) Archive database (custom format — restore with pg_restore).
#
# `--file` rather than a shell redirect ON PURPOSE. A redirect creates the target
# before pg_dump runs, so a failed dump left a zero-byte .dump behind that counted
# as a generation and could push a good one out of retention. The unit failed, and
# the directory still looked healthy.
STAGE="database"
pg_dump --format=custom --no-owner --file="$BACKUP_DIR/.cinderella-db-$STAMP.dump.part" \
  "$DATABASE_URL"
mv -f "$BACKUP_DIR/.cinderella-db-$STAMP.dump.part" "$BACKUP_DIR/cinderella-db-$STAMP.dump"

# 2) Media store (paths in the DB are relative to MEDIA_ROOT).
STAGE="media"
if [ -d "$MEDIA_ROOT" ]; then
  tar -czf "$BACKUP_DIR/.cinderella-media-$STAMP.tar.gz.part" -C "$MEDIA_ROOT" .
  mv -f "$BACKUP_DIR/.cinderella-media-$STAMP.tar.gz.part" \
    "$BACKUP_DIR/cinderella-media-$STAMP.tar.gz"
else
  warn "MEDIA_ROOT ($MEDIA_ROOT) does not exist; no media archive written."
fi

# 3) Quarantine (CCB-S4-011 decision 1: INCLUDE).
#
# Quarantined originals are MOVED out of MEDIA_ROOT, so they are not in the media
# archive and would be the one class of evidence a disk failure destroyed. The
# custody obligation is exactly why they have to survive it.
STAGE="quarantine"
if [ -d "$QUARANTINE_ROOT" ]; then
  tar -czf "$BACKUP_DIR/.cinderella-quarantine-$STAMP.tar.gz.part" -C "$QUARANTINE_ROOT" .
  mv -f "$BACKUP_DIR/.cinderella-quarantine-$STAMP.tar.gz.part" \
    "$BACKUP_DIR/cinderella-quarantine-$STAMP.tar.gz"
else
  warn "QUARANTINE_ROOT ($QUARANTINE_ROOT) does not exist yet; nothing quarantined."
fi

# 4) Messaging-core database (CCB-S4-011 decision 2: BACK UP).
#
# This is her SimpleX IDENTITY and group membership. Without it a restore is a bot
# that has lost who it is and has to rejoin every group. It also holds UNENCRYPTED
# message content, which is why the archive stays 0600 in a 0700 directory and why
# BACKUP.md says so in terms.
#
# `sqlite3 .backup` takes a consistent snapshot of a live database. A plain copy of
# a file the service is writing can tear across a page boundary, so when sqlite3 is
# missing we still take the copy but say loudly that it is the weaker one, rather
# than letting a degraded backup pass as a good one.
STAGE="messaging-core"
core_files=()
for suffix in chat agent; do
  [ -f "${SIMPLEX_DB_PREFIX}_${suffix}.db" ] && core_files+=("${SIMPLEX_DB_PREFIX}_${suffix}.db")
done
if [ ${#core_files[@]} -gt 0 ]; then
  core_stage="$BACKUP_DIR/.cinderella-core-$STAMP.stage"
  mkdir -p "$core_stage"
  chmod 0700 "$core_stage"
  for f in "${core_files[@]}"; do
    if command -v sqlite3 >/dev/null 2>&1; then
      sqlite3 "$f" ".backup '$core_stage/$(basename "$f")'"
    else
      warn "sqlite3 not installed; copied $(basename "$f") while it may be in use. Install sqlite3 for a consistent snapshot."
      cp -p "$f" "$core_stage/$(basename "$f")"
    fi
  done
  tar -czf "$BACKUP_DIR/.cinderella-core-$STAMP.tar.gz.part" -C "$core_stage" .
  rm -rf "$core_stage"
  mv -f "$BACKUP_DIR/.cinderella-core-$STAMP.tar.gz.part" \
    "$BACKUP_DIR/cinderella-core-$STAMP.tar.gz"
  chmod 600 "$BACKUP_DIR/cinderella-core-$STAMP.tar.gz"
else
  warn "No messaging-core database at ${SIMPLEX_DB_PREFIX}_{chat,agent}.db."
fi

# 5) Secrets (restrict tightly). Carries MEDIA_SECRET, so this archive is the key
# to every encrypted original in the media archive beside it. See BACKUP.md.
STAGE="env"
install -m 0600 "$ENV_FILE" "$BACKUP_DIR/cinderella-env-$STAMP.env"

# 6) Retain the newest $KEEP of each kind.
#
# The stamp is a zero-padded UTC timestamp, so LEXICOGRAPHIC order is chronological
# and no mtime lookup is needed: a `cp -p` or a filesystem restore cannot reorder
# generations by touching mtimes. The old implementation piped `ls` of a glob, which
# under `set -o pipefail` aborted the whole script when a kind had no files yet.
prune() {
  local prefix="$1"
  local files=() f
  shopt -s nullglob
  for f in "$BACKUP_DIR/$prefix-"*; do files+=("$f"); done
  shopt -u nullglob
  if [ ${#files[@]} -gt "$KEEP" ]; then
    local sorted=() i
    while IFS= read -r f; do sorted+=("$f"); done < <(printf '%s\n' "${files[@]}" | sort -r)
    for ((i = KEEP; i < ${#sorted[@]}; i++)); do rm -f -- "${sorted[$i]}"; done
  fi
  return 0
}

STAGE="retention"
for prefix in cinderella-db cinderella-media cinderella-quarantine cinderella-core cinderella-env; do
  prune "$prefix"
done

STAGE="complete"
echo "Backup complete: $BACKUP_DIR (stamp $STAMP, keeping $KEEP of each kind)"
