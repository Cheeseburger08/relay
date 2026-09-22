# Android companion setup

## Supported baseline

The tested live-call path targets Sony Xperia XZ **F8332**, Android **8.0.0**, build **41.3.A.2.192**, arm64, with Magisk root. The uplink shell helper checks the device and firmware before touching the modem route. Do not remove those checks to make an unsupported device appear compatible.

Rooting/unlocking is not automated by this repository. It can wipe a phone. Make your own verified backups before changing a device. Firmware, unlock codes, signing keys, and device libraries are not distributed here.

## Build prerequisites

- Java 17.
- Gradle 8.11.1 (no Gradle wrapper is included).
- Android SDK platform 35 and build tools 35.0.0.
- A Clang/LLD toolchain capable of targeting aarch64 Android 26.
- Matching device libraries, kept outside the repository, for the native helper.

The companion uses Android Gradle Plugin 8.9.2, minimum SDK 26, and target SDK 28. It is a sideload prototype, not a Play Store package or a promise of current-Android compatibility.

### Native helper

See [the native build notes](../android/native/README.md). On Windows, provide explicit paths:

```powershell
./scripts/build-native-uplink.ps1 -Clang 'C:/toolchains/clang/bin/clang.exe' -DeviceLibraries 'C:/private/relay-device-libs'
```

The script expects `lld.exe` beside Clang and `libtinyalsa-device.so`, `libc-device.so`, and `libdl-device.so` in the private library folder. These are taken from the matching phone's `/system/lib64` and renamed as indicated. They are link-time inputs, not APK contents.

The generated helper and hash manifest go into the companion's assets. Gradle checks them against the C source and refuses missing/stale native builds. The script creates its output directories. This exact native toolchain setup still requires manual preparation; a portable one-command build is future work.

### Companion APK

Set `JAVA_HOME` and `ANDROID_HOME` for your installed tools, then:

```sh
cd android
gradle --no-daemon :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
adb -d install -r app/build/outputs/apk/debug/app-debug.apk
```

This makes a debug-signed APK for development. Use your own signing setup and keep its key private if distributing builds.

## Pair and enable

Deploy the server with HTTPS. Open **Device** on the website and create a pairing code. Enter the complete server origin and that code in Relay Companion. Grant the permissions offered by the app, explicitly enable Relay, and allow its root request on the tested phone.

Live call control/blocking needs the appropriate default-dialer role. SMS/call-history modification also needs the relevant write permissions/AppOps on this rooted Android setup. If a change remains pending, check permissions and phone connectivity rather than assuming it applied. Keep the companion's foreground notification visible.

For a USB-only local test, `adb reverse tcp:49760 tcp:49760` forwards the server to the phone; use `http://127.0.0.1:49760`. Remote URLs require HTTPS. USB forwarding is not needed once the phone uses the public HTTPS server over its own network.

## Verify before relying on it

1. Check the phone is online and both SIM slots are identified.
2. Send a harmless test SMS to each SIM and reply through the selected SIM.
3. Confirm existing messages, calls, and contacts import; test edits/deletes with synthetic entries.
4. Make a consenting call on each SIM and listen in both directions through the browser.
5. Test browser takeover, mute/end, and temporary network loss. Signal levels and successful commands are not proof of intelligible audio.

Contacts synchronize names/numbers, not complete address-book records. Read-only contact providers may reject writes. Network loss, carrier behavior, and browser lifecycle restrictions still need testing in your setup.
