param(
  [Parameter(Mandatory = $true)]
  [string]$SshTarget,
  [string]$RemoteAppDir = "/opt/drop-harbor",
  [string]$ServiceName = "drop-harbor",
  [switch]$SkipRestart,
  [switch]$UseSudo
)

$ErrorActionPreference = "Stop"

function Invoke-Remote {
  param(
    [Parameter(Mandatory = $true)]
    [string]$Command
  )

  & ssh $SshTarget $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Remote command failed: $Command"
  }
}

function Invoke-Copy {
  param(
    [Parameter(Mandatory = $true)]
    [string[]]$Arguments
  )

  & scp @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Copy failed: scp $($Arguments -join ' ')"
  }
}

$restartPrefix = if ($UseSudo) { "sudo " } else { "" }

Write-Host "Preparing remote directories on $SshTarget ..."
Invoke-Remote "mkdir -p '$RemoteAppDir' '$RemoteAppDir/public' '$RemoteAppDir/data'"

Write-Host "Uploading application files ..."
Invoke-Copy @(
  "server.js",
  "package.json",
  "package-lock.json",
  "README.md",
  "$SshTarget`:$RemoteAppDir/"
)

Invoke-Copy @(
  "-r",
  "public",
  "$SshTarget`:$RemoteAppDir/"
)

if (-not $SkipRestart) {
  Write-Host "Restarting service $ServiceName ..."
  Invoke-Remote "${restartPrefix}systemctl restart '$ServiceName' && ${restartPrefix}systemctl status '$ServiceName' --no-pager --lines=5"
} else {
  Write-Host "Skipping service restart."
}

Write-Host ""
Write-Host "Deploy complete."
