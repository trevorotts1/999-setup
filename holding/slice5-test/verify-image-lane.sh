#!/usr/bin/env bash
# WF-3B slice 5 — Issue 7 FIX step 5 verification harness.
# Real submit-and-poll against the kie.ai jobs API per the contract in
# media-pipeline.md section 2 / spec Issue 7 FIX step 2 (no base64, async only).
# Executes the lane's exact ordering: PROVIDER-READY gate -> manifest row
# (PLANNED) -> SUBMITTED -> poll -> GENERATED-CAPTURED (download + verify).
# Modes:
#   verify-image-lane.sh live     <outdir>  # working key: every row -> real file (costs credits)
#   verify-image-lane.sh dead     <outdir>  # dead key: gate fails closed, MEDIA-GAPS manifest, zero images (free)
#   verify-image-lane.sh stub     <outdir>  # STUB provider: manifest-driven, real files, 1:1 accounting (no network)
#   verify-image-lane.sh stubfail <outdir>  # STUB provider failing mid-run: rows FAILED, MEDIA-GAPS, zero images (no network)
set -u

MODE="${1:?mode live|dead|stub|stubfail}"
OUTDIR="${2:?outdir}"
KIE_BASE="https://api.kie.ai"
MODEL="gpt-image-2-text-to-image"   # resolved member, smoke-proven per run
ASPECT="1:1"
RESOLUTION="1K"
SLOT1="hero:main"
SLOT2="body:feature"
PROMPT="band-passing-1K-smoke"

# --- credential handling: value from env, never printed, never committed ---
if [[ "${MODE}" == "live" ]]; then
  KEY="${KIE_API_KEY:-${KIE_AI_API_KEY:-${KIE_KEY:-}}}"
  if [[ -z "${KEY}" ]]; then
    echo "LIVE-MODE: no KIE_API_KEY in environment" >&2
    exit 2
  fi
elif [[ "${MODE}" == "dead" ]]; then
  KEY="sk-dead-0000000000000000000000000000000000000000"  # dead key, known bad
else
  KEY="stub-key"  # stub modes never touch the network
fi

mkdir -p "${OUTDIR}"
MANIFEST="${OUTDIR}/manifest.tsv"
GAPS="${OUTDIR}/media-gaps.tsv"
: > "${MANIFEST}"
: > "${GAPS}"
rm -f "${OUTDIR}"/row*-result.txt "${OUTDIR}"/submit-row*.json "${OUTDIR}"/accounting.txt

# --- bearer request; key never on argv (never in the process table) ---
# Config goes to a temp file (here-string + pipe conflict: `--config - <<< body`
# makes the here-string win stdin, so curl parses the JSON body as config and
# exits with nothing — measured harness defect 2026-08-16, fixed this way).
bearer_curl() {
  local method="$1" url="$2" body="${3:-}"
  local cfg
  cfg="$(mktemp "${TMPDIR:-/tmp}/kiesmoke-cfg.XXXXXX")"
  # MEASURED 2026-08-16: createTask WITHOUT Content-Type: application/json
  # returns body.code 500 "Server exception" even with a valid key; WITH the
  # header the same call returns {"code":200,"data":{"taskId":...}}. The header
  # is load-bearing and is part of this lane's request shape.
  printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\n' "${KEY}" > "${cfg}"
  chmod 600 "${cfg}"
  if [[ -n "${body}" ]]; then
    curl -sS -X "${method}" --max-time 30 --config "${cfg}" \
      --data-binary @- -o - -w $'\n%{http_code}' "${url}" <<<"${body}" 2>/dev/null
  else
    curl -sS -X "${method}" --max-time 30 --config "${cfg}" \
      -o - -w $'\n%{http_code}' "${url}" 2>/dev/null
  fi
  rm -f "${cfg}"
}

http_code_of() { echo "$1" | tail -1; }
body_of() { echo "$1" | sed '$d'; }

# --- MEDIA-GAPS manifest (9.3): one entry per planned slot, fully-prepared
# prompt, estimated cost, the named error, and the DECLARED placeholder marker
# (the honest marked space — never a blank square, never a stock stand-in). ---
write_gaps() {
  local err="$1"
  printf 'slot=%s\tpage=index\tsize=%s\taspect=%s\tprompt=%s\tprovider=kie\tmodel=%s\tcost=est-6-credits\terror=%s\tplaceholder=DECLARED\n' \
    "${SLOT1}" "${RESOLUTION}" "${ASPECT}" "${PROMPT}" "${MODEL}" "${err}" >> "${GAPS}"
  printf 'slot=%s\tpage=index\tsize=%s\taspect=%s\tprompt=%s\tprovider=kie\tmodel=%s\tcost=est-6-credits\terror=%s\tplaceholder=DECLARED\n' \
    "${SLOT2}" "${RESOLUTION}" "${ASPECT}" "${PROMPT}" "${MODEL}" "${err}" >> "${GAPS}"
}

# --- STUB provider: deterministic minimal PNG (real file, real magic bytes) ---
stub_png() {
  local out="$1" rgb="$2"
  python3 - "${out}" "${rgb}" <<'PYEOF'
import struct, sys, zlib
out, rgb = sys.argv[1], bytes.fromhex(sys.argv[2])
def chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
ihdr = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
idat = zlib.compress(b'\x00' + rgb)
open(out, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b''))
PYEOF
}

# --- 1:1 accounting (14.3): manifest rows vs result records vs image files;
# orphan scan proves zero images without a manifest row; file check proves
# every GENERATED-CAPTURED row has its real file. ---
accounting() {
  local rows files results orphans=0 missing=0
  rows=$(grep -c . "${MANIFEST}" 2>/dev/null || true)
  [[ -z "${rows}" ]] && rows=0
  files=$(find "${OUTDIR}" -maxdepth 1 -name '*.png' | wc -l | tr -d ' ')
  results=$(find "${OUTDIR}" -maxdepth 1 -name 'row*-result.txt' | wc -l | tr -d ' ')
  for f in "${OUTDIR}"/*.png; do
    [[ -e "$f" ]] || continue
    base=$(basename "$f")
    if ! grep -q "file=.*${base}" "${OUTDIR}"/row*-result.txt 2>/dev/null; then
      orphans=$((orphans+1))
    fi
  done
  for r in "${OUTDIR}"/row*-result.txt; do
    [[ -e "$r" ]] || continue
    if grep -q '^status=GENERATED-CAPTURED' "$r"; then
      f=$(sed -E 's/.*file=([^ ]*).*/\1/' "$r" | head -1)
      if [[ ! -s "$f" ]]; then missing=$((missing+1)); fi
    fi
  done
  {
    echo "manifest-rows=${rows}"
    echo "result-records=${results}"
    echo "image-files=${files}"
    echo "orphan-images=${orphans}"
    echo "generated-captured-missing-file=${missing}"
  } > "${OUTDIR}/accounting.txt"
  echo "accounting: rows=${rows} results=${results} files=${files} orphans=${orphans} missing=${missing}"
}

# --- PROVIDER-READY gate (section 14): liveness first, cheapest call ---
# VERIFIED 2026-08-16: the kie.ai API answers EVERY authenticated call with
# HTTP 200 regardless of key validity; the discriminator is the JSON body's
# `code` field (dead key -> {"code":401}, live key -> {"code":200}). An
# HTTP-status-only liveness check (env-sweep.sh curl_bearer_status) cannot
# discriminate LIVE from FOUND_NOT_LIVE — the gate MUST parse the body.
if [[ "${MODE}" == "stub" || "${MODE}" == "stubfail" ]]; then
  gate_http="200"   # stub gate: provider reachable by construction, no network
  echo "PROVIDER-READY: stub gate PASS (no network)"
else
  gate_raw=$(printf 'header = "Authorization: Bearer %s"\n' "${KEY}" \
    | curl -s --max-time 15 --config - "${KIE_BASE}/api/v1/chat/credit" 2>/dev/null)
  gate_http=$(echo "${gate_raw}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("code","PARSE-FAIL"))' 2>/dev/null)
  echo "PROVIDER-READY: credit-liveness body.code=${gate_http}"
fi
if [[ "${gate_http}" != "200" ]]; then
  echo "PROVIDER-READY: FAIL (body.code=${gate_http}) -> without-media path (9.3)"
  echo "GATE:FAIL body.code=${gate_http}" > "${OUTDIR}/gate.txt"
  # fail-closed: zero generation-eligible manifest rows; zero images; the
  # MEDIA-GAPS manifest carries every planned slot with its DECLARED placeholder
  write_gaps "PROVIDER-READY-FAIL-body.code-${gate_http}"
  echo "0 images created. Fail-closed confirmed: no generation-eligible manifest row, no generation attempted."
  accounting
  exit 0
fi
echo "GATE:PASS body.code=${gate_http}" > "${OUTDIR}/gate.txt"
echo "PROVIDER-READY: PASS -> image lane opens"

# --- manifest row BEFORE dispatch (14.1): one row per planned image ---
printf 'slot=%s\tpage=index\tsize=%s\taspect=%s\tprompt=%s\tprovider=kie\tmodel=%s\tcost=est-6-credits\ttemp-url=\texpiry=\tstatus=PLANNED\n' \
  "${SLOT1}" "${RESOLUTION}" "${ASPECT}" "${PROMPT}" "${MODEL}" >> "${MANIFEST}"
printf 'slot=%s\tpage=index\tsize=%s\taspect=%s\tprompt=%s\tprovider=kie\tmodel=%s\tcost=est-6-credits\ttemp-url=\texpiry=\tstatus=PLANNED\n' \
  "${SLOT2}" "${RESOLUTION}" "${ASPECT}" "${PROMPT}" "${MODEL}" >> "${MANIFEST}"
echo "manifest: 2 PLANNED rows written BEFORE first build dispatch"

# --- submit + poll per row (section 2 polling contract) ---
row=0
while IFS=$'\t' read -r _fields; do
  [[ -z "${_fields}" ]] && continue
  row=$((row+1))
  # extract fields
  local_slot=$(echo "${_fields}" | sed -E 's/slot=([^	]*).*/\1/')
  local_page=$(echo "${_fields}" | sed -E 's/.*page=([^	]*).*/\1/')
  echo "== row ${row}: slot=${local_slot} page=${local_page} =="

  if [[ "${MODE}" == "stub" ]]; then
    scode=200
    sbody="{\"code\":200,\"msg\":\"success\",\"data\":{\"taskId\":\"stub-${row}\"}}"
  elif [[ "${MODE}" == "stubfail" ]]; then
    scode=200
    sbody="{\"code\":500,\"msg\":\"Server exception (stub provider failure)\",\"data\":null}"
  else
    body="{\"model\":\"${MODEL}\",\"input\":{\"prompt\":\"a minimal geometric shape, flat vector style, solid background, no text\",\"aspect_ratio\":\"${ASPECT}\",\"resolution\":\"${RESOLUTION}\"}}"
    submit=$(bearer_curl POST "${KIE_BASE}/api/v1/jobs/createTask" "${body}")
    scode=$(http_code_of "${submit}")
    sbody=$(body_of "${submit}")
  fi
  echo "createTask HTTP ${scode}"
  echo "${sbody}" > "${OUTDIR}/submit-row${row}.json"

  # VERIFIED 2026-08-16: createTask answers HTTP 200 even for a dead key, with
  # the failure in body.code ({"code":401}). HTTP status alone cannot
  # discriminate — the body code field is the discriminator. A 401-in-body at
  # submit time is the MID-RUN key-death shape: fail-closed, row FAILED, named
  # error, zero images.
  bcode=$(echo "${sbody}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("code",""))' 2>/dev/null)
  if [[ "${scode}" != "200" || "${bcode}" != "200" ]]; then
    # fail-closed (14.2): mark row FAILED with the named error, MEDIA-GAPS
    # entry with the DECLARED placeholder, no download, no image
    echo "FAILED: createTask http=${scode} body.code=${bcode} -> row marked FAILED, MEDIA-GAPS entry, no download"
    echo "status=FAILED error=http-${scode}-body-${bcode}" >> "${OUTDIR}/row${row}-result.txt"
    printf 'slot=%s\tpage=index\tsize=%s\taspect=%s\tprompt=%s\tprovider=kie\tmodel=%s\tcost=est-6-credits\terror=http-%s-body-%s\tplaceholder=DECLARED\n' \
      "${local_slot}" "${RESOLUTION}" "${ASPECT}" "${PROMPT}" "${MODEL}" "${scode}" "${bcode}" >> "${GAPS}"
    sed -i '' "${row}s/status=PLANNED/status=FAILED/" "${MANIFEST}"
    continue
  fi
  task_id=$(echo "${sbody}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["taskId"])' 2>/dev/null)
  if [[ -z "${task_id}" ]]; then
    echo "FAILED: createTask 200 but no taskId in body -> treated as provider failure"
    echo "status=FAILED error=no-taskId" >> "${OUTDIR}/row${row}-result.txt"
    printf 'slot=%s\tpage=index\tsize=%s\taspect=%s\tprompt=%s\tprovider=kie\tmodel=%s\tcost=est-6-credits\terror=no-taskId\tplaceholder=DECLARED\n' \
      "${local_slot}" "${RESOLUTION}" "${ASPECT}" "${PROMPT}" "${MODEL}" >> "${GAPS}"
    sed -i '' "${row}s/status=PLANNED/status=FAILED/" "${MANIFEST}"
    continue
  fi
  echo "taskId=${task_id}"

  if [[ "${MODE}" == "stub" ]]; then
    # stub poll: terminal success immediately; stub capture: deterministic file
    state="success"
    outfile="${OUTDIR}/row${row}-${local_slot}.png"
    rgb="ff0000"; [[ "${row}" == "2" ]] && rgb="0000ff"
    stub_png "${outfile}" "${rgb}"
  else
    # poll: first at 30s, then every 30s, timeout 10 min per section 2
    state=""
    polls=0
    while true; do
      sleep 30
      polls=$((polls+1))
      poll=$(bearer_curl GET "${KIE_BASE}/api/v1/jobs/recordInfo?taskId=${task_id}")
      pcode=$(http_code_of "${poll}")
      pbody=$(body_of "${poll}")
      if [[ "${pcode}" != "200" ]]; then
        echo "poll HTTP ${pcode} (transport) — retrying, poll ${polls}"
        if [[ "${polls}" -ge 20 ]]; then
          echo "FAILED-TIMEOUT: poll never returned 200 after ${polls} attempts"
          echo "status=FAILED-TIMEOUT taskId=${task_id}" >> "${OUTDIR}/row${row}-result.txt"
          sed -i '' "${row}s/status=PLANNED/status=FAILED-TIMEOUT/" "${MANIFEST}"
          break
        fi
        continue
      fi
      state=$(echo "${pbody}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["state"])' 2>/dev/null)
      echo "poll ${polls}: state=${state}"
      case "${state}" in
        waiting|queuing|generating) : ;;
        success)
          result_urls=$(echo "${pbody}" | python3 -c 'import sys,json; d=json.load(sys.stdin)["data"]; print(d.get("resultJson",""))' 2>/dev/null)
          url=$(echo "${result_urls}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["resultUrls"][0])' 2>/dev/null)
          echo "terminal success. resultUrl=${url}"
          # CAPTURE IN THE SAME POLL ITERATION (13.2 Phase A): download + verify
          outfile="${OUTDIR}/row${row}-${local_slot}.png"
          printf 'header = "Authorization: Bearer %s"\n' "${KEY}" \
            | curl -sS --max-time 60 --config - -o "${outfile}" "${url}" 2>/dev/null
          break
          ;;
        fail)
          fcode=$(echo "${pbody}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"].get("failCode",""))' 2>/dev/null)
          fmsg=$(echo "${pbody}" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"].get("failMsg",""))' 2>/dev/null)
          echo "terminal fail: failCode=${fcode} failMsg=${fmsg}"
          echo "status=FAILED error=${fcode} ${fmsg}" >> "${OUTDIR}/row${row}-result.txt"
          printf 'slot=%s\tpage=index\tsize=%s\taspect=%s\tprompt=%s\tprovider=kie\tmodel=%s\tcost=est-6-credits\terror=%s-%s\tplaceholder=DECLARED\n' \
            "${local_slot}" "${RESOLUTION}" "${ASPECT}" "${PROMPT}" "${MODEL}" "${fcode}" "${fmsg}" >> "${GAPS}"
          sed -i '' "${row}s/status=PLANNED/status=FAILED/" "${MANIFEST}"
          break
          ;;
        *)
          echo "unknown state ${state} — poll ${polls}"
          ;;
      esac
      if [[ "${polls}" -ge 20 ]]; then
        echo "FAILED-TIMEOUT: 10 min exceeded"
        echo "status=FAILED-TIMEOUT taskId=${task_id}" >> "${OUTDIR}/row${row}-result.txt"
        sed -i '' "${row}s/status=PLANNED/status=FAILED-TIMEOUT/" "${MANIFEST}"
        break
      fi
    done
  fi

  # --- capture verification (shared by live and stub): non-empty, magic, sha ---
  if [[ "${state}" == "success" ]]; then
    if [[ -s "${outfile}" ]]; then
      magic=$(xxd -p -l 8 "${outfile}" | tr -d '\n')
      sha=$(shasum -a 256 "${outfile}" | awk '{print $1}')
      size=$(wc -c < "${outfile}")
      echo "captured: ${outfile} bytes=${size} magic=${magic} sha256=${sha}"
      echo "status=GENERATED-CAPTURED file=${outfile} bytes=${size} magic=${magic} sha256=${sha}" >> "${OUTDIR}/row${row}-result.txt"
      sed -i '' "${row}s/status=PLANNED/status=GENERATED-CAPTURED/" "${MANIFEST}"
    else
      echo "FAILED-CAPTURE: terminal success but file empty"
      echo "status=FAILED-CAPTURE taskId=${task_id}" >> "${OUTDIR}/row${row}-result.txt"
      sed -i '' "${row}s/status=PLANNED/status=FAILED-CAPTURE/" "${MANIFEST}"
    fi
  fi
done < "${MANIFEST}"

echo "=== run complete ==="
echo "files in ${OUTDIR}:"
ls -la "${OUTDIR}" | grep -v '^total\|^d'
echo "manifest rows: $(wc -l < "${MANIFEST}" | tr -d ' ')"
echo "MEDIA-GAPS entries: $(wc -l < "${GAPS}" | tr -d ' ')"
accounting
