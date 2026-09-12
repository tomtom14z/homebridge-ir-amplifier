#!/usr/bin/env bash
# Capture un still de la caméra CSI Raspberry Pi pour vérifier cadrage / netteté.
# Usage: ./scripts/test-pi-camera.sh [dossier_sortie]
#
# Variables:
#   CAMERA_WIDTH / CAMERA_HEIGHT  taille de sortie (défaut 1600x640)
#   CAMERA_ROI                    recadrage capteur x,y,w,h en 0–1
#                                 défaut: bande de l'afficheur vu sur le 1er test
set -euo pipefail

OUT_DIR="${1:-./debug-camera}"
mkdir -p "$OUT_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/pi-camera-$STAMP.jpg"
WIDTH="${CAMERA_WIDTH:-1920}"
HEIGHT="${CAMERA_HEIGHT:-672}"
ROI="${CAMERA_ROI:-0.14,0.54,0.84,0.30}"

echo "== Caméra Raspberry Pi =="
echo "Sortie: $FILE"
echo "Taille: ${WIDTH}x${HEIGHT}"
echo "ROI:    $ROI"
echo

if command -v vcgencmd >/dev/null 2>&1; then
  echo "-- vcgencmd get_camera --"
  vcgencmd get_camera || true
  echo
fi

if command -v rpicam-hello >/dev/null 2>&1; then
  echo "-- rpicam-hello --list-cameras --"
  rpicam-hello --list-cameras || true
  echo
elif command -v libcamera-hello >/dev/null 2>&1; then
  echo "-- libcamera-hello --list-cameras --"
  libcamera-hello --list-cameras || true
  echo
fi

capture() {
  local bin="$1"
  shift
  echo "Capture avec $bin..."
  "$bin" "$@"
}

if command -v rpicam-still >/dev/null 2>&1; then
  capture rpicam-still --nopreview --timeout 1000 --width "$WIDTH" --height "$HEIGHT" --quality 92 --encoding jpg --roi "$ROI" --output "$FILE"
elif command -v libcamera-still >/dev/null 2>&1; then
  capture libcamera-still --nopreview --timeout 1000 --width "$WIDTH" --height "$HEIGHT" --quality 92 --encoding jpg --roi "$ROI" --output "$FILE"
elif command -v raspistill >/dev/null 2>&1; then
  capture raspistill -n -t 1000 -w "$WIDTH" -h "$HEIGHT" -q 92 -roi "$ROI" -o "$FILE"
else
  echo "Aucun outil de capture trouvé."
  echo "Installez rpicam-apps / libcamera-apps, ou activez le driver legacy (raspistill)."
  exit 1
fi

ls -lh "$FILE"
echo
echo "Pour récupérer l'image sur un Mac:"
echo "  scp pi@IP_DU_PI:$(cd "$OUT_DIR" && pwd)/$(basename "$FILE") ~/Desktop/"
echo
echo "Si le crop est trop serré / trop large, ajuste CAMERA_ROI (x,y,largeur,hauteur en 0–1):"
echo "  CAMERA_ROI=0.04,0.45,0.92,0.42 ./scripts/test-pi-camera.sh ~/debug-camera"
echo
echo "Plein cadre sans crop:"
echo "  CAMERA_ROI=0,0,1,1 CAMERA_WIDTH=1920 CAMERA_HEIGHT=1440 ./scripts/test-pi-camera.sh ~/debug-camera"
echo
echo "Pour servir le dossier en HTTP:"
echo "  cd $OUT_DIR && python3 -m http.server 8088"
