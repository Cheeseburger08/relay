param([Parameter(Mandatory=$true)][string]$AdbPath)
$ErrorActionPreference='Stop'
# Only the local probe's numeric/status diagnostics; never dump global logs.
& $AdbPath -d shell logcat -d -v brief -s 'RelayAudioProbe:I' '*:S'
if($LASTEXITCODE -ne 0){throw 'Could not read probe results over ADB'}
