#!/usr/bin/env bash
# Deploy semi-vouch to Google Cloud Run.
#
# Usage:
#   ./scripts/deploy.sh                       # uses defaults below
#   SERVICE=semi-vouch-dev ./scripts/deploy.sh
#
# Required:
#   - gcloud CLI installed and authenticated (gcloud auth login)
#   - GCP project set      (gcloud config set project YOUR_PROJECT_ID)
#   - .env file at repo root with DEEPSEEK_API_KEY etc.
#
# What it does:
#   1. Loads vars from .env (skips comments, skips PORT)
#   2. Runs gcloud run deploy --source .
#   3. Sets env vars on the service from .env
#   4. Prints the deployed URL and a sample curl

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# -------- Defaults (override via env) --------
SERVICE="${SERVICE:-semi-vouch}"
REGION="${REGION:-asia-southeast1}"
MEMORY="${MEMORY:-1Gi}"          # 1Gi: LLM response JSON + Node GC headroom
CPU="${CPU:-1}"
TIMEOUT="${TIMEOUT:-120s}"       # 2 LLM calls × ~15s + buffer
MAX_INSTANCES="${MAX_INSTANCES:-5}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"
PORT_FLAG="${PORT_FLAG:-8080}"
ENV_FILE="${ENV_FILE:-.env}"

# -------- Preflight checks --------
if ! command -v gcloud >/dev/null 2>&1; then
  echo "✗ gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

PROJECT_ID="$(gcloud config get-value project 2>/dev/null || true)"
if [[ -z "${PROJECT_ID}" || "${PROJECT_ID}" == "(unset)" ]]; then
  echo "✗ No active GCP project. Run: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "✗ ${ENV_FILE} not found at repo root." >&2
  echo "  Copy .env.example to .env and fill in DEEPSEEK_API_KEY." >&2
  exit 1
fi

echo "──────────────────────────────────────────────"
echo "  Project   : ${PROJECT_ID}"
echo "  Service   : ${SERVICE}"
echo "  Region    : ${REGION}"
echo "  Memory    : ${MEMORY}"
echo "  Timeout   : ${TIMEOUT}"
echo "  Instances : ${MIN_INSTANCES}..${MAX_INSTANCES}"
echo "──────────────────────────────────────────────"

# -------- Build env-vars string from .env --------
# - skip blank lines and comments
# - skip PORT (Cloud Run injects its own)
# - escape commas in values (Cloud Run uses comma as separator)
ENV_VARS_ARG=""
while IFS= read -r line || [[ -n "${line}" ]]; do
  [[ -z "${line}" ]] && continue
  [[ "${line}" =~ ^[[:space:]]*# ]] && continue
  [[ ! "${line}" =~ = ]] && continue
  key="${line%%=*}"
  val="${line#*=}"
  key="$(echo "${key}" | xargs)"
  # strip surrounding quotes if present
  val="${val%\"}"
  val="${val#\"}"
  val="${val%\'}"
  val="${val#\'}"
  if [[ "${key}" == "PORT" ]]; then
    continue
  fi
  # Use "|" as separator between entries to allow commas inside values.
  if [[ -z "${ENV_VARS_ARG}" ]]; then
    ENV_VARS_ARG="${key}=${val}"
  else
    ENV_VARS_ARG="${ENV_VARS_ARG}|${key}=${val}"
  fi
done < "${ENV_FILE}"

# Cloud Run custom delimiter syntax: prefix "^DELIM^" once.
# Final form: "^|^KEY1=VAL1|KEY2=VAL2|..."
if [[ "${ENV_VARS_ARG}" == *"|"* ]]; then
  ENV_VARS_ARG="^|^${ENV_VARS_ARG}"
fi

# -------- Ensure APIs are enabled (idempotent, fast on repeat) --------
echo "→ ensuring APIs enabled (run, cloudbuild, artifactregistry)…"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  --quiet

# -------- Deploy --------
echo "→ deploying…"
gcloud run deploy "${SERVICE}" \
  --source . \
  --region "${REGION}" \
  --allow-unauthenticated \
  --memory "${MEMORY}" \
  --cpu "${CPU}" \
  --no-cpu-throttling \
  --timeout "${TIMEOUT}" \
  --max-instances "${MAX_INSTANCES}" \
  --min-instances "${MIN_INSTANCES}" \
  --port "${PORT_FLAG}" \
  --set-env-vars "${ENV_VARS_ARG}" \
  --quiet

# -------- Show URL + sample curl --------
URL="$(gcloud run services describe "${SERVICE}" \
  --region "${REGION}" \
  --format='value(status.url)')"

echo ""
echo "✓ Deployed: ${URL}"
echo ""
echo "Try it:"
echo "  curl ${URL}/health"
echo "  curl \"${URL}/handover/sample\" | jq ."
echo "  curl \"${URL}/handover/sample?targetMorning=2026-05-30\" | jq ."
echo "  curl \"${URL}/handover/sample?format=html\""
echo "  curl -X POST ${URL}/handover \\"
echo "       -H 'content-type: application/json' \\"
echo "       -d @<(jq '{hotel, events, nightLog: \"\", targetMorning: \"2026-05-30\"}' data/events.json)"
