#!/system/bin/sh
# Fixed wireless helper; stdin is raw PCM, never shell code.
set -eu
case "${1:-}" in
  first) pcm=1; control=901; expected='Incall_Music Audio Mixer MultiMedia2: Off' ;;
  second) pcm=32; control=899; expected='Incall_Music_2 Audio Mixer MultiMedia9: Off' ;;
  *) exit 2 ;;
esac
[ "$(id -u)" = 0 ] || exit 3
[ "$(getprop ro.product.model)" = F8332 ] || exit 4
[ "$(getprop ro.build.display.id)" = 41.3.A.2.192 ] || exit 4
[ "$(cat /proc/asound/card0/pcm${pcm}p/sub0/status)" = closed ] || { echo 'Playback busy'; exit 5; }
[ "$(tinymix "$control")" = "$expected" ] || { echo 'Mixer busy'; exit 6; }
active=false
for voice in 2 22 14 33 40 41; do
  if grep -q 'state: RUNNING' /proc/asound/card0/pcm${voice}p/sub0/status; then active=true; fi
done
$active || { echo 'No active call'; exit 7; }
restore() { tinymix "$control" 0; echo 'Live injection stopped; mixer state:'; tinymix "$control"; }
trap restore EXIT
trap 'exit 130' INT TERM HUP
tinymix "$control" 1
echo 'Live injection starting'
# Reblock 20ms network packets into verified 30ms modem writes, dropping stale
# audio without the cat/tinyplay intermediate pipe.
timeout -k 1 7200 "${0%/*}/relay-uplink-arm64" "$1"
