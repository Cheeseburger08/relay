param([Parameter(Mandatory=$true)][string]$BackupDirectory)
$ErrorActionPreference = 'Stop'
function Read-SafeXml([string]$Path) {
    $settings = [System.Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $settings.XmlResolver = $null
    $reader = [System.Xml.XmlReader]::Create($Path, $settings)
    try {
        $document = [System.Xml.XmlDocument]::new()
        $document.XmlResolver = $null
        $document.Load($reader)
        return ,$document
    } finally { $reader.Dispose() }
}
function Require-Attribute($Element, [string]$Name, $Value) {
    $expected = if ($null -eq $Value) { 'null' } else { [string]$Value }
    if (-not $Element.HasAttribute($Name) -or $Element.GetAttribute($Name) -cne $expected) {
        throw 'XML field verification failed; no private field value is shown'
    }
}
$manifest = Get-Content -LiteralPath (Join-Path $BackupDirectory 'manifest.json') -Raw | ConvertFrom-Json
$report = [ordered]@{ SmsCount=0; CallCount=0; ProviderHashesVerified=$true; XmlFieldsVerified=$true }
foreach ($kind in @('sms','calls')) {
    $jsonFile = Join-Path $BackupDirectory "$kind.json"
    if ((Get-FileHash -LiteralPath $jsonFile -Algorithm SHA256).Hash.ToLower() -ne $manifest.$kind.sha256) { throw 'JSON checksum mismatch' }
    $data = Get-Content -LiteralPath $jsonFile -Raw | ConvertFrom-Json
    $doc = Read-SafeXml (Join-Path $BackupDirectory "$kind.xml")
    $nodes = if ($kind -eq 'sms') { $doc.SelectNodes('/smses/sms') } else { $doc.SelectNodes('/calls/call') }
    if ($nodes.Count -ne $data.rows.Count -or [int]$doc.DocumentElement.GetAttribute('count') -ne $nodes.Count) { throw 'XML record count mismatch' }
    for ($i=0; $i -lt $nodes.Count; $i++) {
        $row = $data.rows[$i]
        $entry = $nodes[$i]
        if ($kind -eq 'sms') {
            foreach ($name in @('address','date','type','subject','body','service_center')) { Require-Attribute $entry $name $row.$name }
            Require-Attribute $entry 'protocol' $(if ($null -eq $row.protocol) { 0 } else { $row.protocol })
            Require-Attribute $entry 'read' $(if ($null -eq $row.read) { 0 } else { $row.read })
            Require-Attribute $entry 'status' $(if ($null -eq $row.status) { -1 } else { $row.status })
            Require-Attribute $entry 'locked' $(if ($null -eq $row.locked) { 0 } else { $row.locked })
            Require-Attribute $entry 'date_sent' $(if ($null -eq $row.date_sent) { 0 } else { $row.date_sent })
            if ($null -ne $row.sub_id) { Require-Attribute $entry 'sub_id' $row.sub_id }
        } else {
            foreach ($name in @('number','duration','date','type')) { Require-Attribute $entry $name $row.$name }
            $presentation = if ($null -ne $row.presentation) { $row.presentation } elseif ($null -ne $row.number_presentation) { $row.number_presentation } else { 1 }
            $subscription = if ($null -ne $row.subscription_id) { $row.subscription_id } else { $row.phone_account_id }
            Require-Attribute $entry 'presentation' $presentation
            Require-Attribute $entry 'subscription_id' $subscription
            Require-Attribute $entry 'contact_name' $(if ($null -eq $row.name) { '(Unknown)' } else { $row.name })
        }
    }
    if ($kind -eq 'sms') { $report.SmsCount = $nodes.Count } else { $report.CallCount = $nodes.Count }
}
$report | ConvertTo-Json
