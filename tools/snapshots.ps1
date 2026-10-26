<#
.SYNOPSIS
  Klont Validierungspakete (öffentliche mio42-Repos aus config/quellen.json) und erzeugt
  mit dem HL7 FHIR Validator Snapshots der enthaltenen Profile.

.DESCRIPTION
  Gedacht für die GitHub Action (.github/workflows/import.yml), benötigt Java und git.
  Ergebnis: <Ausgabe>/snapshots/<id>/*.json  und  <Ausgabe>/quellen/<id>/ (ausgecheckt)
  Danach: tools/import.ps1 -SnapshotVerzeichnis <Ausgabe>/snapshots -QuellVerzeichnis <Ausgabe>/quellen

.EXAMPLE
  pwsh tools/snapshots.ps1 -Validator validator_cli.jar -Ausgabe $env:RUNNER_TEMP
#>
param(
  [Parameter(Mandatory = $true)][string]$Validator,
  [Parameter(Mandatory = $true)][string]$Ausgabe,
  [string]$Repo = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$cfg = [IO.File]::ReadAllText((Join-Path $Repo 'config/quellen.json'), [Text.Encoding]::UTF8) | ConvertFrom-Json
$kopf = @{ 'User-Agent' = 'mio-eu-spec-compare-import' }

foreach ($q in $cfg.quellen | Where-Object { $_.art -eq 'validierungspaket' }) {
  $info = Invoke-RestMethod -Headers $kopf -Uri "https://api.github.com/repos/$($q.repo)"
  if ($info.private -ne $false -or $info.visibility -ne 'public' -or $info.owner.login -ne $cfg.organisation) {
    throw "Repository $($q.repo) ist nicht öffentlich oder gehört nicht zu $($cfg.organisation) – abgebrochen."
  }

  $quelle = Join-Path $Ausgabe "quellen/$($q.id)"
  $ziel = Join-Path $Ausgabe "snapshots/$($q.id)"
  if (Test-Path $quelle) { Remove-Item -Recurse -Force $quelle }
  git clone --depth 1 "https://github.com/$($q.repo).git" $quelle
  if ($LASTEXITCODE -ne 0) { throw "Klonen von $($q.repo) fehlgeschlagen." }
  New-Item -ItemType Directory -Force $ziel | Out-Null

  $igs = @()
  foreach ($a in @($q.abhaengigkeiten) + $q.profile) {
    $p = Join-Path $quelle $a
    if (Test-Path $p) { $igs += @('-ig', $p) }
  }

  $profile = Get-ChildItem (Join-Path $quelle $q.profile) -Recurse -Include '*.xml', '*.json' |
    Where-Object { $_.FullName -match '[\\/]StructureDefinitions[\\/]Profiles[\\/]' }
  Write-Host "$($q.id): $($profile.Count) Profile, erzeuge Snapshots …"
  $ok = 0
  foreach ($f in $profile) {
    $out = Join-Path $ziel ([IO.Path]::GetFileNameWithoutExtension($f.Name) + '.json')
    # Neue CLI (Unterbefehl „snapshot“), sonst ältere Syntax (-snapshot -defn)
    & java -jar $Validator snapshot $f.FullName -version 4.0.1 @igs -tx n/a -output $out 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $out)) {
      & java -jar $Validator -snapshot -defn $f.FullName -version 4.0.1 @igs -tx n/a -output $out 2>&1 | Out-Host
    }
    if (Test-Path $out) { $ok++ } else { Write-Warning "Kein Snapshot für $($f.Name)" }
  }
  Write-Host "$($q.id): $ok von $($profile.Count) Snapshots erzeugt."
  if ($ok -eq 0) { throw "Für $($q.id) konnte kein Snapshot erzeugt werden." }
}
