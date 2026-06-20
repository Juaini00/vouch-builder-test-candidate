#!/usr/bin/env bash
# Smoke-test the deployed Cloud Run service.
#
# Usage:
#   ./scripts/test-prod.sh                          # auto-discovers URL via gcloud
#   ./scripts/test-prod.sh https://my-url.run.app   # explicit URL
#   URL=https://... ./scripts/test-prod.sh

set -euo pipefail

SERVICE="${SERVICE:-semi-vouch}"
REGION="${REGION:-asia-southeast1}"

URL="${1:-${URL:-}}"
if [[ -z "${URL}" ]]; then
  URL="$(gcloud run services describe "${SERVICE}" \
    --region "${REGION}" \
    --format='value(status.url)' 2>/dev/null || true)"
fi

if [[ -z "${URL}" ]]; then
  echo "✗ Could not determine service URL. Pass it as arg." >&2
  exit 1
fi

echo "Target: ${URL}"
echo ""

hit() {
  local label="$1"; shift
  echo "── ${label} ──"
  # shellcheck disable=SC2068
  curl -sS -w "\nHTTP %{http_code} in %{time_total}s\n" $@
  echo ""
}

hit "GET /health" "${URL}/health"
hit "GET /handover/sample (json)" \
  "${URL}/handover/sample"
hit "GET /handover/sample?targetMorning=2026-05-30 (json)" \
  "${URL}/handover/sample?targetMorning=2026-05-30"
hit "GET /handover/sample?format=html" \
  "${URL}/handover/sample?format=html"

# POST /handover — build a minimal valid body from the sample data
# (requires jq; falls back to a note if absent).
if command -v jq >/dev/null 2>&1 && [[ -f data/events.json ]]; then
  BODY="$(jq -c '{hotel, events, nightLog: "", targetMorning: "2026-05-30", format: "json"}' data/events.json)"
  echo "── POST /handover (sample body) ──"
  curl -sS -w "\nHTTP %{http_code} in %{time_total}s\n" \
    -X POST "${URL}/handover" \
    -H 'content-type: application/json' \
    --data "${BODY}"
  echo ""
else
  echo "── POST /handover — skipped (need jq + data/events.json locally) ──"
  echo ""
fi
