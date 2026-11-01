$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "remote-shell.ps1")

$quoted = ConvertTo-PosixShellLiteral "/opt/drop-harbor/it's data"
if ($quoted -ne "'/opt/drop-harbor/it'\''s data'") {
  throw "POSIX shell quoting regression: $quoted"
}

$deployScript = Get-Content -Raw (Join-Path $PSScriptRoot "deploy-lxc.ps1")
[void][scriptblock]::Create($deployScript)
if ($deployScript -notmatch 'remotePublicDirLiteral') {
  throw "Deploy script does not quote the derived public directory"
}
if ($deployScript -notmatch 'serviceNameLiteral') {
  throw "Deploy script does not quote the service name"
}

Write-Output "remote shell quoting tests passed"
