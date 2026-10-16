#!/bin/bash
# Manage Trivy's databases out of band of the scan.
#
# Trivy ships two caches: the vulnerability DB (~1.4 GB) and the Java index DB
# (~921 MB). By default it refreshes them on first use after a 24h TTL — and
# when that refresh lands inside a scan, the scan just blocks on the download.
# Measured here: 23 minutes of a 39-minute scan, and over 2 hours for the Java
# DB. So scans run with --skip-db-update/--skip-java-db-update and the
# downloads happen here instead.
#
#   ensure  Bootstrap, called by run-scans.sh before a scan. Downloads a
#           database ONLY when it is missing outright — a fresh volume, a wiped
#           cache. A stale DB is deliberately left alone: refreshing it is what
#           we are keeping out of the scan path. On a warm cache this is a
#           no-op, so in practice it runs once in a volume's lifetime.
#   update  Nightly refresh (cron). Downloads into a staging directory and then
#           swaps the finished files into place.
#
# Why there is no locking here: the swap is `mv` within one filesystem, which is
# rename(2) — atomic. A scan either sees the old database or the new one, never
# a half-written file, and a trivy process that already has the file open keeps
# reading it through the swap. Concurrent runs therefore cannot corrupt the
# cache and need no coordination.
#
# The one thing that discipline requires: STAGING MUST SHARE THE CACHE'S
# FILESYSTEM. In the container /tmp is the overlay while the cache is a volume,
# so staging in /tmp would turn the swap into copy-then-delete and reopen the
# torn-file window this design exists to close. Hence "$CACHE_DIR/.staging".
set -euo pipefail

CACHE_DIR="${TRIVY_CACHE_DIR:-$HOME/.cache/trivy}"
STAGING_DIR="${CACHE_DIR}/.staging"
DB_FILE="$CACHE_DIR/db/trivy.db"
DB_META="$CACHE_DIR/db/metadata.json"
JAVA_DB_FILE="$CACHE_DIR/java-db/trivy-java.db"
JAVA_DB_META="$CACHE_DIR/java-db/metadata.json"

# Both databases plus their staged copies, with headroom. A 2-hour download that
# dies on ENOSPC at 100% has already cost us once.
MIN_FREE_MB="${TRIVY_DB_MIN_FREE_MB:-5000}"

MODE="${1:-}"

# A fresh cache volume has ~/.cache but not trivy/ inside it. Everything below
# (df, the downloads, the staging dir) needs the directory to exist.
mkdir -p "$CACHE_DIR"

# A 0-byte file is what a killed download or a full disk leaves behind. Trivy
# then dies under --skip-db-update, so treat it as absent rather than present.
db_present() {
  [[ -s "$DB_FILE" && -s "$DB_META" ]]
}

java_db_present() {
  [[ -s "$JAVA_DB_FILE" && -s "$JAVA_DB_META" ]]
}

check_free_space() {
  local avail_mb
  # An unreadable number must not pass for "no space": an empty string compares
  # as 0 and used to report "only  MB free" on a disk with plenty of room.
  if ! avail_mb=$(df -Pm "$CACHE_DIR" | awk 'NR==2 {print $4}') || [[ ! "$avail_mb" =~ ^[0-9]+$ ]]; then
    echo "[trivy-db] ERROR: could not read free space on ${CACHE_DIR} (df said: '${avail_mb}')" >&2
    return 1
  fi
  if [[ "$avail_mb" -lt "$MIN_FREE_MB" ]]; then
    echo "[trivy-db] ERROR: only ${avail_mb} MB free on ${CACHE_DIR}, need ${MIN_FREE_MB} MB — refusing to start a download that would die on ENOSPC" >&2
    return 1
  fi
}

# download <label> <trivy flag> <target cache dir>
#
# State the failure only — what it costs differs per database, so the caller
# says that. Claiming "trivy cannot scan without it" for the Java DB would be a
# lie, and a log that lies is worse than one that says less.
download() {
  local label="$1" flag="$2" dest="$3" start end

  echo "[trivy-db] Downloading ${label} into ${dest}..."
  start=$(date +%s)
  if ! trivy image "$flag" --cache-dir "$dest"; then
    echo "[trivy-db] ERROR: ${label} download failed" >&2
    return 1
  fi
  end=$(date +%s)
  echo "[trivy-db] ${label} downloaded in $((end - start))s"
}

# Move a freshly staged database over the live one.
#
# The two files are moved back to back rather than as a unit. Each mv is atomic
# on its own, so neither file is ever torn; the only gap is a sub-millisecond
# window where the new DB sits beside the old metadata. That matters solely when
# trivy changes its schema version, and then it fails loudly on the next scan
# and is correct on the one after — which beats the machinery that closing a
# millisecond would cost.
swap_in() {
  local subdir="$1" dbfile="$2"

  if [[ ! -s "${STAGING_DIR}/${subdir}/${dbfile}" || ! -s "${STAGING_DIR}/${subdir}/metadata.json" ]]; then
    echo "[trivy-db] ERROR: staged ${subdir} is incomplete — keeping the existing database" >&2
    return 1
  fi

  mkdir -p "${CACHE_DIR}/${subdir}"
  mv -f "${STAGING_DIR}/${subdir}/${dbfile}"      "${CACHE_DIR}/${subdir}/${dbfile}"
  mv -f "${STAGING_DIR}/${subdir}/metadata.json"  "${CACHE_DIR}/${subdir}/metadata.json"
  echo "[trivy-db] ${subdir} swapped in"
}

refresh() {
  local label="$1" flag="$2" subdir="$3" dbfile="$4"

  download "$label" "$flag" "$STAGING_DIR" || return 1
  swap_in "$subdir" "$dbfile" || return 1
}

case "$MODE" in
  ensure)
    # Fatal. Without the vulnerability DB `trivy fs --scanners vuln` cannot run,
    # and a scan reporting a clean repo because its database is missing is worse
    # than a scan that refuses to start.
    if db_present; then
      echo "[trivy-db] vulnerability DB present ($(du -h "$DB_FILE" | cut -f1)) — not touching it"
    else
      echo "[trivy-db] vulnerability DB missing at ${DB_FILE} — downloading before the scan"
      check_free_space && download "vulnerability DB" --download-db-only "$CACHE_DIR" || {
        echo "[trivy-db] ERROR: no vulnerability DB — refusing to scan, a 'clean' result would be a lie" >&2
        exit 1
      }
    fi

    # NOT fatal. run-scans.sh runs under `set -e`, so exiting non-zero here would
    # abort all ten tools. The Java index DB only affects Java dependency
    # resolution; if a scan actually needs it, that trivy run fails on its own
    # and is reported as a normal tool failure with its real error.
    if java_db_present; then
      echo "[trivy-db] Java index DB present — not touching it"
    else
      echo "[trivy-db] Java index DB missing at ${JAVA_DB_FILE} — downloading before the scan"
      check_free_space && download "Java index DB" --download-java-db-only "$CACHE_DIR" \
        || echo "[trivy-db] WARNING: continuing without the Java index DB — Java dependency scanning will fail until a refresh succeeds" >&2
    fi
    ;;

  update)
    echo "[trivy-db] Refresh starting at $(date -Is)"
    check_free_space || exit 1

    rm -rf "$STAGING_DIR"
    mkdir -p "$STAGING_DIR"
    # Whatever happens below — success, failure, kill — staging does not outlive
    # this run. A leftover copy of a 1.4 GB database is how a disk fills up.
    trap 'rm -rf "$STAGING_DIR"' EXIT

    # Attempt both regardless of each other: a transient failure on the big DB
    # must not leave the Java DB stale indefinitely. Exit non-zero if either
    # failed — a silent nightly is how a cache goes cold unnoticed.
    rc=0
    refresh "vulnerability DB" --download-db-only      db      trivy.db      || rc=1
    refresh "Java index DB"    --download-java-db-only java-db trivy-java.db || rc=1

    echo "[trivy-db] Refresh finished at $(date -Is) (exit ${rc})"
    exit "$rc"
    ;;

  *)
    echo "[trivy-db] ERROR: usage: trivy-db.sh ensure|update" >&2
    exit 2
    ;;
esac
