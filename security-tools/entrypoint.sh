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

# Generate host keys if they don't exist (first run)
ssh-keygen -A 2>/dev/null || true

echo "[entrypoint] Starting SSH daemon..."
exec /usr/sbin/sshd -D -e
