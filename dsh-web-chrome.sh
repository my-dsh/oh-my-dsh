#!/usr/bin/env bash
# dsh-web-chrome: boot `dsh web --no-open`, then open its tokenized startup URL
# in the debug Chrome profile (CDP on 9222) instead of the default browser.
#
# The tokenized URL is required: the dsh web server answers 401 without it and
# the browser must exchange it for the signed session cookie.
#
# Usage:
#   ./dsh-web-chrome            # extra args pass through to `dsh web`
#   ./dsh-web-chrome --port 8080
set -euo pipefail

chrome='/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
cdp_port=9222
profile='C:\chrome-debug'
url_timeout=90  # seconds to wait for the startup URL line

# `pnpm dsh` needs the harness checkout's package.json; cd so any cwd works.
repo='/home/wuz11/code/github/deepseek-harness'
cd "$repo"

log=$(mktemp /tmp/dsh-web-chrome.XXXXXX.log)
trap 'rm -f "$log"' EXIT

echo "[dsh-web-chrome] starting dsh web --no-open (log: $log)"
: >"$log"
pnpm dsh web --no-open "$@" >>"$log" 2>&1 &
dsh_pid=$!

url=''
deadline=$((SECONDS + url_timeout))
while (( SECONDS < deadline )); do
  # take the freshest URL line; a restarted server prints a new token. `|| true`
  # keeps grep's no-match exit (1) from tripping pipefail + set -e before the
  # server has printed anything.
  url=$( { grep -o 'dsh web: http://127\.0\.0\.1:[0-9]*/[^ ]*' "$log" || true; } | tail -1 | sed 's/^dsh web: //')
  if [[ -n "$url" ]] && curl -sf -o /dev/null --max-time 2 "$url"; then
    break
  fi
  url=''
  if ! kill -0 "$dsh_pid" 2>/dev/null; then
    echo "[dsh-web-chrome] dsh web exited early:" >&2
    tail -20 "$log" >&2
    cp "$log" /tmp/dsh-web-chrome-last-crash.log
    exit 1
  fi
  sleep 0.5
done

if [[ -z "$url" ]]; then
  echo "[dsh-web-chrome] no reachable dsh web URL within ${url_timeout}s; last output:" >&2
  tail -20 "$log" >&2
  kill "$dsh_pid" 2>/dev/null || true
  exit 1
fi

echo "[dsh-web-chrome] opening $url in debug Chrome (CDP :$cdp_port)"
if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:$cdp_port/json/version"; then
  # Chrome already runs with CDP: it joins the session and opens a new tab, then exits 0.
  "$chrome" --remote-debugging-port=$cdp_port --user-data-dir="$profile" \
    --no-first-run --no-default-browser-check "$url" >/dev/null 2>&1 || true
else
  "$chrome" --remote-debugging-port=$cdp_port --user-data-dir="$profile" \
    --no-first-run --no-default-browser-check "$url" >/dev/null 2>&1 &
fi

echo "[dsh-web-chrome] serving; Ctrl+C stops dsh web"
wait "$dsh_pid"
