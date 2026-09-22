param(
 [Parameter(Mandatory=$true)][string]$Clang,
 [Parameter(Mandatory=$true)][string]$DeviceLibraries
)
$ErrorActionPreference='Stop'
$relayRoot=Split-Path $PSScriptRoot -Parent
$nativeBuild=Join-Path $relayRoot 'android\build\native'
New-Item -ItemType Directory -Force -Path $nativeBuild | Out-Null
$object=Join-Path $nativeBuild 'relay-uplink.o'
$target=Join-Path $relayRoot 'android\app\src\main\assets\relay-uplink-arm64'
New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
& $Clang --target=aarch64-linux-android26 -O2 -fPIE -fno-stack-protector -ffreestanding -Wall -Wextra -Werror -c "$relayRoot\android\native\relay-uplink.c" -o $object
if($LASTEXITCODE){throw 'Native compile failed'}
$linker=Join-Path (Split-Path $Clang -Parent) 'lld.exe'
& $linker -flavor gnu -m aarch64elf -pie --dynamic-linker /system/bin/linker64 -e _start -z noexecstack -z relro -z now -o $target $object "$DeviceLibraries\libtinyalsa-device.so" "$DeviceLibraries\libc-device.so" "$DeviceLibraries\libdl-device.so"
if($LASTEXITCODE){throw 'Native link failed'}
$sourceHash=(Get-FileHash -Algorithm SHA256 -LiteralPath "$relayRoot\android\native\relay-uplink.c").Hash.ToLowerInvariant()
$binaryHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
[IO.File]::WriteAllText("$target.sha256", "$sourceHash`n$binaryHash`n")
Get-FileHash -Algorithm SHA256 -LiteralPath $target
