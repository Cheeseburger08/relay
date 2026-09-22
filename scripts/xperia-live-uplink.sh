#!/system/bin/sh
# Fixed local USB test helper; stdin is raw PCM WAV, never shell code.
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
# Node speaks ADB's binary shell-v2 protocol directly, bypassing Windows CLI
# text conversion and base64 decoder buffering. ADB supplies a socket as stdin;
# Sony tinyplay cannot fopen that descriptor. cat converts it to a pipe using
# immediate read/write copies (no codec or stdio decoder buffering, no file).
timeout -k 1 125 sh -c "cat | tinyplay /proc/self/fd/0 -D 0 -d $pcm -p 240 -n 2"
