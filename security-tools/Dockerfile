# BEAST Security Tools Scanner Container
# Debian-based container with gitleaks, trufflehog, trivy, JFrog CLI,
# osv-scanner, semgrep, checkov, ggshield, and snyk

# -- Download stage: fetch tool binaries -----------------------------------
FROM ubuntu:24.04 AS downloader

ARG TARGETARCH

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

ARG GITLEAKS_VERSION=8.21.2
ARG TRUFFLEHOG_VERSION=3.88.0
ARG TRIVY_VERSION=0.69.3

# Each tool uses different naming conventions for architectures:
#   gitleaks:   x64 / arm64
#   trufflehog: amd64 / arm64
#   trivy:      64bit / ARM64

RUN if [ "$TARGETARCH" = "arm64" ]; then GITLEAKS_ARCH=arm64; else GITLEAKS_ARCH=x64; fi && \
    curl -sSfL \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${GITLEAKS_ARCH}.tar.gz" \
    | tar xz -C /usr/local/bin gitleaks

RUN if [ "$TARGETARCH" = "arm64" ]; then TRUFFLEHOG_ARCH=arm64; else TRUFFLEHOG_ARCH=amd64; fi && \
    curl -sSfL \
      "https://github.com/trufflesecurity/trufflehog/releases/download/v${TRUFFLEHOG_VERSION}/trufflehog_${TRUFFLEHOG_VERSION}_linux_${TRUFFLEHOG_ARCH}.tar.gz" \
    | tar xz -C /usr/local/bin trufflehog

RUN if [ "$TARGETARCH" = "arm64" ]; then TRIVY_ARCH=ARM64; else TRIVY_ARCH=64bit; fi && \
    curl -sSfL \
      "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-${TRIVY_ARCH}.tar.gz" \
    | tar xz -C /usr/local/bin trivy

RUN curl -fL https://getcli.jfrog.io/v2-jf | sh && \
    mv ./jf /usr/local/bin/jf && \
    chmod +x /usr/local/bin/jf

# OSV-Scanner
ARG OSV_SCANNER_VERSION=1.9.1
RUN if [ "$TARGETARCH" = "arm64" ]; then OSV_ARCH="arm64"; else OSV_ARCH="amd64"; fi && \
    curl -fsSL "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_${OSV_ARCH}" \
    -o /usr/local/bin/osv-scanner && chmod +x /usr/local/bin/osv-scanner

# -- Runtime stage ---------------------------------------------------------
FROM ubuntu:24.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-server \
    git \
    bash \
    jq \
    ca-certificates \
    # -- JS/TS package managers --
    nodejs \
    npm \
    # -- Java (Maven + Gradle) --
    maven \
    gradle \
    default-jdk-headless \
    # -- Python package managers --
    python3 \
    python3-pip \
    python3-venv \
    pipenv \
    # -- Go --
    golang \
    # -- .NET --
    dotnet-sdk-8.0 \
    # -- PHP --
    composer \
    # -- Ruby --
    ruby \
    bundler \
    && rm -rf /var/lib/apt/lists/*

# Yarn + pnpm (not in apt)
RUN npm install -g yarn pnpm

# Poetry (Python) — isolated to avoid dep conflicts
RUN python3 -m venv /opt/poetry-venv && \
    /opt/poetry-venv/bin/pip install --no-cache-dir poetry && \
    ln -sf /opt/poetry-venv/bin/poetry /usr/local/bin/poetry

# Copy tool binaries from download stage
COPY --from=downloader /usr/local/bin/gitleaks /usr/local/bin/gitleaks
COPY --from=downloader /usr/local/bin/trufflehog /usr/local/bin/trufflehog
COPY --from=downloader /usr/local/bin/trivy /usr/local/bin/trivy
COPY --from=downloader /usr/local/bin/jf /usr/local/bin/jf
COPY --from=downloader /usr/local/bin/osv-scanner /usr/local/bin/osv-scanner

# Python-based security tools
RUN pip3 install --no-cache-dir --break-system-packages \
    semgrep \
    checkov

# ggshield in isolated venv: its deps (marshmallow, click) conflict with semgrep/checkov
RUN python3 -m venv /opt/ggshield-venv && \
    /opt/ggshield-venv/bin/pip install --no-cache-dir ggshield && \
    ln -sf /opt/ggshield-venv/bin/ggshield /usr/local/bin/ggshield

# Snyk CLI
RUN npm install -g snyk

# Configure SSH
RUN mkdir -p /var/run/sshd && \
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config

# Create scanner user with UID 1001 to match claude-runner (shared workspace volume)
RUN useradd -m -s /bin/bash -u 1001 scanner && \
    mkdir -p /home/scanner/.ssh && \
    chmod 700 /home/scanner/.ssh && \
    chown -R scanner:scanner /home/scanner/.ssh && \
    git config --system --add safe.directory '*'

# Create workspace and scripts directories
RUN mkdir -p /workspace /scripts && \
    chown -R scanner:scanner /workspace

# Copy entrypoint and scripts
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
COPY scripts/ /scripts/
RUN chmod +x /scripts/*.sh

EXPOSE 22

CMD ["/usr/local/bin/entrypoint.sh"]
