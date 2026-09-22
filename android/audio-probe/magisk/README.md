# Optional privileged audio probe

This experimental diagnostic app is separate from Relay Companion. Its Magisk layout is:

```text
relay_audio_probe/module.prop
relay_audio_probe/system/priv-app/RelayAudioProbe/RelayAudioProbe.apk
relay_audio_probe/system/etc/permissions/privapp-permissions-relay-probe.xml
```

Build the APK from `android/audio-probe`. No APK, root-policy override, automatic audio test, or network shell is included. Ordinary runtime permissions are still required. Use only on the documented Xperia baseline, with a consenting test call and explicit user interaction. Installing the module requires a reboot; do not interrupt an active call.
