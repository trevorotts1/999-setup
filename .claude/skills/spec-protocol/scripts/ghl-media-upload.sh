#!/usr/bin/env bash
# ghl-media-upload.sh — Upload a local file to GHL media storage in a
# project-labeled folder. Part of the media persistence pipeline (Issue 9).
#
# API CONTRACT (sourced: OpenAPI spec mirror Bleupreneur/ghl-cli spec/medias.json
# and mastanley13/GoHighLevel-MCP ghl-api-client.ts):
#   POST /medias/upload-file — headers Authorization: Bearer <token>,
#     Version: 2021-07-28 (required, enum single value),
#     Content-Type: multipart/form-data. Form fields: file (binary),
#     hosted (bool; true => fileUrl required instead of file), fileUrl, name,
#     parentId (target folder). Direct upload cap 25 MB.
#     Response: UploadFileResponseDTO {fileId (required), url (required)} —
#     url is the Google Cloud Storage URL, directly referenceable in HTML.
#     There is NO hostedUrl field — never code against one.
#   POST /medias/folder — JSON {altId, altType: "location", name,
#     parentId (optional)}. Response: FolderDTO (200 per spec).
#   GET /medias/files — REQUIRED params: Version, sortBy, sortOrder, type,
#     altType, altId. Optional: offset, limit, query, parentId, fetchAll.
#   Scopes: upload = medias.write; list = medias.readonly; delete = medias.write;
#     folder/rename carry an empty scope list in the spec. UNVERIFIED: whether
#     medias.* exist as marketplace-app OAuth scopes outside private
#     integrations — verify in the GHL dashboard Private Integrations screen.
#
# USAGE
#   ghl-media-upload.sh <local-file> <project-slug> [item-id]
#
#   local-file    Path to the image file to upload (must exist, readable)
#   project-slug  Project slug used as folder name (e.g. "acme-co-funnel")
#   item-id       Optional work-item id for naming (basename used when absent)
#
# CREDENTIALS sourced from the live shell environment. At least ONE of these
# variable pairs must resolve:
#   PIT:  GOHIGHLEVEL_API_KEY | GHL_API_KEY | GOHIGHLEVEL_LOCATION_PIT
#         | GHL_LOCATION_PIT  | CAF_API_KEY  | PIT_TOKEN | GHL_PIT
#         | GOHIGHLEVEL_PIT   | CONVERTANDFLOW_API_KEY | CONVERTANDFLOW_PIT
#   LOCATION_ID: GOHIGHLEVEL_LOCATION_ID | GHL_LOCATION_ID | CAF_LOCATION_ID
#         | GOHIGHLEVEL_ALLOWED_LOCATION_IDS (first ID)
#
# OUTPUT (stdout) — JSON with keys:
#   fileId      GHL file ID of the uploaded asset
#   url         Permanent GHL media URL (Google Cloud Storage)
#   folderId    GHL folder ID of the project folder
#   folderName  Project folder name
#   folderStatus "created" | "reused"
#   status      "ok" | "fail"
#   message     Human-readable detail on failure
#
# EXIT CODES
#   0 — upload succeeded (url is usable)
#   1 — credential error (missing PIT or Location ID)
#   2 — input file missing or unreadable
#   3 — folder create/list failed
#   4 — upload failed
#   5 — upload verification failed (read-back returned no matching file)

set -euo pipefail

# ---- Config ----------------------------------------------------------------
GHL_BASE="https://services.leadconnectorhq.com"
VERSION="2021-07-28"

# ---- Arg parsing -----------------------------------------------------------
LOCAL_FILE="${1:-}"
PROJECT_SLUG="${2:-}"
ITEM_ID="${3:-}"

if [ -z "$LOCAL_FILE" ] || [ -z "$PROJECT_SLUG" ]; then
  echo '{"status":"fail","message":"Usage: ghl-media-upload.sh <local-file> <project-slug> [item-id]"}'
  exit 2
fi

if [ ! -f "$LOCAL_FILE" ] || [ ! -r "$LOCAL_FILE" ]; then
  echo "{\"status\":\"fail\",\"message\":\"File not found or unreadable: $LOCAL_FILE\"}"
  exit 2
fi

# ---- Resolve credentials ---------------------------------------------------
# The live shell environment is checked FIRST (an exported key wins, per
# references/environment-sweep.md); the home-level stores are sourced as
# fallback so a sourced-but-unexported key still resolves. Never prints a value.
resolve_credentials() {
  PIT=""
  for var in GOHIGHLEVEL_API_KEY GHL_API_KEY GOHIGHLEVEL_LOCATION_PIT GHL_LOCATION_PIT CAF_API_KEY PIT_TOKEN GHL_PIT GOHIGHLEVEL_PIT CONVERTANDFLOW_API_KEY CONVERTANDFLOW_PIT; do
    if [ -n "${!var:-}" ]; then
      PIT="${!var}"
      break
    fi
  done

  LOCATION_ID=""
  for var in GOHIGHLEVEL_LOCATION_ID GHL_LOCATION_ID CAF_LOCATION_ID GOHIGHLEVEL_ALLOWED_LOCATION_IDS; do
    if [ -n "${!var:-}" ]; then
      val="${!var}"
      # GOHIGHLEVEL_ALLOWED_LOCATION_IDS may be comma-separated; take first
      LOCATION_ID="${val%%,*}"
      break
    fi
  done
}

resolve_credentials

# Fallback: source the standard env stores (same stores as tools/env-sweep.sh)
# ONLY for what the live environment did not provide — a live exported value
# is never overwritten by a store. Snapshot the live values first so sourcing
# a store cannot clobber them.
LIVE_PIT="$PIT"
LIVE_LOCATION_ID="$LOCATION_ID"
if [ -z "$PIT" ] || [ -z "$LOCATION_ID" ]; then
  for env_file in "${HOME}/.openclaw/secrets/.env" "${HOME}/.openclaw/.env" "${HOME}/.env"; do
    if [ -f "$env_file" ]; then
      # shellcheck disable=SC1090
      source "$env_file" 2>/dev/null || true
    fi
  done
  resolve_credentials
  # Restore live values over store values
  [ -n "$LIVE_PIT" ] && PIT="$LIVE_PIT"
  [ -n "$LIVE_LOCATION_ID" ] && LOCATION_ID="$LIVE_LOCATION_ID"
fi

if [ -z "$PIT" ]; then
  echo '{"status":"fail","message":"GHL PIT (API key) not found in environment — checked GOHIGHLEVEL_API_KEY, GHL_API_KEY, GOHIGHLEVEL_LOCATION_PIT, GHL_LOCATION_PIT, CAF_API_KEY, PIT_TOKEN, GHL_PIT, GOHIGHLEVEL_PIT, CONVERTANDFLOW_API_KEY, CONVERTANDFLOW_PIT"}'
  exit 1
fi

if [ -z "$LOCATION_ID" ]; then
  echo '{"status":"fail","message":"GHL Location ID not found in environment — checked GOHIGHLEVEL_LOCATION_ID, GHL_LOCATION_ID, CAF_LOCATION_ID, GOHIGHLEVEL_ALLOWED_LOCATION_IDS"}'
  exit 1
fi

# ---- Helper: do a curl GET with auth headers and write body to stdout -------
ghl_get() {
  local url="$1"
  curl -s -H "Authorization: Bearer $PIT" -H "Version: $VERSION" "$url"
}

ghl_post() {
  local url="$1"
  local data="$2"
  curl -s -w "\n%{http_code}" \
    -H "Authorization: Bearer $PIT" \
    -H "Version: $VERSION" \
    -H "Content-Type: application/json" \
    -X POST -d "$data" "$url"
}

# ---- 1. List existing folder by name ---------------------------------------
FOLDER_ID=""
FOLDER_STATUS="created"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Listing folders for slug: $PROJECT_SLUG" >&2

# sortBy and sortOrder are REQUIRED by the OpenAPI spec (medias.json GET /medias/files)
LIST_RESP=$(ghl_get "$GHL_BASE/medias/files?sortBy=name&sortOrder=asc&type=folder&query=$PROJECT_SLUG&altType=location&altId=$LOCATION_ID")
# Parse JSON — find folder with matching name; use grep|sed to avoid jq dependency.
# POSIX ERE only (macOS BSD grep has no -P). Split the response into one line
# per folder object, then find the object whose name matches the slug.
FOLDER_ID=$(echo "$LIST_RESP" \
  | tr '}' '\n' \
  | grep -F "\"name\":\"$PROJECT_SLUG\"" \
  | grep -oE '"_id":"[^"]*"' \
  | head -1 \
  | sed 's/"_id":"//;s/"//' || true)

if [ -n "$FOLDER_ID" ]; then
  FOLDER_STATUS="reused"
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Reusing existing folder: $FOLDER_ID" >&2
else
  # ---- 2. Create folder ----------------------------------------------------
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Creating folder: $PROJECT_SLUG" >&2
  CREATE_RESP=$(ghl_post "$GHL_BASE/medias/folder" \
    "{\"altId\":\"$LOCATION_ID\",\"altType\":\"location\",\"name\":\"$PROJECT_SLUG\",\"parentId\":\"\"}")
  HTTP_CODE=$(echo "$CREATE_RESP" | tail -1)
  BODY=$(echo "$CREATE_RESP" | sed '$d')

  # OpenAPI spec (medias.json POST /medias/folder) declares 200; tolerate 201
  # (some GHL deployments return 201 for creates)
  if [ "$HTTP_CODE" != "200" ] && [ "$HTTP_CODE" != "201" ]; then
    echo "{\"status\":\"fail\",\"message\":\"Folder creation failed (HTTP $HTTP_CODE): $BODY\"}"
    exit 3
  fi

  FOLDER_ID=$(echo "$BODY" | grep -o '"_id":"[^"]*"' | head -1 | sed 's/"_id":"//;s/"//g' || true)
  if [ -z "$FOLDER_ID" ]; then
    echo "{\"status\":\"fail\",\"message\":\"Folder created but could not parse ID from: $BODY\"}"
    exit 3
  fi
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Created folder: $FOLDER_ID" >&2
fi

# ---- 3. Upload file --------------------------------------------------------
BASENAME=$(basename "$LOCAL_FILE")
if [ -n "$ITEM_ID" ]; then
  UPLOAD_NAME="${ITEM_ID}__${BASENAME}"
else
  UPLOAD_NAME="$BASENAME"
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Uploading $LOCAL_FILE as $UPLOAD_NAME to folder $FOLDER_ID" >&2

# curl multipart upload — body to temp file, HTTP code captured from stdout
UPLOAD_TMP=$(mktemp)
HTTP_CODE=$(curl -s -w "%{http_code}" \
  -H "Authorization: Bearer $PIT" \
  -H "Version: $VERSION" \
  -F "file=@$LOCAL_FILE" \
  -F "name=$UPLOAD_NAME" \
  -F "parentId=$FOLDER_ID" \
  -o "$UPLOAD_TMP" \
  "$GHL_BASE/medias/upload-file" 2>/dev/null || true)
UPLOAD_BODY=$(cat "$UPLOAD_TMP")

if [ "${HTTP_CODE:-0}" != "200" ] && [ "${HTTP_CODE:-0}" != "201" ]; then
  echo "{\"status\":\"fail\",\"message\":\"Upload failed (HTTP $HTTP_CODE): $(echo "$UPLOAD_BODY" | head -c 500)\"}"
  rm -f "$UPLOAD_TMP"
  exit 4
fi

FILE_ID=$(echo "$UPLOAD_BODY" | grep -o '"fileId":"[^"]*"' | head -1 | sed 's/"fileId":"//;s/"//g' || true)
FILE_URL=$(echo "$UPLOAD_BODY" | grep -o '"url":"[^"]*"' | head -1 | sed 's/"url":"//;s/"//g' || true)
rm -f "$UPLOAD_TMP"

if [ -z "$FILE_URL" ]; then
  echo "{\"status\":\"fail\",\"message\":\"Upload succeeded but no URL in response: $UPLOAD_BODY\"}"
  exit 4
fi

echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Upload success: fileId=$FILE_ID url=$FILE_URL" >&2

# ---- 4. Verify upload by reading back (list files in folder) ---------------
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Verifying upload via read-back..." >&2
# sortBy and sortOrder are REQUIRED by the OpenAPI spec (medias.json GET /medias/files)
VERIFY_RESP=$(ghl_get "$GHL_BASE/medias/files?sortBy=name&sortOrder=asc&type=file&parentId=$FOLDER_ID&altType=location&altId=$LOCATION_ID&limit=5")
VERIFY_MATCH=$(echo "$VERIFY_RESP" | grep -c "$FILE_ID" 2>/dev/null || true)
if [ "$VERIFY_MATCH" -eq 0 ]; then
  echo "{\"status\":\"fail\",\"message\":\"Upload verification failed — file $FILE_ID not found in read-back\",\"fileId\":\"$FILE_ID\",\"url\":\"$FILE_URL\",\"folderId\":\"$FOLDER_ID\",\"folderName\":\"$PROJECT_SLUG\",\"folderStatus\":\"$FOLDER_STATUS\"}"
  exit 5
fi

# ---- 5. Output result ------------------------------------------------------
echo "{\"status\":\"ok\",\"fileId\":\"$FILE_ID\",\"url\":\"$FILE_URL\",\"folderId\":\"$FOLDER_ID\",\"folderName\":\"$PROJECT_SLUG\",\"folderStatus\":\"$FOLDER_STATUS\"}"
exit 0