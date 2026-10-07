#!/usr/bin/env bash
# CE-8: Arabic fonts for capture workers (all SIL Open Font Licence, from google/fonts).
set -euo pipefail
dest="${FONT_DIR:-/usr/local/share/fonts/mockups}"
base="https://raw.githubusercontent.com/google/fonts/main/ofl"
mkdir -p "$dest"
fonts=(
  "notosansarabic/NotoSansArabic%5Bwdth,wght%5D.ttf"
  "cairo/Cairo%5Bslnt,wght%5D.ttf"
  "tajawal/Tajawal-Regular.ttf"
  "tajawal/Tajawal-Bold.ttf"
  "ibmplexsansarabic/IBMPlexSansArabic-Regular.ttf"
  "ibmplexsansarabic/IBMPlexSansArabic-Bold.ttf"
)
for f in "${fonts[@]}"; do
  name="$(basename "$f" | sed 's/%5B/[/g; s/%5D/]/g')"
  [[ -s "$dest/$name" ]] || curl -fsSL --retry 3 "$base/$f" -o "$dest/$name"
done
fc-cache -f "$dest" >/dev/null
fc-list : family | grep -E "Noto Sans Arabic|Cairo|Tajawal|IBM Plex Sans Arabic" | sort -u
