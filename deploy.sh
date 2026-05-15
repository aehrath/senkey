#!/bin/bash
# One-command wrapper for the Cloud Run backend deploy.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "${SCRIPT_DIR}/docker/deploy.sh"
