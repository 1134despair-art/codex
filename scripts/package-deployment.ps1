$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$distRoot = Join-Path $projectRoot 'dist'
$releaseRoot = Join-Path $projectRoot 'release'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$packageName = "Shark-Sister-Admin-$stamp"
$stagingRoot = Join-Path $releaseRoot $packageName
$archivePath = Join-Path $releaseRoot "$packageName.zip"
$vueTscPath = Join-Path $projectRoot 'node_modules/vue-tsc/bin/vue-tsc.js'
$vitePath = Join-Path $projectRoot 'node_modules/vite/bin/vite.js'

Push-Location $projectRoot
try {
  node $vueTscPath --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Type check failed' }
  node $vitePath build
  if ($LASTEXITCODE -ne 0) { throw 'Production build failed' }

  $indexPath = Join-Path $distRoot 'index.html'
  if (-not (Test-Path -LiteralPath $indexPath)) { throw 'Build output is missing index.html' }

  New-Item -ItemType Directory -Path $stagingRoot | Out-Null
  Get-ChildItem -LiteralPath $distRoot -Force |
    Where-Object Name -ne '.vite' |
    Copy-Item -Destination $stagingRoot -Recurse -Force

  Compress-Archive -Path (Join-Path $stagingRoot '*') -DestinationPath $archivePath -CompressionLevel Optimal
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  $archiveStream = [System.IO.File]::OpenRead($archivePath)
  try {
    $hash = ([System.BitConverter]::ToString($sha256.ComputeHash($archiveStream))).Replace('-', '')
  }
  finally {
    $archiveStream.Dispose()
    $sha256.Dispose()
  }
  $size = (Get-Item -LiteralPath $archivePath).Length
  [pscustomobject]@{
    Archive = $archivePath
    Bytes = $size
    SHA256 = $hash
  } | Format-List
}
catch {
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
  throw
}
finally {
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
  Pop-Location
}
