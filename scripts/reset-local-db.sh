#!/usr/bin/env bash
# Wipes the local D1 database and re-applies migrations. Development only.
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf .wrangler/state
npx wrangler d1 migrations apply mmu-db --local
