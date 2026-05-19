#!/bin/bash
# Builds the extension by merging manifest.json with values from .env
#
# Usage:
#   ./build.sh        — dev build (includes a stable manifest key)
#   ./build.sh prod   — Web Store upload build (outputs senkey.zip without a manifest key)
#
# Setup:
#   cp .env.example .env
#   # fill in GOOGLE_OAUTH_CLIENT_ID, DEV_GOOGLE_OAUTH_CLIENT_ID, API_KEY etc. in .env

set -e

if [ ! -f .env ]; then
  echo "❌  .env not found."
  echo "    cp .env.example .env  — then fill in your values."
  exit 1
fi

source .env
BUILD_MODE="${1:-dev}"
DEV_KEY_FILE="${DEV_KEY_FILE:-extension.dev.pem}"

if [ "$BUILD_MODE" != "prod" ] && [ -n "${DEV_GOOGLE_OAUTH_CLIENT_ID:-}" ]; then
  echo "🔐  Using DEV_GOOGLE_OAUTH_CLIENT_ID for dev build."
  GOOGLE_OAUTH_CLIENT_ID="$DEV_GOOGLE_OAUTH_CLIENT_ID"
fi

if [ -z "$GOOGLE_OAUTH_CLIENT_ID" ] || [ "$GOOGLE_OAUTH_CLIENT_ID" = "YOUR_CLIENT_ID.apps.googleusercontent.com" ] || [ "$GOOGLE_OAUTH_CLIENT_ID" = "your-google-oauth-client-id.apps.googleusercontent.com" ]; then
  if [ "$BUILD_MODE" = "prod" ]; then
    echo "❌  GOOGLE_OAUTH_CLIENT_ID is not set in .env"
    echo "    Create the production OAuth client manually in Google Cloud, then paste the generated client ID into .env."
  else
    echo "❌  GOOGLE_OAUTH_CLIENT_ID or DEV_GOOGLE_OAUTH_CLIENT_ID is required for dev builds."
    echo "    Create a Chrome Extension OAuth client for the dev extension ID printed by ./build.sh, then set DEV_GOOGLE_OAUTH_CLIENT_ID."
  fi
  exit 1
fi

if [ -z "$CHROME_EXTENSION_ID" ]; then
  echo "❌  CHROME_EXTENSION_ID is not set in .env"
  exit 1
fi

rm -rf dist
mkdir -p dist

cp extension/popup.html extension/popup.js extension/background.js extension/content.js extension/manual.html dist/
cp -r extension/icons dist/

if [ -z "${EXTENSION_KEY:-}" ]; then
  if [ -f extension.pem ]; then
    EXTENSION_KEY=$(openssl rsa -in extension.pem -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')
  elif [ -f key.pem ]; then
    EXTENSION_KEY=$(openssl rsa -in key.pem -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')
  elif [ "$BUILD_MODE" != "prod" ]; then
    if [ ! -f "$DEV_KEY_FILE" ]; then
      echo "🔐  Creating persistent dev extension key: $DEV_KEY_FILE"
      openssl genrsa -out "$DEV_KEY_FILE" 2048 >/dev/null 2>&1
      chmod 600 "$DEV_KEY_FILE"
    fi
    EXTENSION_KEY=$(openssl rsa -in "$DEV_KEY_FILE" -pubout -outform DER 2>/dev/null | base64 | tr -d '\n')
  fi
fi

if [ "$BUILD_MODE" != "prod" ] && [ -z "${EXTENSION_KEY:-}" ]; then
  echo "❌  Could not find or create a dev extension key."
  exit 1
fi

export GOOGLE_OAUTH_CLIENT_ID EXTENSION_KEY CHROME_EXTENSION_ID
export BUILD_MODE

python3 - <<'PYEOF'
import base64
import hashlib
import json
import os
import sys

with open("extension/manifest.json") as f:
    m = json.load(f)

m["oauth2"]["client_id"] = os.environ["GOOGLE_OAUTH_CLIENT_ID"]

key = os.environ.get("EXTENSION_KEY", "")
expected_extension_id = os.environ["CHROME_EXTENSION_ID"]
build_mode = os.environ.get("BUILD_MODE", "dev")
actual_extension_id = ""

if key:
    try:
        der = base64.b64decode(key)
    except Exception:
        print("❌  EXTENSION_KEY is not valid base64.")
        sys.exit(1)

    digest = hashlib.sha256(der).hexdigest()[:32]
    actual_extension_id = digest.translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop"))
    if actual_extension_id != expected_extension_id:
        print("⚠️  Extension key does not match CHROME_EXTENSION_ID.")
        print(f"    Expected: {expected_extension_id}")
        print(f"    Actual  : {actual_extension_id}")
        if build_mode == "prod":
            print("    Continuing with a Web Store upload build.")
            print("    This does not block updating the existing Chrome Web Store item.")
        else:
            print("    Continuing with a dev build using this stable local extension ID.")
            print("    Google OAuth testing requires a Chrome Extension OAuth client for this ID.")

if build_mode != "prod" and key:
    m["key"] = key
    print(f"🔐  Dev extension ID: {actual_extension_id}")

with open("dist/manifest.json", "w") as f:
    json.dump(m, f, indent=2)

# Keep the source manifest in sync too, so loading extension/ directly
# after a build doesn't leave Chrome pointing at the placeholder client ID.
source_manifest = dict(m)
source_manifest.pop("key", None)
with open("extension/manifest.json", "w") as f:
    json.dump(source_manifest, f, indent=2)
    f.write("\n")
PYEOF

if [ "${1}" = "prod" ]; then
  (cd dist && zip -r ../senkey.zip . -x "*.DS_Store")
  echo "✅  Production build: senkey.zip  (ready for Web Store upload)"
else
  echo "✅  Dev build: dist/  (load as unpacked from chrome://extensions)"
fi

echo ""
echo "── Extension settings ──────────────────────────────"
SERVICE_URL=""
if command -v gcloud &>/dev/null && [ -n "${PROJECT_ID:-}" ] && [ "$PROJECT_ID" != "your-gcp-project-id" ]; then
  SERVICE_URL=$(gcloud run services describe senkey-api \
    --region "${REGION:-us-west1}" \
    --project "$PROJECT_ID" \
    --format "value(status.url)" 2>/dev/null || true)
fi
if [ -n "$SERVICE_URL" ]; then
  echo "  API URL : $SERVICE_URL"
else
  echo "  API URL : (not deployed yet — run ./deploy.sh)"
fi
if [ -n "${API_KEY:-}" ]; then
  echo "  API Key : $API_KEY"
else
  echo "  API Key : (not set — run ./deploy.sh to generate one)"
fi
echo "────────────────────────────────────────────────────"
