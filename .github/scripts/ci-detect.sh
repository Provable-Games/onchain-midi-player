#!/usr/bin/env bash
# Detect which optional CI checks this revision supports, so ci.yml runs them
# as soon as the files exist (the root package.json, its scripts, player/).
#
# Usage: ci-detect.sh   (from the repository root)
# Writes has_package_json, has_lockfile, has_test, has_check_settings,
# has_check_segments, has_render_check, has_page_check, has_hosting_check,
# has_drift_check and has_player (true or false) to GITHUB_OUTPUT, or to stdout outside
# Actions.
set -euo pipefail

has_script() {
  [ -f package.json ] && jq -e --arg name "$1" '.scripts[$name] | type == "string"' package.json > /dev/null
}

has_player_js() {
  [ -d player ] && [ -n "$(find player -name '*.js' -print -quit)" ]
}

flag() {
  if "$@"; then echo true; else echo false; fi
}

# A malformed package.json fails here rather than silently skipping its checks.
if [ -f package.json ]; then
  jq empty package.json
fi

outputs="$(
  echo "has_package_json=$(flag test -f package.json)"
  echo "has_lockfile=$(flag test -f package-lock.json)"
  echo "has_test=$(flag has_script test)"
  echo "has_check_settings=$(flag has_script check:settings)"
  echo "has_check_segments=$(flag has_script check:segments)"
  echo "has_render_check=$(flag has_script render-check)"
  echo "has_page_check=$(flag has_script page-check)"
  echo "has_hosting_check=$(flag has_script hosting-check)"
  echo "has_drift_check=$(flag has_script drift-check)"
  echo "has_player=$(flag has_player_js)"
)"
echo "$outputs"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "$outputs" >> "$GITHUB_OUTPUT"
fi
