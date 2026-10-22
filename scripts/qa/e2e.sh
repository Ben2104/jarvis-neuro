#!/usr/bin/env bash
# End to end against a running stack: health -> upload four NIfTIs -> poll to done -> case in index -> manifest.
# Usage: scripts/qa/e2e.sh BASE_URL T1C T1 T2 FLAIR
#        scripts/qa/e2e.sh BASE_URL --synthetic        (tiny generated study; checks plumbing, not segmentation)
set -euo pipefail
base="${1:?base url, e.g. http://localhost:8080}"; shift
root="$(cd "$(dirname "$0")/../.." && pwd)"
if [[ "${1:-}" == "--synthetic" ]]; then
  tmp="$(mktemp -d)"
  (cd "$root/backend" && uv run python -c "
import sys; from pathlib import Path; from jarvis_neuro.synthetic import write_synthetic_study
f = write_synthetic_study(Path(sys.argv[1])); print(*(f[k] for k in ('t1c','t1','t2','flair')))" "$tmp") > "$tmp/paths"
  read -r t1c t1 t2 flair < "$tmp/paths"
else
  t1c="$1"; t1="$2"; t2="$3"; flair="$4"
fi

curl -sf "$base/api/health" >/dev/null && echo "health ok"
start=$(date +%s)
study=$(curl -sf -F "t1c=@$t1c" -F "t1=@$t1" -F "t2=@$t2" -F "flair=@$flair" "$base/api/studies" | jq -r .study_id)
echo "study $study"
while :; do
  body=$(curl -sf "$base/api/studies/$study")
  status=$(jq -r .status <<<"$body")
  printf '\r%-8s step=%-8s %4ss' "$status" "$(jq -r .step <<<"$body")" "$(( $(date +%s) - start ))"
  [[ "$status" == done || "$status" == failed ]] && break
  sleep 2
done
echo
jq . <<<"$body"
[[ "$status" == done ]] || { echo "FAIL: $(jq -r .error <<<"$body")"; exit 1; }
case_id=$(jq -r .case_id <<<"$body")
curl -sf "$base/cases/index.json" | jq -e --arg c "$case_id" '.cases[] | select(.case_id == $c)' >/dev/null && echo "index ok"
curl -sf "$base/cases/$case_id/monai-segresnet/manifest.json" | jq '{case_id, dims, assets: [.assets[] | {id, volume_ml}]}'
echo "e2e: PASS in $(( $(date +%s) - start ))s"
