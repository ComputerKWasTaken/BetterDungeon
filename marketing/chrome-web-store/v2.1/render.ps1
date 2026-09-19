[CmdletBinding()]
param(
    [string]$BrowserPath,
    [string]$Only
)

$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$repoRoot = [IO.Path]::GetFullPath((Join-Path $sourceRoot '../../..'))
$renderRoot = Join-Path $sourceRoot '.render'
$outputRoot = Join-Path $sourceRoot 'exports'
$utf8 = [Text.UTF8Encoding]::new($false)

function Get-LocalAsset([string]$Base, [string]$Relative) {
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)' -or $Relative -match '^[a-z]+:') {
        throw "Asset must be a local relative path: $Relative"
    }
    $full = [IO.Path]::GetFullPath((Join-Path $Base $Relative))
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { throw "Missing asset: $full" }
    return ([Uri]$full).AbsoluteUri
}

function Assert-PngSize([string]$Path, [int]$Width, [int]$Height) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing export: $Path" }
    $png = [IO.File]::ReadAllBytes($Path)
    $actualWidth = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($png, 16))
    $actualHeight = [Net.IPAddress]::NetworkToHostOrder([BitConverter]::ToInt32($png, 20))
    if ($actualWidth -ne $Width -or $actualHeight -ne $Height) {
        throw "Incorrect PNG dimensions for $Path`: $actualWidth x $actualHeight."
    }
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
    if ($slide.width -ne $expected[0] -or $slide.height -ne $expected[1]) {
        throw "Wrong export dimensions for $($slide.id)."
    }
    $pngPath = Join-Path $outputRoot "$($slide.id).png"

    $data = [ordered]@{
        kind = $slide.kind
        width = $slide.width
        height = $slide.height
        brandMark = $brand
        font = $font
    }
    if ($slide.kind -eq 'screenshot') {
        if ($slide.layout -notin @('overview', 'navigator', 'modes', 'presets', 'toolkit')) {
            throw "Unsupported screenshot layout: $($slide.layout)"
        }
        if (-not $slide.headline -or (([string]$slide.headline -split '\s+').Count -gt 6)) {
            throw "Screenshot $($slide.id) needs a headline of at most six words."
        }
        if (@($slide.bullets).Count -gt 4) {
            throw "Screenshot $($slide.id) allows up to four bullets."
        }
        $data.layout = $slide.layout
        $data.eyebrow = $slide.eyebrow
        $data.headline = $slide.headline
        $data.highlight = $slide.highlight
        $data.description = $slide.description
        $data.bullets = @($slide.bullets)
        $data.chips = @($slide.chips | Where-Object { $null -ne $_ })
        $data.features = @($slide.features | Where-Object { $null -ne $_ })
        $data.cta = $slide.cta
        $data.captures = @($slide.captures | ForEach-Object {
            if (-not $_.label) { throw "Capture in $($slide.id) needs a label." }
            [ordered]@{ path = Get-LocalAsset $sourceRoot $_.path; label = $_.label; chrome = ($_.chrome -ne $false) }
        })
    }

    $encoded = [Convert]::ToBase64String($utf8.GetBytes(($data | ConvertTo-Json -Depth 6 -Compress)))
    $html = $template.Replace('/*__STYLES__*/', $styles).Replace('/*__DATA__*/', $encoded)
    $pagePath = Join-Path $renderRoot "$($slide.id).html"
    [IO.File]::WriteAllText($pagePath, $html, $utf8)
    $arguments = @(
        '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
        '--disable-component-update', '--hide-scrollbars', '--force-device-scale-factor=1', '--allow-file-access-from-files',
        '--run-all-compositor-stages-before-draw', '--virtual-time-budget=4000',
        "--user-data-dir=`"$(Join-Path $renderRoot 'browser-profile')`"",
        "--window-size=$($slide.width),$($slide.height)", "--screenshot=`"$pngPath`"", "`"$(([Uri]$pagePath).AbsoluteUri)`""
    )
    $process = Start-Process -FilePath $BrowserPath -ArgumentList $arguments -PassThru -WindowStyle Hidden -RedirectStandardError (Join-Path $renderRoot 'browser.log')
    if (-not $process.WaitForExit(30000)) { $process.Kill(); throw "Export exceeded 30 seconds: $($slide.id)" }
    $exitCode = $null
    try { $exitCode = $process.ExitCode } catch { }
    if ($null -ne $exitCode -and $exitCode -ne 0) { throw "Export failed: $($slide.id). See .render/browser.log." }
    Assert-PngSize $pngPath $slide.width $slide.height
    Write-Host "$($slide.id).png — $($slide.width) x $($slide.height)"
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
