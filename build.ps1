[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('test', 'extension', 'android', 'all', 'clean')]
    [string]$Target = 'all'
)

$ErrorActionPreference = 'Stop'
$RepoRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$BuildRoot = Join-Path $RepoRoot '.build'
$DistRoot = Join-Path $RepoRoot 'dist'
$AndroidRoot = Join-Path $RepoRoot 'android'

function Assert-SafeGeneratedPath([string]$Path) {
    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $rootPrefix = $RepoRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the BetterDungeon repository: $fullPath"
    }
    $allowed = @(
        [System.IO.Path]::GetFullPath($BuildRoot),
        [System.IO.Path]::GetFullPath($DistRoot),
        [System.IO.Path]::GetFullPath((Join-Path $AndroidRoot 'build')),
        [System.IO.Path]::GetFullPath((Join-Path $AndroidRoot 'app\build')),
        [System.IO.Path]::GetFullPath((Join-Path $AndroidRoot '.gradle')),
        [System.IO.Path]::GetFullPath((Join-Path $AndroidRoot '.kotlin'))
    )
    if ($allowed -notcontains $fullPath) {
        throw "Refusing to modify an undeclared generated path: $fullPath"
    }
}

function Remove-GeneratedDirectory([string]$Path) {
    Assert-SafeGeneratedPath $Path
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
}

function Get-Versions {
    $manifest = Get-Content -LiteralPath (Join-Path $RepoRoot 'manifest.json') -Raw | ConvertFrom-Json
    $gradleSource = Get-Content -LiteralPath (Join-Path $AndroidRoot 'app\build.gradle.kts') -Raw
    if ($gradleSource -notmatch 'versionName\s*=\s*"([^"]+)"') {
        throw 'Unable to read Android versionName.'
    }
    $androidVersion = $Matches[1]
    if ($manifest.version -ne $androidVersion) {
        throw "Version mismatch: manifest.json is $($manifest.version), Android is $androidVersion."
    }
    return [pscustomobject]@{ Extension = [string]$manifest.version; Android = $androidVersion }
}

function Invoke-NodeTests {
    Write-Host 'Running BetterDungeon repository smoke checks...'
    & node (Join-Path $RepoRoot 'tests\run-all.mjs')
    if ($LASTEXITCODE -ne 0) { throw "Node tests failed with exit code $LASTEXITCODE." }
}

function Build-Extension {
    $versions = Get-Versions
    $stageRoot = Join-Path $BuildRoot 'extension'
    Remove-GeneratedDirectory $BuildRoot
    New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
    New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null

    $allowList = Get-Content -LiteralPath (Join-Path $RepoRoot 'build\extension-files.txt') |
        ForEach-Object { $_.Trim() } |
        Where-Object { $_ -and -not $_.StartsWith('#') }
    if (($allowList | Sort-Object -Unique).Count -ne $allowList.Count) {
        throw 'The extension package allowlist contains duplicate paths.'
    }
    foreach ($relativePath in $allowList) {
        if ([System.IO.Path]::IsPathRooted($relativePath) -or ($relativePath -split '[\\/]' -contains '..')) {
            throw "Unsafe extension package path: $relativePath"
        }
        $source = Join-Path $RepoRoot $relativePath
        if (-not (Test-Path -LiteralPath $source)) { throw "Missing extension package source: $relativePath" }
        $destination = Join-Path $stageRoot $relativePath
        New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination -Recurse
    }

    if (-not (Test-Path -LiteralPath (Join-Path $stageRoot 'manifest.json'))) {
        throw 'The staged extension does not have manifest.json at its root.'
    }

    $zipPath = Join-Path $DistRoot "BetterDungeon-$($versions.Extension).zip"
    if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
    Compress-Archive -Path (Join-Path $stageRoot '*') -DestinationPath $zipPath -CompressionLevel Optimal

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\\', '/') })
        if ($entries -notcontains 'manifest.json') { throw 'Packaged extension ZIP is missing root manifest.json.' }
        if ($entries | Where-Object { $_ -match '^(android|tests|build|dist|\.git)/' }) {
            throw 'Packaged extension ZIP contains development or Android files.'
        }
    }
    finally {
        $archive.Dispose()
    }
    Write-Host "Created $zipPath"
    return $zipPath
}

function Use-AndroidEnvironment {
    $androidStudioJbr = 'C:\Program Files\Android\Android Studio\jbr'
    $hasJava21 = $false
    if ($env:JAVA_HOME) {
        $javaExecutable = Join-Path $env:JAVA_HOME 'bin\java.exe'
        if (Test-Path -LiteralPath $javaExecutable) {
            $javaVersion = (& $javaExecutable -version 2>&1 | Out-String)
            $hasJava21 = $javaVersion -match 'version "21(?:\.|\")'
        }
    }
    if (-not $hasJava21 -and (Test-Path -LiteralPath $androidStudioJbr)) {
        $env:JAVA_HOME = $androidStudioJbr
        $env:Path = (Join-Path $androidStudioJbr 'bin') + [System.IO.Path]::PathSeparator + $env:Path
    }
    if (-not $env:ANDROID_HOME) {
        $localSdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
        if (Test-Path -LiteralPath $localSdk) { $env:ANDROID_HOME = $localSdk }
    }
    if (-not $env:ANDROID_SDK_ROOT -and $env:ANDROID_HOME) { $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME }
}

function Build-Android {
    $versions = Get-Versions
    Use-AndroidEnvironment
    Push-Location $AndroidRoot
    try {
        & .\gradlew.bat --no-daemon testDebugUnitTest assembleDebug
        if ($LASTEXITCODE -ne 0) { throw "Android build failed with exit code $LASTEXITCODE." }
    }
    finally {
        Pop-Location
    }

    $sourceApk = Join-Path $AndroidRoot 'app\build\outputs\apk\debug\app-debug.apk'
    if (-not (Test-Path -LiteralPath $sourceApk)) { throw "Android build did not produce $sourceApk" }
    New-Item -ItemType Directory -Path $DistRoot -Force | Out-Null
    $apkPath = Join-Path $DistRoot "BetterDungeon-Mobile-$($versions.Android)-debug.apk"
    Copy-Item -LiteralPath $sourceApk -Destination $apkPath -Force
    Write-Host "Created $apkPath"
    return $apkPath
}

function Clean-GeneratedOutput {
    foreach ($path in @(
        $BuildRoot,
        $DistRoot,
        (Join-Path $AndroidRoot 'build'),
        (Join-Path $AndroidRoot 'app\build'),
        (Join-Path $AndroidRoot '.gradle'),
        (Join-Path $AndroidRoot '.kotlin')
    )) {
        Remove-GeneratedDirectory $path
    }
    Write-Host 'Removed BetterDungeon generated output.'
}

switch ($Target) {
    'test' { Invoke-NodeTests }
    'extension' { Build-Extension | Out-Null }
    'android' { Build-Android | Out-Null }
    'all' {
        Invoke-NodeTests
        Build-Extension | Out-Null
        Build-Android | Out-Null
    }
    'clean' { Clean-GeneratedOutput }
}
