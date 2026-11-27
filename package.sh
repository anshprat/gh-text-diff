#!/bin/bash

# Packaging script for the Chrome Web Store and Firefox Add-ons (AMO).
#
#   ./package.sh            # build both zips
#   ./package.sh chrome     # Chrome zip only
#   ./package.sh firefox    # Firefox zip only
#
# Chrome loads the repo root as is. Firefox needs a different manifest, so the
# Firefox build copies the extension files to build/firefox/ and writes a
# manifest made from manifest.json plus firefox/manifest.overrides.json.
# Load build/firefox/ in about:debugging to test the Firefox build unpacked.

set -e

cd "$(dirname "$0")"

TARGET="${1:-all}"

# Files that make up the extension, the same for both browsers
FILES=(src icons)
# Paths inside FILES to leave out of both packages
EXCLUDES=()
# Command that makes FILES first (empty when there is no build step)
BUILD=""

VERSION=$(jq -r '.version' manifest.json)
NAME=$(jq -r '.name' manifest.json | tr ' ' '-' | tr '[:upper:]' '[:lower:]')

GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

run_build() {
    if [ -n "$BUILD" ]; then
        echo -e "${BLUE}Building ${NAME} v${VERSION}...${NC}"
        eval "$BUILD"
    fi
}

package_chrome() {
    local zip_name="${NAME}-chrome-v${VERSION}.zip"
    local excludes=("*.DS_Store")
    local e
    for e in "${EXCLUDES[@]}"; do excludes+=("$e" "$e/*"); done
    echo -e "${BLUE}Packaging ${NAME} v${VERSION} for Chrome...${NC}"
    rm -f "$zip_name"
    zip -r "$zip_name" manifest.json "${FILES[@]}" -x "${excludes[@]}"
    echo -e "${GREEN}Package created: ${zip_name}${NC}"
    echo -e "${BLUE}Upload at: https://chrome.google.com/webstore/devconsole${NC}"
}

build_firefox() {
    local out="build/firefox"
    local f e
    rm -rf "$out"
    mkdir -p "$out"
    for f in "${FILES[@]}"; do
        mkdir -p "$out/$(dirname "$f")"
        cp -R "$f" "$out/$(dirname "$f")/"
    done
    for e in "${EXCLUDES[@]}"; do rm -rf "${out:?}/$e"; done
    # Firefox MV3 differences from Chrome:
    # - No background service worker: run the same script as a background event page.
    # - No options_page: use options_ui, opened in a tab as Chrome does.
    jq -s '.[0] * .[1]
        | if .background.service_worker then
            .background = (.background | .scripts = [.service_worker] | del(.service_worker))
          else . end
        | if .options_page then
            .options_ui = {page: .options_page, open_in_tab: true} | del(.options_page)
          else . end' \
        manifest.json firefox/manifest.overrides.json > "$out/manifest.json"
    find "$out" -name ".DS_Store" -delete
}

package_firefox() {
    local zip_name="${NAME}-firefox-v${VERSION}.zip"
    echo -e "${BLUE}Packaging ${NAME} v${VERSION} for Firefox...${NC}"
    build_firefox
    rm -f "$zip_name"
    # The manifest must be at the zip root, so zip from inside the build folder
    (cd build/firefox && zip -r "../../$zip_name" .)
    echo -e "${GREEN}Package created: ${zip_name}${NC}"
    echo -e "${BLUE}Upload at: https://addons.mozilla.org/developers/addon/submit/${NC}"
}

case "$TARGET" in
    chrome)  run_build; package_chrome ;;
    firefox) run_build; package_firefox ;;
    all)     run_build; package_chrome; package_firefox ;;
    *)       echo "Usage: $0 [chrome|firefox|all]" >&2; exit 1 ;;
esac
