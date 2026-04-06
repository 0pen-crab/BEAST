#!/bin/bash
# Run all security scanning tools against a cloned repository.
# Usage: run-scans.sh <results_dir> <repo_path>
# Each tool writes its own output file to results_dir.
# Last line of stdout is a JSON summary of all tool results.
set -euo pipefail

# Source JFrog credentials written by entrypoint
if [ -f /etc/beast/env ]; then
  set -a
  . /etc/beast/env
  set +a
fi

RESULTS_DIR="$1"
REPO_PATH="$2"
ENABLED_TOOLS="${3:-}"
ENV_FILE="${4:-}"

# Source credentials if env file provided, then delete it
if [[ -n "$ENV_FILE" && -f "$ENV_FILE" ]]; then
  echo "[security-tools] Sourcing credentials from $ENV_FILE"
  source "$ENV_FILE"
  rm -f "$ENV_FILE"
else
  echo "[security-tools] WARNING: No env file provided or file not found: ${ENV_FILE:-<empty>}"
fi

# Log which credential env vars are set (values redacted)
for _var in SNYK_TOKEN GITGUARDIAN_API_KEY JF_URL JF_ACCESS_TOKEN; do
  _val="${!_var:-}"
  if [ -n "$_val" ]; then
    echo "[security-tools] ${_var} = set (${#_val} chars)"
  else
    echo "[security-tools] ${_var} = NOT SET"
  fi
done

# Check if a tool is enabled (empty ENABLED_TOOLS = backward compat, all enabled)
is_enabled() {
  [[ -z "$ENABLED_TOOLS" ]] && return 0
  [[ ",$ENABLED_TOOLS," == *",$1,"* ]]
}

# Associative arrays to track per-tool results
declare -A TOOL_STATUS TOOL_EXIT TOOL_FILE TOOL_DURATION TOOL_ERROR

# Write a valid empty result file so every tool that runs gets a DB record.
write_empty_result() {
  local outfile="$1"
  local key="$2"
  local status="${3:-success}"
  local exit_code="${4:-0}"

  local exec_ok="true"
  [[ "$status" == "failed" ]] && exec_ok="false"

  case "$outfile" in
    *.sarif)
      printf '{"version":"2.1.0","runs":[{"tool":{"driver":{"name":"%s","rules":[]}},"results":[],"invocations":[{"executionSuccessful":%s,"exitCode":%s}]}]}\n' \
        "$key" "$exec_ok" "$exit_code" > "$outfile"
      ;;
    *.json)
      case "$key" in
        trivy-*) echo '{"Results":[]}' > "$outfile" ;;
        bearer) echo '{}' > "$outfile" ;;
        *) echo '[]' > "$outfile" ;;
      esac
      ;;
  esac
}

# Run a tool, capturing exit code, stderr, and duration. On failure, write empty result.
# Usage: run_tool <key> <output_file> <command...>
run_tool() {
  local key="$1"
  local outfile="$2"
  shift 2

  local stderr_file stdout_file
  stderr_file=$(mktemp)
  stdout_file=$(mktemp)
  local exit_code=0

  echo "[security-tools] Running ${key}..."
  local start_ms end_ms
  start_ms=$(date +%s%3N)
  "$@" >"$stdout_file" 2>"$stderr_file" || exit_code=$?
  end_ms=$(date +%s%3N)

  local stderr_content stdout_content
  stderr_content=$(head -c 2000 "$stderr_file" 2>/dev/null || true)
  stdout_content=$(head -c 2000 "$stdout_file" 2>/dev/null || true)
  rm -f "$stderr_file" "$stdout_file"

  # Build error message from whichever stream has content (some tools write errors to stdout)
  local error_msg="$stderr_content"
  if [ -z "$error_msg" ]; then
    error_msg="$stdout_content"
  fi

  TOOL_DURATION[$key]=$((end_ms - start_ms))

  # Non-zero exit but output file has content = findings detected (not a failure).
  # Many tools (osv-scanner, semgrep, snyk) use exit code 1 to signal findings.
  if [ $exit_code -ne 0 ] && [ -s "$outfile" ]; then
    echo "[security-tools] ${key} exited ${exit_code} with output (findings detected)"
    TOOL_STATUS[$key]="success"
    TOOL_EXIT[$key]=$exit_code
    TOOL_FILE[$key]=$(basename "$outfile")
    return 0
  fi

  # Non-zero exit + no output = tool failed
  if [ $exit_code -ne 0 ]; then
    # Truncate error message to first line, max 300 chars
    local short_error
    short_error=$(echo "$error_msg" | head -1 | cut -c1-300)
    echo "[security-tools] ${key} failed with exit code ${exit_code}: ${short_error}"
    write_empty_result "$outfile" "$key" "failed" "$exit_code"
    TOOL_STATUS[$key]="failed"
    TOOL_EXIT[$key]=$exit_code
    TOOL_FILE[$key]=$(basename "$outfile")
    TOOL_ERROR[$key]="$short_error"
    return 0  # Don't fail the script
  fi

  # Exit 0 + empty output = tool succeeded but found nothing (not a failure)
  if [ ! -s "$outfile" ]; then
    write_empty_result "$outfile" "$key" "success" "0"
    TOOL_STATUS[$key]="success"
    TOOL_EXIT[$key]=0
    TOOL_FILE[$key]=$(basename "$outfile")
    echo "[security-tools] ${key} complete (no findings)"
    return 0
  fi

  # Exit 0 + has output = tool succeeded with results
  TOOL_STATUS[$key]="success"
  TOOL_EXIT[$key]=$exit_code
  TOOL_FILE[$key]=$(basename "$outfile")
  echo "[security-tools] ${key} complete"
  return 0
}

echo "[security-tools] Starting scans on $REPO_PATH"
echo "[security-tools] Results directory: $RESULTS_DIR"

# -- Gitleaks (secrets detection) ------------------------------------------
# Note: --exit-code=0 means exit 0 even when leaks found
if is_enabled "gitleaks"; then
  run_tool "gitleaks" "$RESULTS_DIR/gitleaks-results.json" \
    gitleaks detect \
      --source="$REPO_PATH" \
      --report-format=json \
      --report-path="$RESULTS_DIR/gitleaks-results.json" \
      --exit-code=0
else
  TOOL_STATUS["gitleaks"]="skipped"
  TOOL_EXIT["gitleaks"]=""
  TOOL_FILE["gitleaks"]="null"
  TOOL_DURATION["gitleaks"]=0
fi

# -- Trufflehog (secrets detection) ----------------------------------------
if is_enabled "trufflehog"; then
  TRUFFLEHOG_OUT="$RESULTS_DIR/trufflehog-results.json"
  run_tool_trufflehog() {
    local ec=0
    trufflehog filesystem \
      --directory="$REPO_PATH" \
      --json \
      --no-update \
      > "$TRUFFLEHOG_OUT" || ec=$?
    # Exit code 183 = findings detected — that's success, not failure
    if [ "$ec" -eq 0 ] || [ "$ec" -eq 183 ]; then
      # No output = no secrets found. Write empty array so the file is valid JSON.
      if [ ! -s "$TRUFFLEHOG_OUT" ]; then
        echo '[]' > "$TRUFFLEHOG_OUT"
      fi
      return 0
    fi
    return "$ec"
  }
  run_tool "trufflehog" "$TRUFFLEHOG_OUT" run_tool_trufflehog
else
  TOOL_STATUS["trufflehog"]="skipped"
  TOOL_EXIT["trufflehog"]=""
  TOOL_FILE["trufflehog"]="null"
  TOOL_DURATION["trufflehog"]=0
fi

# -- Trivy (each scan type runs separately for independent enable/disable) --
if is_enabled "trivy-secrets"; then
  run_tool "trivy-secrets" "$RESULTS_DIR/trivy-secrets-results.json" \
    trivy fs \
      --scanners secret \
      --format json \
      --output "$RESULTS_DIR/trivy-secrets-results.json" \
      "$REPO_PATH"
else
  TOOL_STATUS["trivy-secrets"]="skipped"; TOOL_EXIT["trivy-secrets"]=""; TOOL_FILE["trivy-secrets"]="null"; TOOL_DURATION["trivy-secrets"]=0
fi

if is_enabled "trivy-sca"; then
  run_tool "trivy-sca" "$RESULTS_DIR/trivy-sca-results.json" \
    trivy fs \
      --scanners vuln \
      --format json \
      --output "$RESULTS_DIR/trivy-sca-results.json" \
      "$REPO_PATH"
else
  TOOL_STATUS["trivy-sca"]="skipped"; TOOL_EXIT["trivy-sca"]=""; TOOL_FILE["trivy-sca"]="null"; TOOL_DURATION["trivy-sca"]=0
fi

if is_enabled "trivy-iac"; then
  run_tool "trivy-iac" "$RESULTS_DIR/trivy-iac-results.json" \
    trivy fs \
      --scanners misconfig \
      --format json \
      --output "$RESULTS_DIR/trivy-iac-results.json" \
      "$REPO_PATH"
else
  TOOL_STATUS["trivy-iac"]="skipped"; TOOL_EXIT["trivy-iac"]=""; TOOL_FILE["trivy-iac"]="null"; TOOL_DURATION["trivy-iac"]=0
fi

# -- JFrog CLI (SCA dependency scanning via Xray) -------------------------
# Note: jf audit exits non-zero when it finds vulnerabilities OR when sub-scans
# (SAST/Secrets/IaC) fail, but still produces valid SARIF with dependency results.
# We can't use run_tool() here because it deletes output on non-zero exit.
if is_enabled "jfrog"; then
  # Normalize JF_URL: ensure https:// prefix
  if [ -n "${JF_URL:-}" ] && [[ "$JF_URL" != http://* ]] && [[ "$JF_URL" != https://* ]]; then
    JF_URL="https://${JF_URL}"
    echo "[security-tools] JF_URL normalized to $JF_URL"
  fi
  if command -v jf > /dev/null 2>&1 && [ -n "${JF_URL:-}" ] && [ -n "${JF_ACCESS_TOKEN:-}" ]; then
    # Detect project types and warn about missing package managers
    _jf_missing=""
    [ -f "$REPO_PATH/pom.xml" ] && ! command -v mvn > /dev/null 2>&1 && _jf_missing="${_jf_missing} maven(mvn)"
    [ -f "$REPO_PATH/build.gradle" ] && ! command -v gradle > /dev/null 2>&1 && _jf_missing="${_jf_missing} gradle"
    [ -f "$REPO_PATH/go.mod" ] && ! command -v go > /dev/null 2>&1 && _jf_missing="${_jf_missing} go"
    [ -f "$REPO_PATH/package-lock.json" ] && ! command -v npm > /dev/null 2>&1 && _jf_missing="${_jf_missing} npm"
    [ -f "$REPO_PATH/yarn.lock" ] && ! command -v yarn > /dev/null 2>&1 && _jf_missing="${_jf_missing} yarn"
    [ -f "$REPO_PATH/pnpm-lock.yaml" ] && ! command -v pnpm > /dev/null 2>&1 && _jf_missing="${_jf_missing} pnpm"
    [ -f "$REPO_PATH/requirements.txt" ] && ! command -v pip > /dev/null 2>&1 && _jf_missing="${_jf_missing} pip"
    [ -f "$REPO_PATH/Pipfile.lock" ] && ! command -v pipenv > /dev/null 2>&1 && _jf_missing="${_jf_missing} pipenv"
    [ -f "$REPO_PATH/poetry.lock" ] && ! command -v poetry > /dev/null 2>&1 && _jf_missing="${_jf_missing} poetry"
    [ -f "$REPO_PATH/composer.lock" ] && ! command -v composer > /dev/null 2>&1 && _jf_missing="${_jf_missing} composer"
    [ -f "$REPO_PATH/Gemfile.lock" ] && ! command -v bundle > /dev/null 2>&1 && _jf_missing="${_jf_missing} bundler"
    (ls "$REPO_PATH"/*.csproj 2>/dev/null | head -1 | grep -q .) && ! command -v dotnet > /dev/null 2>&1 && _jf_missing="${_jf_missing} dotnet"
    if [ -n "$_jf_missing" ]; then
      echo "[security-tools] WARNING: jf-audit SCA may fail — missing package managers:${_jf_missing}"
    fi

    JF_OUT="$RESULTS_DIR/jf-audit-results.sarif"
    JF_ERR=$(mktemp)
    echo "[security-tools] Running jf-audit..."
    jf_exit=0
    jf_start_ms=$(date +%s%3N)
    (cd "$REPO_PATH" && CI=true jf audit --url="$JF_URL" --access-token="$JF_ACCESS_TOKEN" --vuln --format=sarif) > "$JF_OUT" 2>"$JF_ERR" || jf_exit=$?
    jf_end_ms=$(date +%s%3N)
    jf_stderr=$(head -c 2000 "$JF_ERR" 2>/dev/null || true)
    rm -f "$JF_ERR"

    TOOL_DURATION["jf-audit"]=$((jf_end_ms - jf_start_ms))

    # Accept results if valid SARIF was produced, regardless of exit code
    if [ -s "$JF_OUT" ] && python3 -c "import json; json.load(open('$JF_OUT'))" 2>/dev/null; then
      TOOL_STATUS["jf-audit"]="success"
      TOOL_EXIT["jf-audit"]=$jf_exit
      TOOL_FILE["jf-audit"]="jf-audit-results.sarif"
      echo "[security-tools] jf-audit complete (exit $jf_exit, valid SARIF)"
    elif [ $jf_exit -ne 0 ]; then
      # Capture error: try stderr first, fall back to whatever is in the output file
      jf_error_msg="$jf_stderr"
      if [ -z "$jf_error_msg" ] && [ -s "$JF_OUT" ]; then
        jf_error_msg=$(head -c 2000 "$JF_OUT" 2>/dev/null || true)
      fi
      write_empty_result "$JF_OUT" "jf-audit" "failed" "$jf_exit"
      TOOL_STATUS["jf-audit"]="failed"
      TOOL_EXIT["jf-audit"]=$jf_exit
      TOOL_FILE["jf-audit"]="jf-audit-results.sarif"
      TOOL_ERROR["jf-audit"]=$(echo "$jf_error_msg" | head -1 | cut -c1-300)
      echo "[security-tools] jf-audit failed with exit code $jf_exit: ${TOOL_ERROR["jf-audit"]}"
    else
      write_empty_result "$JF_OUT" "jf-audit" "failed" "0"
      TOOL_STATUS["jf-audit"]="failed"
      TOOL_EXIT["jf-audit"]=0
      TOOL_FILE["jf-audit"]="jf-audit-results.sarif"
      TOOL_ERROR["jf-audit"]="produced empty/invalid output"
      echo "[security-tools] jf-audit produced empty/invalid output"
    fi
  else
    echo "[security-tools] Skipping jf audit (JF_URL/JF_ACCESS_TOKEN not set)"
    TOOL_STATUS["jf-audit"]="skipped"
    TOOL_EXIT["jf-audit"]=""
    TOOL_FILE["jf-audit"]="null"
    TOOL_DURATION["jf-audit"]=0
  fi
else
  TOOL_STATUS["jf-audit"]="skipped"
  TOOL_EXIT["jf-audit"]=""
  TOOL_FILE["jf-audit"]="null"
  TOOL_DURATION["jf-audit"]=0
fi

# -- Semgrep (SAST) -----------------------------------------------------------
if is_enabled "semgrep"; then
  run_tool "semgrep" "$RESULTS_DIR/semgrep-results.sarif" \
    semgrep scan \
      --config auto \
      --config p/owasp-top-ten \
      --config p/trailofbits \
      --config /rules/apiiro \
      --sarif -o "$RESULTS_DIR/semgrep-results.sarif" "$REPO_PATH"
else
  TOOL_STATUS["semgrep"]="skipped"; TOOL_EXIT["semgrep"]=""; TOOL_FILE["semgrep"]="null"; TOOL_DURATION["semgrep"]=0
fi

# -- OSV-Scanner (SCA) --------------------------------------------------------
if is_enabled "osv-scanner"; then
  run_tool "osv-scanner" "$RESULTS_DIR/osv-scanner-results.sarif" \
    osv-scanner scan --format sarif --output "$RESULTS_DIR/osv-scanner-results.sarif" -r "$REPO_PATH"
else
  TOOL_STATUS["osv-scanner"]="skipped"; TOOL_EXIT["osv-scanner"]=""; TOOL_FILE["osv-scanner"]="null"; TOOL_DURATION["osv-scanner"]=0
fi

# -- Checkov (IaC) ------------------------------------------------------------
if is_enabled "checkov"; then
  run_tool "checkov" "$RESULTS_DIR/checkov-results.sarif" \
    checkov -d "$REPO_PATH" --soft-fail -o sarif --output-file-path "$RESULTS_DIR"
  if [[ -f "$RESULTS_DIR/results_sarif.sarif" ]]; then
    mv "$RESULTS_DIR/results_sarif.sarif" "$RESULTS_DIR/checkov-results.sarif"
    TOOL_STATUS["checkov"]="success"
  fi
else
  TOOL_STATUS["checkov"]="skipped"; TOOL_EXIT["checkov"]=""; TOOL_FILE["checkov"]="null"; TOOL_DURATION["checkov"]=0
fi

# -- GitGuardian (secrets) -----------------------------------------------------
if is_enabled "gitguardian"; then
  run_tool "gitguardian" "$RESULTS_DIR/gitguardian-results.sarif" \
    ggshield secret scan path "$REPO_PATH" -r -y --format sarif --output "$RESULTS_DIR/gitguardian-results.sarif"
else
  TOOL_STATUS["gitguardian"]="skipped"; TOOL_EXIT["gitguardian"]=""; TOOL_FILE["gitguardian"]="null"; TOOL_DURATION["gitguardian"]=0
fi

# Snyk exit codes: 0=clean, 1=vulns found (success), 2=error, 3=no supported files (not an error)
# Wrapper converts exit 3 to exit 0 (nothing to scan = success with 0 findings)
run_snyk() {
  local ec=0
  "$@" || ec=$?
  if [ "$ec" -eq 3 ]; then
    echo "[security-tools] snyk: no supported files found (exit 3 → treating as clean)"
    return 0
  fi
  return "$ec"
}

# -- Snyk SCA ------------------------------------------------------------------
if is_enabled "snyk-sca"; then
  pushd "$REPO_PATH" > /dev/null
  run_tool "snyk-sca" "$RESULTS_DIR/snyk-sca-results.sarif" \
    run_snyk snyk test --all-projects --sarif-file-output="$RESULTS_DIR/snyk-sca-results.sarif"
  popd > /dev/null
else
  TOOL_STATUS["snyk-sca"]="skipped"; TOOL_EXIT["snyk-sca"]=""; TOOL_FILE["snyk-sca"]="null"; TOOL_DURATION["snyk-sca"]=0
fi

# -- Snyk Code (SAST) ---------------------------------------------------------
if is_enabled "snyk-code"; then
  pushd "$REPO_PATH" > /dev/null
  run_tool "snyk-code" "$RESULTS_DIR/snyk-code-results.sarif" \
    run_snyk snyk code test --sarif-file-output="$RESULTS_DIR/snyk-code-results.sarif"
  popd > /dev/null
else
  TOOL_STATUS["snyk-code"]="skipped"; TOOL_EXIT["snyk-code"]=""; TOOL_FILE["snyk-code"]="null"; TOOL_DURATION["snyk-code"]=0
fi

# -- Snyk IaC ------------------------------------------------------------------
if is_enabled "snyk-iac"; then
  pushd "$REPO_PATH" > /dev/null
  run_tool "snyk-iac" "$RESULTS_DIR/snyk-iac-results.sarif" \
    run_snyk snyk iac test --sarif-file-output="$RESULTS_DIR/snyk-iac-results.sarif"
  popd > /dev/null
else
  TOOL_STATUS["snyk-iac"]="skipped"; TOOL_EXIT["snyk-iac"]=""; TOOL_FILE["snyk-iac"]="null"; TOOL_DURATION["snyk-iac"]=0
fi

# -- Bearer (PII — sensitive data flows) --------------------------------------
if is_enabled "bearer"; then
  run_tool "bearer" "$RESULTS_DIR/bearer-results.json" \
    bearer scan "$REPO_PATH" --report dataflow --format json --output "$RESULTS_DIR/bearer-results.json" --quiet
else
  TOOL_STATUS["bearer"]="skipped"; TOOL_EXIT["bearer"]=""; TOOL_FILE["bearer"]="null"; TOOL_DURATION["bearer"]=0
fi

# -- Presidio (PII — NLP-based personal data detection) -----------------------
if is_enabled "presidio"; then
  run_tool "presidio" "$RESULTS_DIR/presidio-results.sarif" \
    /opt/presidio-venv/bin/python /scripts/presidio-scan.py "$REPO_PATH" "$RESULTS_DIR/presidio-results.sarif"
else
  TOOL_STATUS["presidio"]="skipped"; TOOL_EXIT["presidio"]=""; TOOL_FILE["presidio"]="null"; TOOL_DURATION["presidio"]=0
fi

# -- Semgrep PII (PII-specific rules) -----------------------------------------
if is_enabled "semgrep-pii"; then
  run_tool "semgrep-pii" "$RESULTS_DIR/semgrep-pii-results.sarif" \
    semgrep scan --config /rules/pii.yaml --sarif -o "$RESULTS_DIR/semgrep-pii-results.sarif" "$REPO_PATH"
else
  TOOL_STATUS["semgrep-pii"]="skipped"; TOOL_EXIT["semgrep-pii"]=""; TOOL_FILE["semgrep-pii"]="null"; TOOL_DURATION["semgrep-pii"]=0
fi

echo "[security-tools] All scans complete"

# -- Build JSON summary (last line of stdout) ------------------------------
TOOLS_JSON=()
for key in gitleaks trufflehog trivy-secrets trivy-sca trivy-iac jf-audit semgrep osv-scanner checkov gitguardian snyk-sca snyk-code snyk-iac bearer presidio semgrep-pii; do
  if [ -n "${TOOL_STATUS[$key]+x}" ]; then
    status="${TOOL_STATUS[$key]}"
    exit_code="${TOOL_EXIT[$key]}"
    duration_ms="${TOOL_DURATION[$key]:-0}"
    error_msg="${TOOL_ERROR[$key]:-}"
    [[ -z "$exit_code" ]] && exit_code="null"
    # Escape quotes and backslashes in error message for valid JSON
    error_msg="${error_msg//\\/\\\\}"
    error_msg="${error_msg//\"/\\\"}"
    if [ -n "$error_msg" ]; then
      TOOLS_JSON+=("\"${key}\":{\"status\":\"${status}\",\"exit_code\":${exit_code},\"duration_ms\":${duration_ms},\"error\":\"${error_msg}\"}")
    else
      TOOLS_JSON+=("\"${key}\":{\"status\":\"${status}\",\"exit_code\":${exit_code},\"duration_ms\":${duration_ms}}")
    fi
  fi
done

echo "{\"tools\":{$(IFS=,; echo "${TOOLS_JSON[*]}")}}"
