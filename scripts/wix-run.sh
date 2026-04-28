#!/bin/bash
# Wrapper to run Wix probe scripts with credentials loaded from macOS Keychain.
#
# One-time setup:
#   ./scripts/wix-run.sh save
#
# Then to probe:
#   ./scripts/wix-run.sh
#   ./scripts/wix-run.sh probe          # same thing
#
# To delete saved creds:
#   ./scripts/wix-run.sh forget

set -e

KEYCHAIN_SERVICE="hffny-wix"
HERE="$(cd "$(dirname "$0")" && pwd)"

case "${1:-probe}" in
  save)
    echo "Saving Wix credentials to macOS Keychain (service: $KEYCHAIN_SERVICE)"
    echo "These never get committed to git or written to disk in plaintext."
    echo

    read -rp "Wix API Key: " api_key
    read -rp "Wix Account ID: " account_id
    read -rp "Wix Site ID (optional, press Enter to skip): " site_id

    # Delete any prior entries so add doesn't error
    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "api_key" >/dev/null 2>&1 || true
    security add-generic-password -s "$KEYCHAIN_SERVICE" -a "api_key" -w "$api_key"
    echo "✓ API key stored"

    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "account_id" >/dev/null 2>&1 || true
    security add-generic-password -s "$KEYCHAIN_SERVICE" -a "account_id" -w "$account_id"
    echo "✓ Account ID stored"

    if [[ -n "$site_id" ]]; then
      security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "site_id" >/dev/null 2>&1 || true
      security add-generic-password -s "$KEYCHAIN_SERVICE" -a "site_id" -w "$site_id"
      echo "✓ Site ID stored"
    else
      security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "site_id" >/dev/null 2>&1 || true
      echo "  (no Site ID — script will list sites when it runs)"
    fi

    echo
    echo "Done. Run: ./scripts/wix-run.sh"
    ;;

  forget)
    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "api_key" >/dev/null 2>&1 || true
    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "account_id" >/dev/null 2>&1 || true
    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "site_id" >/dev/null 2>&1 || true
    echo "✓ Wix credentials removed from Keychain"
    ;;

  update-key)
    read -rp "New Wix API Key: " api_key
    security delete-generic-password -s "$KEYCHAIN_SERVICE" -a "api_key" >/dev/null 2>&1 || true
    security add-generic-password -s "$KEYCHAIN_SERVICE" -a "api_key" -w "$api_key"
    echo "✓ API key updated. Account ID and Site ID untouched."
    ;;

  probe|"")
    # Pull creds from Keychain and run the probe
    WIX_API_KEY=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "api_key" -w 2>/dev/null || echo "")
    WIX_ACCOUNT_ID=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "account_id" -w 2>/dev/null || echo "")
    WIX_SITE_ID=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "site_id" -w 2>/dev/null || echo "")

    if [[ -z "$WIX_API_KEY" || -z "$WIX_ACCOUNT_ID" ]]; then
      echo "❌ No Wix credentials in Keychain yet."
      echo "   Run: ./scripts/wix-run.sh save"
      exit 1
    fi

    export WIX_API_KEY WIX_ACCOUNT_ID
    [[ -n "$WIX_SITE_ID" ]] && export WIX_SITE_ID

    exec node "$HERE/wix-probe.mjs"
    ;;

  *)
    echo "Usage: $0 [save|probe|forget]"
    echo "  save    — store API key, Account ID, (optional) Site ID in macOS Keychain"
    echo "  probe   — run the Wix probe with stored credentials (default)"
    echo "  forget  — wipe stored credentials"
    exit 1
    ;;
esac
