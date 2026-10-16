#!/bin/bash
set -euo pipefail

# Inject SSH public key for the scanner user
if [ -n "${SCANNER_SSH_PUBKEY:-}" ]; then
  echo "$SCANNER_SSH_PUBKEY" > /home/scanner/.ssh/authorized_keys
  chmod 600 /home/scanner/.ssh/authorized_keys
  chown scanner:scanner /home/scanner/.ssh/authorized_keys
  echo "[entrypoint] SSH public key injected for scanner user"
else
  echo "[entrypoint] WARNING: SCANNER_SSH_PUBKEY not set -- SSH login will not work"
fi

# Verify all security tools are present
echo "[entrypoint] Verifying security tools..."
for tool in gitleaks trufflehog trivy jf; do
  if ! command -v "$tool" > /dev/null 2>&1; then
    echo "[entrypoint] ERROR: $tool not found"
    exit 1
  fi
  echo "[entrypoint]   $tool: OK"
done

# Write JFrog credentials so run-scans.sh can source them
mkdir -p /etc/beast
if [ -n "${JF_URL:-}" ] && [ -n "${JF_ACCESS_TOKEN:-}" ]; then
  echo "CI=true" > /etc/beast/env
  echo "JF_URL=$JF_URL" >> /etc/beast/env
  echo "JF_ACCESS_TOKEN=$JF_ACCESS_TOKEN" >> /etc/beast/env
  chmod 600 /etc/beast/env
  chown scanner:scanner /etc/beast/env
  echo "[entrypoint] JFrog CLI configured for $JF_URL"
else
  echo "[entrypoint] NOTE: JF_URL/JF_ACCESS_TOKEN not set -- jf audit will be skipped"
fi

# The tool cache is a named volume. Docker seeds it from the image on first
# mount, but a volume created before that path existed in the image (or one
# restored from a backup) can come up root-owned — and then trivy silently has
# nowhere to put a 1.4 GB database. Fix it here, while we are still root.
mkdir -p /home/scanner/.cache
if [ "$(stat -c %u /home/scanner/.cache)" != "$(id -u scanner)" ]; then
  echo "[entrypoint] Tool cache is not owned by scanner -- fixing ownership"
  chown -R scanner:scanner /home/scanner/.cache
fi
echo "[entrypoint] Tool cache: $(du -sh /home/scanner/.cache 2>/dev/null | cut -f1) at /home/scanner/.cache"

# Generate host keys if they don't exist (first run)
ssh-keygen -A 2>/dev/null || true

# Nightly Trivy DB refresh (/etc/cron.d/beast-trivy-db). Without it every scan
# would eventually hit a cold cache and block on the download.
echo "[entrypoint] Starting cron for the nightly Trivy DB refresh..."
cron

echo "[entrypoint] Starting SSH daemon..."
exec /usr/sbin/sshd -D -e
