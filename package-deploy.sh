#!/bin/bash
# Creates a shareable zip with only the backend deployment resources.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_ROOT="${SCRIPT_DIR}/senkey-deploy"
ZIP_PATH="${SCRIPT_DIR}/senkey-deploy.zip"

rm -rf "$PACKAGE_ROOT"
mkdir -p "$PACKAGE_ROOT"

cp "${SCRIPT_DIR}/docker/Dockerfile" "$PACKAGE_ROOT/"
cp "${SCRIPT_DIR}/docker/index.php" "$PACKAGE_ROOT/"
cp "${SCRIPT_DIR}/docker/deploy.sh" "$PACKAGE_ROOT/"
cp "${SCRIPT_DIR}/docker/deploy.ps1" "$PACKAGE_ROOT/"
cp "${SCRIPT_DIR}/docker/README.md" "$PACKAGE_ROOT/"
cp "${SCRIPT_DIR}/docker/INSTALL.md" "$PACKAGE_ROOT/"
cp "${SCRIPT_DIR}/docker/.env.example" "$PACKAGE_ROOT/"

rm -f "$ZIP_PATH"
(cd "$SCRIPT_DIR" && zip -rq "$(basename "$ZIP_PATH")" "$(basename "$PACKAGE_ROOT")")

echo "✅  Created distributable backend bundle:"
echo "    $ZIP_PATH"
