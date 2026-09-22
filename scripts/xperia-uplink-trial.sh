#!/system/bin/sh
# Manual local laboratory trial. No capture, network, background service or HAL mode changes.
# Invoke only during a user-arranged consenting call. This is not production code.
set -eu
case "${1:-}" in
  first) pcm=1; control=901; expected='Incall_Music Audio Mixer MultiMedia2: Off' ;;
  second) pcm=32; control=899; expected='Incall_Music_2 Audio Mixer MultiMedia9: Off' ;;
  *) echo 'Select first or second voice-session route (not a SIM-slot mapping)'; exit 2 ;;
esac
[ "$(id -u)" = 0 ] || exit 3
[ "$(getprop ro.product.model)" = F8332 ] || exit 4
[ "$(getprop ro.build.display.id)" = 41.3.A.2.192 ] || exit 4
[ "$(cat /proc/asound/card0/pcm${pcm}p/sub0/status)" = closed ] || { echo 'Playback endpoint busy; nothing changed'; exit 5; }
[ "$(tinymix "$control")" = "$expected" ] || { echo 'Unexpected mixer state; nothing changed'; exit 6; }
active=false
for voice in 2 22 14 33 40 41; do
  if grep -q 'state: RUNNING' /proc/asound/card0/pcm${voice}p/sub0/status; then active=true; fi
done
$active || { echo 'No running voice endpoint; nothing changed'; exit 7; }
wave=/data/local/tmp/relay-uplink-pulses.wav
[ -f "$wave" ] || exit 8
restore() { tinymix "$control" 0; echo 'Injection mixer restored:'; tinymix "$control"; }
trap restore EXIT
trap 'exit 130' INT TERM HUP
tinymix "$control" 1
echo "Testing dedicated in-call route, PCM $pcm; maximum four seconds"
set +e
timeout -k 1 4 tinyplay "$wave" -D 0 -d "$pcm" -p 240 -n 2
result=$?
set -e
echo "Playback process exit: $result (caller confirmation still required)"
exit "$result"
