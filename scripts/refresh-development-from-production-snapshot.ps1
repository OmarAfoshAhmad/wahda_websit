param(
  [string]$SourceDatabase = "waad_production_snapshot_test",
  [string]$TargetDatabase = "waad_replace_cycle_test",
  [string]$HostName = "localhost",
  [int]$Port = 5432,
  [string]$Username = "postgres",
  [string]$PostgresBin = "C:\Program Files\PostgreSQL\18\bin",
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

if (-not $Apply) {
  throw "Dry guard: add -Apply only after confirming that TargetDatabase is the disposable development database."
}
if ($SourceDatabase -eq $TargetDatabase) {
  throw "SourceDatabase and TargetDatabase must be different."
}
if ($SourceDatabase -notmatch "snapshot|backup|production") {
  throw "SourceDatabase must clearly identify a snapshot/backup."
}
if ($TargetDatabase -notmatch "test|testing|development|dev") {
  throw "TargetDatabase must clearly identify a disposable test/development database."
}

$pgDump = Join-Path $PostgresBin "pg_dump.exe"
$dropDb = Join-Path $PostgresBin "dropdb.exe"
$createDb = Join-Path $PostgresBin "createdb.exe"
$pgRestore = Join-Path $PostgresBin "pg_restore.exe"
foreach ($tool in @($pgDump, $dropDb, $createDb, $pgRestore)) {
  if (-not (Test-Path -LiteralPath $tool)) { throw "PostgreSQL tool not found: $tool" }
}

$temporaryDump = Join-Path $env:TEMP "waad-development-refresh-$([guid]::NewGuid().ToString('N')).dump"
try {
  & $pgDump -h $HostName -p $Port -U $Username -d $SourceDatabase -Fc -f $temporaryDump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed." }

  & $dropDb -h $HostName -p $Port -U $Username --force --if-exists $TargetDatabase
  if ($LASTEXITCODE -ne 0) { throw "dropdb failed." }

  & $createDb -h $HostName -p $Port -U $Username -T template0 $TargetDatabase
  if ($LASTEXITCODE -ne 0) { throw "createdb failed." }

  & $pgRestore -h $HostName -p $Port -U $Username -d $TargetDatabase --no-owner --no-privileges $temporaryDump
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed." }

  Write-Output "Development database refreshed from the local production snapshot: $TargetDatabase"
}
finally {
  if (Test-Path -LiteralPath $temporaryDump) {
    Remove-Item -LiteralPath $temporaryDump -Force
  }
}
