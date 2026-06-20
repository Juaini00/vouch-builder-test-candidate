#!/usr/bin/env bash
# Read Cloud Run logs for semi-vouch — renders BOTH text and JSON payloads.
#
# Usage:
#   ./scripts/logs.sh                  # last 50 lines (all payload types)
#   ./scripts/logs.sh 200              # last 200 lines
#   ./scripts/logs.sh tail             # live tail
#   ./scripts/logs.sh trace trc_abc    # filter by trace_id
#   ./scripts/logs.sh app              # only app (Pino) logs, skip HTTP access
#   ./scripts/logs.sh errors           # only warnings + errors

set -euo pipefail

SERVICE="${SERVICE:-semi-vouch}"
REGION="${REGION:-asia-southeast1}"
PROJECT="$(gcloud config get-value project 2>/dev/null)"

CMD="${1:-50}"

# Common Cloud Logging filter for our service
SERVICE_FILTER="resource.type=cloud_run_revision AND resource.labels.service_name=${SERVICE}"

# Portable line reverser (tac is Linux-only; macOS has `tail -r`).
reverse_lines() {
  if command -v tac >/dev/null 2>&1; then
    tac
  elif tail -r </dev/null >/dev/null 2>&1; then
    tail -r
  else
    awk '{a[NR]=$0} END {for(i=NR;i>0;i--) print a[i]}'
  fi
}

# Render: each entry shows timestamp + severity + payload (text or JSON, whichever exists)
# jq prettifies jsonPayload; jq's // fallback handles textPayload-only entries.
render() {
  jq -r '
    .[]
    | .timestamp as $ts
    | (.severity // "INFO") as $sev
    | if .jsonPayload then
        ($ts + " [" + $sev + "] " + (.jsonPayload | tojson))
      elif .textPayload then
        ($ts + " [" + $sev + "] " + .textPayload)
      else
        ($ts + " [" + $sev + "] " + (. | tojson))
      end
  '
}

case "${CMD}" in
  tail)
    echo "Tailing logs (Ctrl+C to stop)…"
    gcloud beta run services logs tail "${SERVICE}" --region "${REGION}"
    ;;

  trace)
    TRACE_ID="${2:?usage: ./scripts/logs.sh trace trc_xxx}"
    echo "Filter: trace_id=${TRACE_ID}"
    gcloud logging read \
      "${SERVICE_FILTER} AND (jsonPayload.trace_id=\"${TRACE_ID}\" OR textPayload:\"${TRACE_ID}\")" \
      --limit 200 \
      --format=json \
      --order=asc \
      | render
    ;;

  app)
    echo "Filter: app logs only (Pino jsonPayload)"
    gcloud logging read \
      "${SERVICE_FILTER} AND jsonPayload:*" \
      --limit 100 \
      --format=json \
      --order=desc \
      | render \
      | reverse_lines
    ;;

  errors)
    echo "Filter: severity >= WARNING"
    gcloud logging read \
      "${SERVICE_FILTER} AND severity>=WARNING" \
      --limit 100 \
      --format=json \
      --order=desc \
      | render \
      | reverse_lines
    ;;

  *)
    LIMIT="${CMD}"
    echo "Last ${LIMIT} entries (all payloads)"
    gcloud logging read \
      "${SERVICE_FILTER}" \
      --limit "${LIMIT}" \
      --format=json \
      --order=desc \
      | render \
      | reverse_lines
    ;;
esac
