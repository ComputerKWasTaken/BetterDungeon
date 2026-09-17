[CmdletBinding()]
param(
    [string]$BrowserPath,
    [string]$Only,
    [switch]$RefreshSources
)

$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$repoRoot = [IO.Path]::GetFullPath((Join-Path $sourceRoot '../../..'))
$renderRoot = Join-Path $sourceRoot '.render'
$outputRoot = Join-Path $sourceRoot 'exports'
$closeupWidth = 730
$closeupHeight = 800
$captionWidth = 550
$utf8 = [Text.UTF8Encoding]::new($false)

function Get-LocalAsset([string]$Base, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)' -or $Relative -match '^[a-z]+:') {
        throw "Asset must be a local relative path: $Relative"
    }
    $full = [IO.Path]::GetFullPath((Join-Path $Base $Relative))
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Missing asset: $full" }
    return ([Uri]$full).AbsoluteUri
}

if (-not $BrowserPath) {
    $candidates = @(
        "$env:ProgramFiles/Google/Chrome/Application/chrome.exe",
        "${env:ProgramFiles(x86)}/Microsoft/Edge/Application/msedge.exe",
        "$env:ProgramFiles/Microsoft/Edge/Application/msedge.exe"
    )
    $BrowserPath = $candidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (-not $BrowserPath -or -not (Test-Path -LiteralPath $BrowserPath -PathType Leaf)) {
    throw 'Install Chrome or Edge, or supply -BrowserPath with its executable path.'
}

$catalog = Get-Content -LiteralPath (Join-Path $sourceRoot 'slides.json') -Raw | ConvertFrom-Json
$template = Get-Content -LiteralPath (Join-Path $sourceRoot 'template.html') -Raw
$styles = Get-Content -LiteralPath (Join-Path $sourceRoot 'theme.css') -Raw
$brand = Get-LocalAsset $repoRoot $catalog.brandMark
$font = Get-LocalAsset $repoRoot $catalog.font
$slides = @($catalog.slides | Where-Object { -not $Only -or $_.id -eq $Only })
if (-not $slides.Count) { throw "No slide matches '$Only'." }
if (@($catalog.slides.id | Sort-Object -Unique).Count -ne $catalog.slides.Count) { throw 'Slide IDs must be unique.' }
New-Item -ItemType Directory -Path $renderRoot, $outputRoot -Force | Out-Null

foreach ($slide in $slides) {
    if ($slide.id -notmatch '^[a-z0-9-]+$') { throw "Invalid slide ID: $($slide.id)" }
    $expected = switch ($slide.kind) {
        'screenshot' { @(1280, 800) }
        'small' { @(440, 280) }
        'marquee' { @(1400, 560) }
        default { throw "Unknown layout: $($slide.kind)" }
    }
    if ($slide.width -ne $expected[0] -or $slide.height -ne $expected[1]) { throw "Wrong export dimensions for $($slide.id)." }
    if ($slide.kind -eq 'screenshot' -and (([string]$slide.headline -split '\s+').Count -gt 6 -or -not $slide.headline)) {
        throw 'Screenshot headlines must contain one to six words.'
    }
    if ($slide.kind -eq 'screenshot' -and (@($slide.bullets).Count -ne 3 -or -not $slide.capture)) {
        throw "Screenshot $($slide.id) requires three bullets and a local capture."
    }
    $data = [ordered]@{ kind = $slide.kind; width = $slide.width; height = $slide.height; headline = $slide.headline; brandMark = $brand; font = $font }
    if ($slide.kind -eq 'screenshot') {
        $data.bullets = @($slide.bullets)
        $captureBase = if ($slide.captureRoot -eq 'repo') { $repoRoot } else { $sourceRoot }
        $data.capture = Get-LocalAsset $captureBase $slide.capture
        $data.position = $slide.position
        $data.source = $slide.source
    }
    $encoded = [Convert]::ToBase64String($utf8.GetBytes(($data | ConvertTo-Json -Compress)))
    $html = $template.Replace('/*__STYLES__*/', $styles).Replace('/*__DATA__*/', $encoded)
    $pagePath = Join-Path $renderRoot "$($slide.id).html"
    $pngPath = Join-Path $outputRoot "$($slide.id).png"
    [IO.File]::WriteAllText($pagePath, $html, $utf8)
    # A separate browser profile keeps rendering independent of the user's tabs.
    $arguments = @(
        '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
        '--disable-component-update', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
        '--run-all-compositor-stages-before-draw', '--virtual-time-budget=4000',
        "--user-data-dir=`"$(Join-Path $renderRoot 'browser-profile')`"",
        "--window-size=$($slide.width),$($slide.height)", "--screenshot=`"$pngPath`"", "`"$(([Uri]$pagePath).AbsoluteUri)`""
    )
    $process = Start-Process -FilePath $BrowserPath -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $renderRoot 'browser.log')
    if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Browser export exceeded 30 seconds.' }
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $pngPath)) { throw "Export failed: $($slide.id). See .render/browser.log." }
    $png = [IO.File]::ReadAllBytes($pngPath)
    $width = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($png, 16))
    $height = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($png, 20))
    if ($width -ne $slide.width -or $height -ne $slide.height) { throw "Incorrect PNG dimensions: $width x $height." }
    Write-Host "$($slide.id).png — $width x $height"
}

if ($RefreshSources) {
    foreach ($slide in @($slides | Where-Object { $_.kind -eq 'screenshot' })) {
        if (-not $slide.sourceCapture) { throw "Screenshot $($slide.id) needs sourceCapture when refreshing sources." }
        $exportPath = Join-Path $outputRoot "$($slide.id).png"
        $closeupPath = Join-Path $sourceRoot $slide.sourceCapture
        $exportUri = ([Uri]$exportPath).AbsoluteUri
        $closeupHtml = "<!doctype html><meta charset='utf-8'><style>html,body{margin:0;width:${closeupWidth}px;height:${closeupHeight}px;overflow:hidden;background:#0f0e11}img{display:block;width:1280px;height:800px;transform:translateX(-${captionWidth}px)}</style><img src='$exportUri' alt=''>"
        $closeupPage = Join-Path $renderRoot "$($slide.id)-source.html"
        [IO.File]::WriteAllText($closeupPage, $closeupHtml, $utf8)
        $arguments = @(
            '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
            '--disable-component-update', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
            '--run-all-compositor-stages-before-draw', '--virtual-time-budget=1000',
            "--user-data-dir=`"$(Join-Path $renderRoot 'browser-profile')`"",
            "--window-size=$closeupWidth,$closeupHeight", "--screenshot=`"$closeupPath`"", "`"$(([Uri]$closeupPage).AbsoluteUri)`""
        )
        $process = Start-Process -FilePath $BrowserPath -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $renderRoot 'browser.log')
        if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Close-up export exceeded 30 seconds.' }
        if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $closeupPath)) { throw "Close-up export failed: $($slide.id)." }
        $png = [IO.File]::ReadAllBytes($closeupPath)
        $width = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($png, 16))
        $height = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($png, 20))
        if ($width -ne $closeupWidth -or $height -ne $closeupHeight) { throw "Incorrect close-up dimensions: $width x $height." }
        Write-Host "$($slide.sourceCapture) — $width x $height"
    }
}

$cards = foreach ($slide in $catalog.slides) {
    $path = Join-Path $outputRoot "$($slide.id).png"
    if (Test-Path -LiteralPath $path) {
        "<figure><img src='$(([Uri]$path).AbsoluteUri)' alt='$($slide.id)'><figcaption>$($slide.id) &middot; $($slide.width) &times; $($slide.height)</figcaption></figure>"
    }
}
$review = "<!doctype html><html><meta charset='utf-8'><title>BetterDungeon store images</title><style>body{margin:32px;background:#0f0e11;color:#e8e8ec;font:16px system-ui}main{display:grid;grid-template-columns:repeat(2,640px);gap:28px}figure{margin:0}img{display:block;max-width:640px;width:100%;height:auto}figcaption{margin:10px 0 18px;color:#a0a0a8}</style><main>$($cards -join '')</main></html>"
[IO.File]::WriteAllText((Join-Path $renderRoot 'review.html'), $review, $utf8)
Write-Host 'Review .render/review.html at 100% browser zoom. Screenshots display at Store size.'
