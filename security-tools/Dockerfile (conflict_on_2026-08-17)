# syntax=docker/dockerfile:1
# BEAST Security Tools Scanner Container
# Multi-stage build with BuildKit parallelism and cache mounts.
# Stages 1-3 build in parallel; runtime only COPYs results.

# ── Stage: binary tool downloads ───────────────────────────────────
FROM ubuntu:24.04 AS downloader
ARG TARGETARCH
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends curl ca-certificates

ARG GITLEAKS_VERSION=8.21.2
ARG TRUFFLEHOG_VERSION=3.88.0
ARG TRIVY_VERSION=0.69.3
ARG OSV_SCANNER_VERSION=1.9.1

RUN set -e && \
    if [ "$TARGETARCH" = "arm64" ]; then \
      GL=arm64; TH=arm64; TV=ARM64; OSV=arm64; \
    else \
      GL=x64; TH=amd64; TV=64bit; OSV=amd64; \
    fi && \
    curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_${GL}.tar.gz" \
      | tar xz -C /usr/local/bin gitleaks && \
    curl -sSfL "https://github.com/trufflesecurity/trufflehog/releases/download/v${TRUFFLEHOG_VERSION}/trufflehog_${TRUFFLEHOG_VERSION}_linux_${TH}.tar.gz" \
      | tar xz -C /usr/local/bin trufflehog && \
    curl -sSfL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-${TV}.tar.gz" \
      | tar xz -C /usr/local/bin trivy && \
    curl -fL https://getcli.jfrog.io/v2-jf | sh && mv ./jf /usr/local/bin/jf && chmod +x /usr/local/bin/jf && \
    curl -fsSL "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_${OSV}" \
      -o /usr/local/bin/osv-scanner && chmod +x /usr/local/bin/osv-scanner


# ── Stage: Python security tools in venvs ─────────────────────────
FROM ubuntu:24.04 AS python-builder
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv python3-dev gcc

# semgrep + checkov (compatible deps, shared venv)
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m venv /opt/security-venv && \
    /opt/security-venv/bin/pip install semgrep checkov

# Presidio + spacy NLP model (isolated — dep conflicts)
# NOTE: typer >=0.16 dropped click as a hard dep, but spacy's CLI still imports
# it directly (`from click import NoSuchOption`). Install click explicitly so
# `spacy download` works.
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m venv /opt/presidio-venv && \
    /opt/presidio-venv/bin/pip install presidio-analyzer presidio-anonymizer click && \
    /opt/presidio-venv/bin/python -m spacy download en_core_web_lg

# ggshield (isolated — marshmallow/click conflicts)
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m venv /opt/ggshield-venv && \
    /opt/ggshield-venv/bin/pip install ggshield

# Poetry (isolated)
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m venv /opt/poetry-venv && \
    /opt/poetry-venv/bin/pip install poetry


# ── Stage: third-party semgrep rules ──────────────────────────────
FROM alpine/git:latest AS rules-fetcher
RUN git clone --depth 1 https://github.com/apiiro/malicious-code-ruleset.git /rules/apiiro && \
    rm -rf /rules/apiiro/.git /rules/apiiro/README.md /rules/apiiro/LICENSE /rules/apiiro/CONTRIBUTING.md


# ── Runtime ───────────────────────────────────────────────────────
FROM ubuntu:24.04

# 1. System packages — heaviest layer, rarely changes
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends \
      openssh-server git bash jq ca-certificates \
      nodejs npm \
      maven gradle default-jdk-headless \
      python3 python3-venv pipenv \
      golang \
      dotnet-sdk-8.0 \
      composer \
      ruby bundler

# 2. Static config — SSH, user, directories (never changes)
RUN mkdir -p /var/run/sshd && \
    sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config && \
    sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config && \
    useradd -m -s /bin/bash -u 1001 scanner && \
    mkdir -p /home/scanner/.ssh /workspace /scripts && \
    chmod 700 /home/scanner/.ssh && \
    chown -R scanner:scanner /home/scanner/.ssh /workspace && \
    git config --system --add safe.directory '*'

# 3. Binary security tools (from parallel download stage)
COPY --from=downloader /usr/local/bin/gitleaks    /usr/local/bin/
COPY --from=downloader /usr/local/bin/trufflehog  /usr/local/bin/
COPY --from=downloader /usr/local/bin/trivy       /usr/local/bin/
COPY --from=downloader /usr/local/bin/jf          /usr/local/bin/
COPY --from=downloader /usr/local/bin/osv-scanner /usr/local/bin/

# 4. Python tool venvs (from parallel build stage)
COPY --from=python-builder /opt/security-venv /opt/security-venv
COPY --from=python-builder /opt/presidio-venv /opt/presidio-venv
COPY --from=python-builder /opt/ggshield-venv /opt/ggshield-venv
COPY --from=python-builder /opt/poetry-venv   /opt/poetry-venv
RUN ln -sf /opt/security-venv/bin/semgrep  /usr/local/bin/semgrep && \
    ln -sf /opt/security-venv/bin/checkov  /usr/local/bin/checkov && \
    ln -sf /opt/ggshield-venv/bin/ggshield /usr/local/bin/ggshield && \
    ln -sf /opt/poetry-venv/bin/poetry     /usr/local/bin/poetry

# 5. Node global tools
RUN --mount=type=cache,target=/root/.npm \
    npm install -g yarn pnpm snyk

# 6. Third-party rules (from parallel clone stage)
COPY --from=rules-fetcher /rules/apiiro /rules/apiiro

# 7. Local files — LAST (most likely to change between builds)
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY scripts/ /scripts/
RUN chmod +x /usr/local/bin/entrypoint.sh /scripts/*.sh
COPY rules/ /rules/

EXPOSE 22
CMD ["/usr/local/bin/entrypoint.sh"]
