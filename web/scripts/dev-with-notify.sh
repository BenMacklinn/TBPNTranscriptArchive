#!/usr/bin/env bash
set -u

notify_stop() {
  local code=$?
  echo ""
  echo "============================================================"
  if [ "$code" -eq 0 ]; then
    echo "TBPN DEV SERVER STOPPED"
  else
    echo "TBPN DEV SERVER STOPPED (exit code $code)"
  fi
  echo "============================================================"
  printf '\a'
}

trap notify_stop EXIT

next dev "$@"
