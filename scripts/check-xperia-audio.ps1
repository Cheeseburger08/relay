param([Parameter(Mandatory=$true)][string]$AdbPath)
$ErrorActionPreference = 'Stop'
function Read-Phone([string[]]$PhoneArgs) {
    $result = & $AdbPath -d shell @PhoneArgs
    if ($LASTEXITCODE -ne 0) { throw 'Read-only phone inspection failed' }
    return ($result -join "`n").Trim()
}
$policy = Read-Phone @('cat','/vendor/etc/audio_policy_configuration.xml')
$mixer = Read-Phone @('cat','/vendor/etc/mixer_paths_tasha.xml')
$pcm = Read-Phone @('cat','/proc/asound/pcm')
$report = [ordered]@{
    model = Read-Phone @('getprop','ro.product.model')
    android = Read-Phone @('getprop','ro.build.version.release')
    build = Read-Phone @('getprop','ro.build.display.id')
    platform = Read-Phone @('getprop','ro.board.platform')
    bootloaderLocked = (Read-Phone @('getprop','ro.boot.flash.locked')) -eq '1'
    verifiedBoot = Read-Phone @('getprop','ro.boot.verifiedbootstate')
    selinux = Read-Phone @('getenforce')
    telephonyTxPolicy = $policy.Contains('sink="Telephony Tx"')
    telephonyRxPolicy = $policy.Contains('AUDIO_DEVICE_IN_TELEPHONY_RX')
    sonyVoiceTxPort = $policy.Contains('mixPort name="voice_tx"')
    downlinkMixerReference = $mixer.Contains('MultiMedia1 Mixer VOC_REC_DL')
    primaryInjectionMixerReference = $mixer.Contains('Incall_Music Audio Mixer MultiMedia2')
    secondaryInjectionMixerReference = $mixer.Contains('Incall_Music_2 Audio Mixer MultiMedia9')
    downlinkPcmListed = $pcm.Contains('Voice Downlink Capture')
    farendPlaybackListed = $pcm.Contains('Voice Farend Playback')
    liveAudioVerified = $false
    note = 'Static firmware declarations only; no audio stream opened and no settings changed.'
}
$report | ConvertTo-Json
