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

# Ensure Claude Code auth directory exists with correct ownership
# OAuth credentials are persisted via the claude_auth volume mount
mkdir -p /home/scanner/.claude
chown -R scanner:scanner /home/scanner/.claude
echo "[entrypoint] Claude auth directory ready at /home/scanner/.claude"

# Install Claude Code hooks (rate limit detection)
cp /opt/beast/settings.json /home/scanner/.claude/settings.json
chown scanner:scanner /home/scanner/.claude/settings.json
echo "[entrypoint] Claude Code hooks installed"

# Check if Claude Code is authenticated (OAuth tokens present)
if [ -d "/home/scanner/.claude" ] && find /home/scanner/.claude -name "*.json" -maxdepth 2 2>/dev/null | grep -q .; then
  echo "[entrypoint] Claude Code OAuth credentials found"
else
  echo "[entrypoint] NOTE: Claude Code not yet authenticated -- run 'docker exec -it <container> su - scanner -c \"claude login\"' to authenticate via OAuth"
fi

# Generate host keys if they don't exist (first run)
ssh-keygen -A 2>/dev/null || true

echo "[entrypoint] Starting SSH daemon..."
exec /usr/sbin/sshd -D -e
