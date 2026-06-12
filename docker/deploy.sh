#!/bin/bash
# =============================================================
# SenKey Cloud Run Deployment Script
# Deploys a Cloud Run image plus one SenKey credential storage bucket.
# =============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌  Required command not found: $1"
    exit 1
  fi
}

ENV_FILE="${SCRIPT_DIR}/.env"
if [ ! -f "$ENV_FILE" ]; then
  ENV_FILE="${ROOT_DIR}/.env"
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "❌  No .env file found."
  echo "    For the full repo: cp .env.example .env"
  echo "    For a shared docker bundle: cp docker/.env.example docker/.env"
  exit 1
fi

require_command gcloud
require_command openssl
require_command python3

ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"

source "$ENV_FILE"
GENERATED_API_KEY="false"
REGION="${REGION:-us-west1}"
SERVICE_NAME="senkey-api"
REPOSITORY_NAME="senkey"
PUBLISHED_CHROME_EXTENSION_ID="gcmgfpkabdjhniklindbjieohnfngchg"
PUBLISHED_GOOGLE_OAUTH_CLIENT_IDS="456135155814-6vbckdu5beemnfbajrehs6l5diehhaim.apps.googleusercontent.com,456135155814-src93bcdntarmoohu8bl2d97jjdfldn9.apps.googleusercontent.com"
CHROME_EXTENSION_ID="${CHROME_EXTENSION_ID:-$PUBLISHED_CHROME_EXTENSION_ID}"
CLOUD_RUN_ENV_FILE=""

cleanup() {
  if [ -n "$CLOUD_RUN_ENV_FILE" ] && [ -f "$CLOUD_RUN_ENV_FILE" ]; then
    rm -f "$CLOUD_RUN_ENV_FILE"
  fi
}

trap cleanup EXIT

generate_api_key() {
  openssl rand -hex 32
}

collect_google_oauth_client_ids() {
  local raw="${GOOGLE_OAUTH_CLIENT_IDS:-},${GOOGLE_OAUTH_CLIENT_ID:-},${DEV_GOOGLE_OAUTH_CLIENT_ID:-},${WEB_GOOGLE_OAUTH_CLIENT_ID:-}"
  local collected
  collected="$(printf '%s' "$raw" \
    | tr ',' '\n' \
    | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' \
    | awk '/^[^[:space:]]+\.apps\.googleusercontent\.com$/ && !seen[$0]++' \
    | paste -sd, -)"
  if [ -n "$collected" ]; then
    printf '%s' "$collected"
  elif [ "$CHROME_EXTENSION_ID" = "$PUBLISHED_CHROME_EXTENSION_ID" ]; then
    printf '%s' "$PUBLISHED_GOOGLE_OAUTH_CLIENT_IDS"
  fi
}

ensure_bucket() {
  echo "🗄️  Ensuring GCS bucket exists..."
  if gcloud storage buckets describe "gs://${BUCKET_NAME}" --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "    Bucket already exists."
    return
  fi

  if ! gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="$PROJECT_ID" \
    --location="$REGION" \
    --uniform-bucket-level-access; then
    echo ""
    echo "❌  Could not create storage bucket: gs://${BUCKET_NAME}"
    echo "    Check that the account has Storage Admin permission, billing is enabled,"
    echo "    and the bucket name is globally available."
    exit 1
  fi
}

ensure_artifact_repository() {
  echo "📦  Ensuring Artifact Registry repository exists..."
  if gcloud artifacts repositories describe "$REPOSITORY_NAME" \
    --location="$REGION" \
    --project="$PROJECT_ID" >/dev/null 2>&1; then
    echo "    Repository already exists."
    return
  fi

  gcloud artifacts repositories create "$REPOSITORY_NAME" \
    --repository-format=docker \
    --location="$REGION" \
    --description="SenKey backend container images" \
    --project="$PROJECT_ID"
}

persist_env_value() {
  local key="$1"
  local value="$2"
  python3 - "$ENV_FILE" "$key" "$value" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]
text = path.read_text() if path.exists() else ""
pattern = re.compile(rf"^{re.escape(key)}=.*$", re.M)
replacement = f"{key}={value}"
if pattern.search(text):
    text = pattern.sub(replacement, text, count=1)
else:
    if text and not text.endswith("\n"):
        text += "\n"
    text += replacement + "\n"
path.write_text(text)
PY
}

write_cloud_run_env_file() {
  local path="$1"
  export API_KEY BUCKET_NAME GOOGLE_OAUTH_CLIENT_IDS
  python3 - "$path" <<'PY'
from pathlib import Path
import json
import os
import sys

items = {
    "API_KEY": os.environ["API_KEY"],
    "GCS_BUCKET": os.environ["BUCKET_NAME"],
}

oauth_ids = os.environ.get("GOOGLE_OAUTH_CLIENT_IDS", "")
if oauth_ids:
    items["GOOGLE_OAUTH_CLIENT_IDS"] = oauth_ids

path = Path(sys.argv[1])
path.write_text("".join(f"{key}: {json.dumps(value)}\n" for key, value in items.items()))
PY
}

if [ -z "$PROJECT_ID" ]; then
  echo "❌  PROJECT_ID is not set in $ENV_FILE"
  exit 1
fi

case "$PROJECT_ID" in
  your-gcp-project-id|project-id|run-source-project-id)
    echo "❌  PROJECT_ID still looks like a placeholder: $PROJECT_ID"
    echo "    Open $ENV_FILE and set PROJECT_ID to your real Google Cloud project ID."
    echo "    Example: PROJECT_ID=my-senkey-project-123"
    exit 1
    ;;
esac

BUCKET_NAME="${PROJECT_ID}-senkey"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY_NAME}/${SERVICE_NAME}:latest"

if [ -z "$API_KEY" ]; then
  API_KEY="$(generate_api_key)"
  GENERATED_API_KEY="true"
  persist_env_value "API_KEY" "$API_KEY"
fi

GOOGLE_OAUTH_CLIENT_IDS="$(collect_google_oauth_client_ids)"

echo "🔎  Verifying project exists..."
if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
  echo "❌  Google Cloud project was not found: $PROJECT_ID"
  exit 1
fi

echo ""
echo "🚀  SenKey Cloud Run Deployer"
echo "================================"
echo "Project : $PROJECT_ID"
echo "Account : ${ACTIVE_ACCOUNT:-unknown}"
echo "Region  : $REGION"
echo "Service : $SERVICE_NAME"
echo "Config  : $ENV_FILE"
echo "Source  : $SCRIPT_DIR"
echo "Image   : $IMAGE"
echo "Bucket  : $BUCKET_NAME"
echo "Ext ID  : $CHROME_EXTENSION_ID"
if [ -n "$GOOGLE_OAUTH_CLIENT_IDS" ]; then
  echo "OAuth   : restricted to configured Google OAuth client IDs"
else
  echo "OAuth   : no client ID allow-list configured"
fi
if [ "$GENERATED_API_KEY" = "true" ]; then
  echo "API Key : generated and saved to $ENV_FILE"
fi
echo ""

echo "⚙️  Enabling required APIs..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  --project="$PROJECT_ID"

ensure_bucket
ensure_artifact_repository

echo "🔎  Verifying required entities..."
if ! [ -d "$SCRIPT_DIR" ]; then
  echo "❌  Source directory was not found: $SCRIPT_DIR"
  exit 1
fi
if ! gcloud storage buckets describe "gs://${BUCKET_NAME}" --project="$PROJECT_ID" >/dev/null 2>&1; then
  echo "❌  Storage bucket was not found after creation attempt: gs://${BUCKET_NAME}"
  exit 1
fi

echo "🏗️  Building container image..."
if ! gcloud builds submit "$SCRIPT_DIR" \
  --tag "$IMAGE" \
  --project="$PROJECT_ID"; then
  echo ""
  echo "❌  Container build failed."
  echo "Checked entities:"
  echo "  Project : $PROJECT_ID"
  echo "  Account : ${ACTIVE_ACCOUNT:-unknown}"
  echo "  Source  : $SCRIPT_DIR"
  echo "  Image   : $IMAGE"
  echo ""
  exit 1
fi

echo "📦  Deploying image to Cloud Run..."
CLOUD_RUN_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/senkey-cloudrun-env.XXXXXX")"
write_cloud_run_env_file "$CLOUD_RUN_ENV_FILE"

if ! gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --env-vars-file "$CLOUD_RUN_ENV_FILE" \
  --memory 128Mi \
  --cpu 1 \
  --max-instances 5 \
  --project="$PROJECT_ID"; then
  echo ""
  echo "❌  Cloud Run deploy failed."
  echo "Checked entities:"
  echo "  Project : $PROJECT_ID"
  echo "  Account : ${ACTIVE_ACCOUNT:-unknown}"
  echo "  Image   : $IMAGE"
  echo "  Bucket  : gs://${BUCKET_NAME}"
  echo ""
  exit 1
fi

SERVICE_URL=$(gcloud run services describe "$SERVICE_NAME" \
  --region "$REGION" \
  --project "$PROJECT_ID" \
  --format "value(status.url)")

echo ""
echo "✅  Deployment complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  API URL  :  ${SERVICE_URL}"
echo "  API Key  :  ${API_KEY}"
echo "  Ext ID   :  ${CHROME_EXTENSION_ID}"
echo "  Bucket   :  ${BUCKET_NAME}"
if [ -n "$GOOGLE_OAUTH_CLIENT_IDS" ]; then
  echo "  OAuth IDs:  ${GOOGLE_OAUTH_CLIENT_IDS}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
if [ "$GENERATED_API_KEY" = "true" ]; then
  echo "🔐  A new API key was generated automatically because API_KEY was blank."
  echo "    It has been saved to: ${ENV_FILE}"
  echo ""
fi
echo "👉  Paste the API URL and API Key into the SenKey extension ⚙ Settings tab."
echo "👉  In Google Cloud OAuth, use the Chrome Extension ID above as the Chrome App / Item ID."
echo ""
