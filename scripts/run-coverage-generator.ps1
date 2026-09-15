$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$generator = Join-Path $PSScriptRoot 'generate-requirements.mjs'
$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$generatorArguments = @($generator) + $args

$candidates = @()
if (Test-Path -LiteralPath $bundledNode) {
  $candidates += $bundledNode
}
if (Get-Command node -ErrorAction SilentlyContinue) {
  $candidates += 'node'
}

foreach ($candidate in $candidates) {
  try {
    & $candidate @generatorArguments
    if ($LASTEXITCODE -eq 0) {
      exit 0
    }
  }
  catch {
    continue
  }
}

throw "No usable Node.js runtime with the bundled workbook engine was found. Run inside the Codex workspace runtime."
