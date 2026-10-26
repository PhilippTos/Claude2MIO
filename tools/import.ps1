<#
.SYNOPSIS
  Importiert MIO-Profile aus öffentlichen Repositories der Organisation mio42-GmbH
  (Liste in config/quellen.json) nach specs/mio/<id>/ und aktualisiert config/mios.json.

.DESCRIPTION
  - Erlaubt sind nur öffentliche Repositories der in quellen.json genannten Organisation.
    Das wird vor jedem Download über die GitHub-API geprüft (ohne Token).
  - art "ig-package":      lädt das veröffentlichte package.tgz (enthält Snapshots).
  - art "validierungspaket": erwartet bereits erzeugte Snapshots in -SnapshotVerzeichnis\<id>\
    (die GitHub Action erzeugt sie mit dem HL7 FHIR Validator) und liest ValueSet-Titel
    aus dem ausgecheckten Repository in -QuellVerzeichnis\<id>\.
  - Beispiele werden nur übernommen, wenn sie in quellen.json unter "freigegebeneBeispiele"
    stehen (vorher manuell auf synthetische Daten prüfen!).

  Läuft mit Windows PowerShell 5.1 und PowerShell 7 (GitHub-Runner).

.EXAMPLE
  powershell -File tools/import.ps1 -Nur west
#>
param(
  [string]$Repo = (Split-Path -Parent $PSScriptRoot),
  [string[]]$Nur = @(),
  [string]$SnapshotVerzeichnis = '',
  [string]$QuellVerzeichnis = '',
  [string]$Bericht = ''
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$utf8 = New-Object System.Text.UTF8Encoding($false)
$kopf = @{ 'User-Agent' = 'mio-eu-spec-compare-import'; 'Accept' = 'application/vnd.github+json' }
$berichtZeilen = New-Object System.Collections.ArrayList

function Notiz([string]$text) {
  Write-Host $text
  [void]$berichtZeilen.Add($text)
}

function Speichere($obj, [string]$pfad) {
  New-Item -ItemType Directory -Force (Split-Path $pfad) | Out-Null
  [IO.File]::WriteAllText($pfad, ($obj | ConvertTo-Json -Depth 100 -Compress), $utf8)
}

function LeseJson([string]$pfad) {
  [IO.File]::ReadAllText($pfad, [Text.Encoding]::UTF8) | ConvertFrom-Json
}

# ------------------------------------------------------------------ Snapshot verschlanken
$behalten = 'id', 'path', 'sliceName', 'short', 'definition', 'min', 'max', 'type', 'binding',
  'mustSupport', 'isModifier', 'contentReference', 'slicing'

function Verschlanke($sd) {
  $els = foreach ($e in $sd.snapshot.element) {
    $n = [ordered]@{}
    foreach ($k in $behalten) { if ($null -ne $e.$k) { $n[$k] = $e.$k } }
    foreach ($p in $e.PSObject.Properties) { if ($p.Name -match '^(fixed|pattern)') { $n[$p.Name] = $p.Value } }
    $obl = @($e.extension | Where-Object { $_.url -like '*obligation*' })
    if ($obl.Count) {
      $n['extension'] = @($obl | ForEach-Object { @{ url = $_.url; extension = @($_.extension | Where-Object { $_.url -in 'code', 'actor' }) } })
    }
    [pscustomobject]$n
  }
  [ordered]@{
    resourceType = 'StructureDefinition'; id = $sd.id; url = $sd.url; version = $sd.version
    name = $sd.name; title = $sd.title; status = $sd.status; kind = $sd.kind; type = $sd.type
    baseDefinition = $sd.baseDefinition; derivation = $sd.derivation; fhirVersion = $sd.fhirVersion
    snapshot = @{ element = @($els) }
  }
}

# ------------------------------------------------------------------ GitHub-Prüfungen
function PruefeOeffentlich([string]$repoName, [string]$organisation) {
  $info = Invoke-RestMethod -Headers $kopf -Uri "https://api.github.com/repos/$repoName"
  if ($info.private -ne $false -or $info.visibility -ne 'public') {
    throw "Repository $repoName ist nicht öffentlich – Import abgebrochen (nur öffentliche mio42-Repos erlaubt)."
  }
  if ($info.owner.login -ne $organisation) {
    throw "Repository $repoName gehört nicht zur Organisation $organisation."
  }
  $commit = Invoke-RestMethod -Headers $kopf -Uri "https://api.github.com/repos/$repoName/commits/$($info.default_branch)"
  return @{ branch = $info.default_branch; sha = $commit.sha; datum = ([datetime]$commit.commit.committer.date).ToString('yyyy-MM-dd'); url = $info.html_url }
}

# ------------------------------------------------------------------ Profile schreiben
function SchreibeQuelle($quelle, $git, $sds, $vsTitel, [string]$version, [string]$stand) {
  $ziel = Join-Path $Repo "specs\mio\$($quelle.id)"
  if (Test-Path $ziel) { Remove-Item -Recurse -Force $ziel }
  $index = @()
  foreach ($sd in ($sds | Sort-Object { $_.type }, { $_.id })) {
    Speichere (Verschlanke $sd) (Join-Path $ziel "$($sd.id).json")
    $index += [ordered]@{ id = $sd.id; url = $sd.url; type = $sd.type; name = $sd.name; title = $(if ($sd.title) { $sd.title } else { $sd.name }); version = $sd.version; datei = "$($sd.id).json" }
  }
  Speichere ([ordered]@{ quelle = $quelle.id; repo = $quelle.repo; commit = $git.sha; stand = $stand; version = $version; profile = $index }) (Join-Path $ziel 'index.json')
  Speichere $vsTitel (Join-Path $ziel 'valuesets.json')

  $eintrag = [ordered]@{
    id = $quelle.id; name = $quelle.name; art = 'profile'; version = $version; stand = $stand
    herkunft = [ordered]@{ repo = $quelle.repo; commit = $git.sha; url = $git.url }
    profilIndex = "specs/mio/$($quelle.id)/index.json"
    valueSetTitel = "specs/mio/$($quelle.id)/valuesets.json"
    igUrl = $quelle.igUrl
  }
  $miosPfad = Join-Path $Repo 'config\mios.json'
  $mios = LeseJson $miosPfad
  $liste = @($mios.mios | Where-Object { $_.id -ne $quelle.id }) + [pscustomobject]$eintrag
  $mios.mios = @($liste | Sort-Object { $_.name })
  Speichere $mios $miosPfad
  $groesse = [math]::Round(((Get-ChildItem $ziel -File | Measure-Object Length -Sum).Sum / 1MB), 2)
  Notiz "- **$($quelle.name)** ($($quelle.repo) @ $($git.sha.Substring(0,7)), Stand $stand, Version $version): $($index.Count) Profile, $groesse MB"
}

# ------------------------------------------------------------------ Quellenarten
function ImportiereIgPackage($quelle, $git, [string]$arbeit) {
  $tgz = Join-Path $arbeit "$($quelle.id).tgz"
  Invoke-WebRequest -UseBasicParsing -Headers @{ 'User-Agent' = $kopf['User-Agent'] } `
    -Uri "https://raw.githubusercontent.com/$($quelle.repo)/$($git.sha)/$($quelle.pfad)" -OutFile $tgz
  $entpackt = Join-Path $arbeit $quelle.id
  New-Item -ItemType Directory -Force $entpackt | Out-Null
  tar -xzf $tgz -C $entpackt
  if ($LASTEXITCODE -ne 0) { throw "package.tgz von $($quelle.repo) konnte nicht entpackt werden." }
  $pkg = Join-Path $entpackt 'package'
  $meta = LeseJson (Join-Path $pkg 'package.json')
  $sds = @(Get-ChildItem $pkg -Filter 'StructureDefinition-*.json' | ForEach-Object { LeseJson $_.FullName } |
      Where-Object { $_.kind -eq 'resource' -and $_.derivation -eq 'constraint' -and $_.snapshot })
  $vs = [ordered]@{}
  Get-ChildItem $pkg -Filter 'ValueSet-*.json' | ForEach-Object { $v = LeseJson $_.FullName; $vs[$v.url] = $(if ($v.title) { $v.title } else { $v.name }) }
  $stand = if ($meta.date -match '^(\d{4})(\d{2})(\d{2})') { "$($Matches[1])-$($Matches[2])-$($Matches[3])" } else { $git.datum }
  SchreibeQuelle $quelle $git $sds $vs $meta.version $stand
}

function ImportiereValidierungspaket($quelle, $git) {
  $snap = if ($SnapshotVerzeichnis) { Join-Path $SnapshotVerzeichnis $quelle.id } else { '' }
  if (-not $snap -or -not (Test-Path $snap)) {
    Notiz "- ⚠ **$($quelle.name)**: keine Snapshots gefunden (werden in der GitHub Action mit dem HL7 FHIR Validator erzeugt) – übersprungen."
    return
  }
  $sds = @(Get-ChildItem $snap -Filter '*.json' | ForEach-Object { LeseJson $_.FullName } |
      Where-Object { $_.resourceType -eq 'StructureDefinition' -and $_.kind -eq 'resource' -and $_.derivation -eq 'constraint' -and $_.snapshot })
  if (-not $sds.Count) { throw "Keine Snapshot-Profile für $($quelle.id) in $snap." }
  $vs = [ordered]@{}
  $quellRepo = if ($QuellVerzeichnis) { Join-Path $QuellVerzeichnis $quelle.id } else { '' }
  if ($quellRepo -and (Test-Path $quellRepo)) {
    Get-ChildItem (Join-Path $quellRepo $quelle.profile) -Recurse -Filter '*.xml' | ForEach-Object {
      [xml]$x = [IO.File]::ReadAllText($_.FullName, [Text.Encoding]::UTF8)
      if ($x.DocumentElement.LocalName -eq 'ValueSet') {
        $url = $x.DocumentElement.url.value
        $titel = $x.DocumentElement.title.value
        if (-not $titel) { $titel = $x.DocumentElement.name.value }
        if ($url) { $vs[$url] = $titel }
      }
    }
    $freigegeben = @($quelle.freigegebeneBeispiele)
    $bspOrdner = Join-Path $quellRepo $quelle.beispiele
    if ($quelle.beispiele -and (Test-Path $bspOrdner)) {
      $alle = @(Get-ChildItem $bspOrdner -File | ForEach-Object Name)
      $offen = @($alle | Where-Object { $_ -notin $freigegeben })
      foreach ($b in ($alle | Where-Object { $_ -in $freigegeben })) {
        $zielB = Join-Path $Repo "samples\$($quelle.id)"
        New-Item -ItemType Directory -Force $zielB | Out-Null
        Copy-Item (Join-Path $bspOrdner $b) $zielB -Force
      }
      if ($offen.Count) { Notiz "  - ⚠ Beispiele noch nicht freigegeben (erst auf synthetische Daten prüfen): $($offen -join ', ')" }
    }
  }
  $version = ($sds | Select-Object -First 1).version
  SchreibeQuelle $quelle $git $sds $vs $version $git.datum
}

# ------------------------------------------------------------------ Ablauf
$cfg = LeseJson (Join-Path $Repo 'config\quellen.json')
$arbeit = Join-Path ([IO.Path]::GetTempPath()) ("mio-import-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force $arbeit | Out-Null
Notiz "## Import aus öffentlichen Repositories von $($cfg.organisation)"
Notiz ''
$fehler = 0
try {
  foreach ($q in $cfg.quellen) {
    if ($Nur.Count -and $q.id -notin $Nur) { continue }
    try {
      if (-not $q.repo.StartsWith($cfg.organisation + '/')) { throw "Repository $($q.repo) liegt nicht in $($cfg.organisation)." }
      $git = PruefeOeffentlich $q.repo $cfg.organisation
      switch ($q.art) {
        'ig-package' { ImportiereIgPackage $q $git $arbeit }
        'validierungspaket' { ImportiereValidierungspaket $q $git }
        default { throw "Unbekannte Quellenart '$($q.art)'." }
      }
    } catch {
      $fehler++
      Notiz "- ✘ **$($q.name)**: $($_.Exception.Message)"
    }
  }
} finally {
  Remove-Item -Recurse -Force $arbeit -ErrorAction SilentlyContinue
}
if ($Bericht) { [IO.File]::WriteAllText($Bericht, ($berichtZeilen -join "`n") + "`n", $utf8) }
if ($fehler) { exit 1 }
