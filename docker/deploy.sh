#!/bin/bash
# =============================================================
# SenKey Cloud Run Deployment Script
# Deploys a Cloud Run image plus one SenKey credential storage bucket.
# =============================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ACTIVE_ACCOUNT="$(gcloud config get-value account 2>/dev/null || true)"

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

source "$ENV_FILE"
GENERATED_API_KEY="false"
REGION="${REGION:-us-west1}"
SERVICE_NAME="senkey-api"
REPOSITORY_NAME="senkey"
CHROME_EXTENSION_ID="${CHROME_EXTENSION_ID:-gcmgfpkabdjhniklindbjieohnfngchg}"

generate_api_key() {
  openssl rand -hex 32
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

echo "🎯  Setting active project..."
gcloud config set project "$PROJECT_ID"

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
if ! gcloud run deploy "$SERVICE_NAME" \
  --image "$IMAGE" \
  --region "$REGION" \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars "API_KEY=${API_KEY},GCS_BUCKET=${BUCKET_NAME},CHROME_EXTENSION_ID=${CHROME_EXTENSION_ID}" \
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
