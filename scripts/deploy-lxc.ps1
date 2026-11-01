param(
  [Parameter(Mandatory = $true)]
  [string]$SshTarget,
  [string]$RemoteAppDir = "/opt/drop-harbor",
  [string]$ServiceName = "drop-harbor",
  [switch]$SkipRestart,
  [switch]$UseSudo
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "remote-shell.ps1")

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

if ($RemoteAppDir -notmatch '^/[A-Za-z0-9._/-]+$') {
  throw "RemoteAppDir must be an absolute POSIX path containing only letters, numbers, dots, underscores, hyphens, and slashes."
}

if ($ServiceName -notmatch '^[A-Za-z0-9_.@-]+$') {
  throw "ServiceName contains unsupported characters."
}

$restartPrefix = if ($UseSudo) { "sudo " } else { "" }
$remoteAppDirLiteral = ConvertTo-PosixShellLiteral $RemoteAppDir
$remotePublicDirLiteral = ConvertTo-PosixShellLiteral "$($RemoteAppDir.TrimEnd('/'))/public"
$remoteDataDirLiteral = ConvertTo-PosixShellLiteral "$($RemoteAppDir.TrimEnd('/'))/data"
$serviceNameLiteral = ConvertTo-PosixShellLiteral $ServiceName

Write-Host "Preparing remote directories on $SshTarget ..."
Invoke-Remote "mkdir -p $remoteAppDirLiteral $remotePublicDirLiteral $remoteDataDirLiteral"

Write-Host "Uploading application files ..."
Invoke-Copy @(
  "server.js",
  "package.json",
  "package-lock.json",
  "README.md",
  ".env.example",
  "$SshTarget`:$RemoteAppDir/"
)

Invoke-Copy @(
  "-r",
  "public",
  "$SshTarget`:$RemoteAppDir/"
)

if (-not $SkipRestart) {
  Write-Host "Restarting service $ServiceName ..."
  Invoke-Remote "${restartPrefix}systemctl restart $serviceNameLiteral && ${restartPrefix}systemctl status $serviceNameLiteral --no-pager --lines=5"
} else {
  Write-Host "Skipping service restart."
}

Write-Host ""
Write-Host "Deploy complete."
