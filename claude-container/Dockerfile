# BEAST Claude Code Scanner Container
# Based on official Claude Code devcontainer pattern (node:20 Debian)
FROM node:20

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    git \
    jq \
    procps \
    curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Configure SSH
RUN mkdir -p /var/run/sshd && \
    sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config && \
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Create scanner user with home directory and bash shell
RUN useradd -m -s /bin/bash scanner && \
    mkdir -p /home/scanner/.ssh && \
    chmod 700 /home/scanner/.ssh && \
    chown -R scanner:scanner /home/scanner/.ssh && \
    git config --system --add safe.directory '*'

# Install Claude Code globally
RUN npm install -g @anthropic-ai/claude-code

# Create workspace and prompts directories, owned by scanner
RUN mkdir -p /workspace /prompts && \
    chown -R scanner:scanner /workspace /prompts

# Copy entrypoint, prompts, and hooks
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
COPY prompts/ /prompts/
COPY hooks/ /opt/beast/
RUN chmod +x /opt/beast/*.sh

EXPOSE 22

CMD ["/usr/local/bin/entrypoint.sh"]
