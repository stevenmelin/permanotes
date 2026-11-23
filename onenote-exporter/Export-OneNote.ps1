# Export-OneNote.ps1
# Exports every open OneNote notebook from the LOCAL OneNote desktop app (no Microsoft cloud needed).
# Output: Desktop\OneNote Export\ (+ OneNote Export.zip)
#   hierarchy.xml   - full notebook/section-group/section/page tree
#   pages.json      - page order + exact notebook/section names (used by PermaNotes import)
#   pages.csv       - one row per page (notebook, section path, title, dates, sub-page level, file)
#   <Notebook>\<Section groups>\<Section>\NNN - <Title>.xml  - lossless page XML (text, tables, checkboxes, images inline as base64)
#   ...\<Section>\files\  - attachments and audio/video copied from OneNote's local cache
#   errors.txt      - every failure with the real error message
#   skipped.txt     - locked (password) sections and recycle-bin items not exported

$ErrorActionPreference = 'Stop'

function Fail($msg, $err) {
    Write-Host ""
    Write-Host "==================== EXPORT FAILED ====================" -ForegroundColor Red
    Write-Host $msg -ForegroundColor Red
    if ($err) { Write-Host ""; Write-Host ($err | Out-String) -ForegroundColor Yellow }
    exit 1
}

function Clean([string]$name, [int]$max = 60) {
    if ([string]::IsNullOrWhiteSpace($name)) { $name = 'Untitled' }
    $bad = [IO.Path]::GetInvalidFileNameChars() -join ''
    $c = ($name -replace "[$([Regex]::Escape($bad))]", '_').Trim().TrimEnd('.')
    if ($c.Length -gt $max) { $c = $c.Substring(0, $max).Trim() }
    if ($c -eq '') { $c = 'Untitled' }
    return $c
}

$desktop = [Environment]::GetFolderPath('Desktop')
$outRoot = Join-Path $desktop 'OneNote Export'
$zipPath = Join-Path $desktop 'OneNote Export.zip'

Write-Host "Connecting to OneNote on this PC..." -ForegroundColor Cyan
try {
    $on = New-Object -ComObject OneNote.Application
} catch {
    Fail ("Could not connect to the OneNote desktop app. This exporter needs 'OneNote' (the Microsoft 365 / Office desktop version) " +
          "installed on this PC. The old 'OneNote for Windows 10' Store app cannot be exported this way.") $_
}

$hx = ''
try { $on.GetHierarchy('', 4, [ref]$hx) } catch { Fail "OneNote refused to list your notebooks." $_ }
[xml]$h = $hx
$nsUri = $h.DocumentElement.NamespaceURI
$ns = New-Object Xml.XmlNamespaceManager $h.NameTable
$ns.AddNamespace('one', $nsUri)

if (Test-Path $outRoot) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    Rename-Item $outRoot "OneNote Export (old $stamp)"
}
New-Item -ItemType Directory -Path $outRoot | Out-Null
$h.Save((Join-Path $outRoot 'hierarchy.xml'))

$errors  = New-Object System.Collections.Generic.List[string]
$skipped = New-Object System.Collections.Generic.List[string]
$rows    = New-Object System.Collections.Generic.List[object]
$jrows   = New-Object System.Collections.Generic.List[object]

# Locked / recycle-bin bookkeeping
foreach ($s in $h.SelectNodes('//one:Section', $ns)) {
    if ($s.locked -eq 'true' -or $s.encrypted -eq 'true') { $skipped.Add("LOCKED (password-protected - unlock it in OneNote and re-run): $($s.path)") }
}

# Collect exportable pages with their folder path
$work = @()
foreach ($p in $h.SelectNodes('//one:Page', $ns)) {
    $skip = $false
    $parts = @()
    $raw = @()
    $node = $p.ParentNode
    $section = $node
    while ($node -and $node.LocalName -ne 'Notebooks') {
        if ($node.isRecycleBin -eq 'true' -or $node.isInRecycleBin -eq 'true') { $skip = $true }
        if ($node.LocalName -in @('Notebook','SectionGroup','Section')) { $parts = ,(Clean $node.name) + $parts; $raw = ,([string]$node.name) + $raw }
        $node = $node.ParentNode
    }
    if ($p.isInRecycleBin -eq 'true') { $skip = $true }
    if ($skip) { $skipped.Add("RECYCLE BIN: $($section.name) / $($p.name)"); continue }
    $work += [pscustomobject]@{ Page = $p; Section = $section; Parts = $parts; Raw = $raw }
}

if ($work.Count -eq 0) {
    Fail "OneNote reported 0 pages. Open OneNote, make sure your notebooks are listed on the left (File > Open if not), then run this again." $null
}

Write-Host "Found $($work.Count) pages. Exporting..." -ForegroundColor Cyan

$counter = @{}
$i = 0; $nImg = 0; $nTbl = 0; $nFile = 0
foreach ($w in $work) {
    $i++
    $p = $w.Page
    $title = $p.name
    Write-Progress -Activity "Exporting OneNote ($i of $($work.Count))" -Status "$($w.Parts -join ' > ') > $title" -PercentComplete ([int](100 * $i / $work.Count))

    $dir = Join-Path $outRoot ($w.Parts -join '\')
    try {
        if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
        if (-not $counter.ContainsKey($dir)) { $counter[$dir] = 0 }
        $counter[$dir]++
        $fileName = ('{0:D3} - {1}.xml' -f $counter[$dir], (Clean $title))

        $px = ''
        $on.GetPageContent($p.ID, [ref]$px, 7, 2)   # 7 = everything incl. images as data; 2 = 2013 schema
        [xml]$pd = $px
        $pns = New-Object Xml.XmlNamespaceManager $pd.NameTable
        $pns.AddNamespace('one', $pd.DocumentElement.NamespaceURI)

        $nImg += $pd.SelectNodes('//one:Image', $pns).Count
        $nTbl += $pd.SelectNodes('//one:Table', $pns).Count

        # Attachments + audio/video: copy from OneNote's local cache, record the exported name on the node
        $fdir = Join-Path $dir 'files'
        foreach ($f in $pd.SelectNodes('//one:InsertedFile | //one:MediaFile', $pns)) {
            $src = $f.pathCache
            if (-not $src -or -not (Test-Path -LiteralPath $src)) {
                $errors.Add("ATTACHMENT MISSING FROM LOCAL CACHE: '$($f.preferredName)' on page '$title' ($($w.Parts -join ' > ')). OneNote never downloaded it to this PC.")
                continue
            }
            if (-not (Test-Path $fdir)) { New-Item -ItemType Directory -Path $fdir | Out-Null }
            $nFile++
            $dest = ('{0:D3}-{1:D4} - {2}' -f $counter[$dir], $nFile, (Clean $f.preferredName 100))
            Copy-Item -LiteralPath $src -Destination (Join-Path $fdir $dest)
            $f.SetAttribute('exportedFile', "files/$dest")
        }

        $settings = New-Object Xml.XmlWriterSettings
        $settings.Indent = $true
        $settings.Encoding = New-Object Text.UTF8Encoding($false)
        $xw = [Xml.XmlWriter]::Create((Join-Path $dir $fileName), $settings)
        $pd.Save($xw); $xw.Close()

        $jrows.Add([pscustomobject]@{ File = (($w.Parts -join '/') + '/' + $fileName); Path = @($w.Raw); Title = [string]$title })
        $rows.Add([pscustomobject]@{
            Notebook     = $w.Parts[0]
            SectionPath  = ($w.Parts[1..($w.Parts.Count-1)] -join ' > ')
            Title        = $title
            Created      = $p.dateTime
            Modified     = $p.lastModifiedTime
            SubPageLevel = $p.pageLevel
            File         = (($w.Parts -join '\') + '\' + $fileName)
        })
    } catch {
        $errors.Add("PAGE FAILED: '$title' ($($w.Parts -join ' > ')): $($_.Exception.ToString())")
    }
}
Write-Progress -Activity "Exporting OneNote" -Completed

[IO.File]::WriteAllText((Join-Path $outRoot 'pages.json'), (ConvertTo-Json -InputObject @($jrows.ToArray()) -Depth 5), (New-Object Text.UTF8Encoding($false)))
$rows | Export-Csv -Path (Join-Path $outRoot 'pages.csv') -NoTypeInformation -Encoding UTF8
$errors  | Set-Content -Path (Join-Path $outRoot 'errors.txt')  -Encoding UTF8
$skipped | Set-Content -Path (Join-Path $outRoot 'skipped.txt') -Encoding UTF8

Write-Host "Zipping..." -ForegroundColor Cyan
if (Test-Path $zipPath) { Remove-Item $zipPath }
try {
    Compress-Archive -Path (Join-Path $outRoot '*') -DestinationPath $zipPath
} catch {
    $errors.Add("ZIP FAILED: $($_.Exception.ToString())")
    Write-Host "Zipping failed - the 'OneNote Export' folder on your Desktop is still complete. Right-click it > Send to > Compressed (zipped) folder." -ForegroundColor Yellow
    Write-Host ($_ | Out-String) -ForegroundColor Yellow
}

$nb = ($rows | Select-Object -ExpandProperty Notebook -Unique).Count
Write-Host ""
Write-Host "==================== DONE ====================" -ForegroundColor Green
Write-Host "Notebooks:    $nb"
Write-Host "Pages:        $($rows.Count) of $($work.Count)"
Write-Host "Images:       $nImg"
Write-Host "Tables:       $nTbl"
Write-Host "Attachments:  $nFile"
Write-Host "Skipped:      $($skipped.Count)  (see skipped.txt)"
if ($errors.Count -gt 0) {
    Write-Host "PROBLEMS:     $($errors.Count)  (see errors.txt) - first few:" -ForegroundColor Red
    $errors | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
} else {
    Write-Host "Problems:     0" -ForegroundColor Green
}
Write-Host ""
Write-Host "Your export: $zipPath"
