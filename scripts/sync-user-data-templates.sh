#!/bin/bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CF_TEMPLATE="$ROOT_DIR/cloudformation/template-dev.yaml"
LINUX_TEMPLATE="$ROOT_DIR/terraform/modules/compute/user-data/linux-bootstrap.sh.tmpl"
WINDOWS_TEMPLATE="$ROOT_DIR/terraform/modules/compute/user-data/windows-bootstrap.ps1.tmpl"

LINUX_BEGIN_MARKER="            # BEGIN AUTO-GENERATED LINUX USER-DATA"
LINUX_END_MARKER="            # END AUTO-GENERATED LINUX USER-DATA"
WINDOWS_BEGIN_MARKER="            # BEGIN AUTO-GENERATED WINDOWS USER-DATA"
WINDOWS_END_MARKER="            # END AUTO-GENERATED WINDOWS USER-DATA"

for file in "$CF_TEMPLATE" "$LINUX_TEMPLATE" "$WINDOWS_TEMPLATE"; do
  if [ ! -f "$file" ]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

linux_begin_count="$(grep -Fc "$LINUX_BEGIN_MARKER" "$CF_TEMPLATE")"
linux_end_count="$(grep -Fc "$LINUX_END_MARKER" "$CF_TEMPLATE")"
windows_begin_count="$(grep -Fc "$WINDOWS_BEGIN_MARKER" "$CF_TEMPLATE")"
windows_end_count="$(grep -Fc "$WINDOWS_END_MARKER" "$CF_TEMPLATE")"

if [ "$linux_begin_count" -eq 0 ] || [ "$windows_begin_count" -eq 0 ]; then
  echo "Could not find user-data block markers in $CF_TEMPLATE" >&2
  exit 1
fi

if [ "$linux_begin_count" -ne "$linux_end_count" ] || [ "$windows_begin_count" -ne "$windows_end_count" ]; then
  echo "Mismatched begin/end user-data block markers in $CF_TEMPLATE" >&2
  exit 1
fi

linux_block="$(mktemp)"
windows_block="$(mktemp)"
output_file="$(mktemp)"

{
  echo "$LINUX_BEGIN_MARKER"
  echo "            - |"
  awk '{ print "              " $0 }' "$LINUX_TEMPLATE"
  echo "$LINUX_END_MARKER"
} > "$linux_block"

{
  echo "$WINDOWS_BEGIN_MARKER"
  echo "            - |"
  awk '{ print "              " $0 }' "$WINDOWS_TEMPLATE"
  echo "$WINDOWS_END_MARKER"
} > "$windows_block"

awk \
  -v linux_begin="$LINUX_BEGIN_MARKER" \
  -v linux_end="$LINUX_END_MARKER" \
  -v windows_begin="$WINDOWS_BEGIN_MARKER" \
  -v windows_end="$WINDOWS_END_MARKER" \
  -v linux_generated="$linux_block" \
  -v windows_generated="$windows_block" '
  function print_file(path, line) {
    while ((getline line < path) > 0) {
      print line
    }
    close(path)
  }

  index($0, linux_begin) {
    print_file(linux_generated)
    skipping = "linux"
    next
  }

  index($0, windows_begin) {
    print_file(windows_generated)
    skipping = "windows"
    next
  }

  skipping == "linux" {
    if (index($0, linux_end)) {
      skipping = ""
    }
    next
  }

  skipping == "windows" {
    if (index($0, windows_end)) {
      skipping = ""
    }
    next
  }

  {
    print
  }
' "$CF_TEMPLATE" > "$output_file"

mv "$output_file" "$CF_TEMPLATE"
rm -f "$linux_block" "$windows_block"

echo "Synced user-data templates into $CF_TEMPLATE"
