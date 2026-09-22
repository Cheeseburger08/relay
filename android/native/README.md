# Xperia native uplink

The C helper targets rooted F8332 / Android 8 build 41.3.A.2.192 / arm64. It receives raw 16 kHz mono signed PCM16 through stdin and writes 480-sample (30 ms) blocks to the tested modem endpoint. The browser/server transport uses 20 ms frames; the native reader reblocks the byte stream.

To bound delay, an excessive stdin backlog drops oldest complete blocks while preserving sample alignment. Speech is not written to disk. Timing counters contain queue sizes, drop counts, and write durations, not sample content.

Build using `scripts/build-native-uplink.ps1` with explicit Clang and device-library paths; see [Android setup](../../docs/ANDROID.md). Generated executables, hashes, and device libraries are excluded from Git. The companion build checks the native source/binary hash manifest.

ABI references: [Android 8 tinyalsa](https://android.googlesource.com/platform/external/tinyalsa/+/android-8.0.0_r1/include/tinyalsa/asoundlib.h) and [Bionic startup](https://android.googlesource.com/platform/bionic/+/android-8.0.0_r1/libc/arch-common/bionic/crtbegin.c).

`--self-test` checks synthetic backlog discard, byte order, and EOF without opening audio. `--stream-test` accepts synthetic stdin packets and prints counters without opening PCM. Neither establishes modem compatibility or audible cellular transmission. Never force an unsupported audio route based only on these tests.
