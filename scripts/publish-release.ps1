# Publishes release/BigBuncher.exe as GitHub release v<package.json version>.
# Every BigBuncher checks github.com/<Repo>/releases/latest and offers the update itself.
#
# Usage (after `npm run dist`):
#   powershell -ExecutionPolicy Bypass -File scripts/publish-release.ps1 -Notes "What changed"
#
# The token is read from -TokenFile and never printed.
param(
  [string]$Repo = "ahmaPley/BigBuncher",
  [string]$TokenFile = "$env:USERPROFILE\.secrets\github_token.txt",
  [string]$Notes = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "release\BigBuncher.exe"
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
if (-not (Test-Path $exe)) { throw "release\BigBuncher.exe not found - run npm run dist first" }
if (-not (Test-Path $TokenFile)) { throw "Token file not found: $TokenFile" }

$token = (Get-Content $TokenFile -Raw).Trim()
$headers = @{
  "Authorization"        = "Bearer $token"
  "Accept"               = "application/vnd.github+json"
  "X-GitHub-Api-Version" = "2022-11-28"
  "User-Agent"           = "bigbuncher-release"
}
function Api($method, $url, $body) {
  $p = @{ Method = $method; Uri = $url; Headers = $headers; UseBasicParsing = $true }
  if ($body) { $p.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Depth 5)); $p.ContentType = "application/json; charset=utf-8" }
  (Invoke-WebRequest @p).Content | ConvertFrom-Json
}

try {
  $owner, $name = $Repo.Split("/")
  try { Api GET "https://api.github.com/repos/$Repo" $null | Out-Null }
  catch {
    Write-Host "Repository $Repo not found - creating it (public, releases only)"
    Api POST "https://api.github.com/user/repos" @{ name = $name; description = "BigBuncher - Minecraft launcher (releases / auto-update)"; private = $false; auto_init = $true } | Out-Null
    Start-Sleep -Seconds 3
  }

  $tag = "v$version"
  try { $existing = Api GET "https://api.github.com/repos/$Repo/releases/tags/$tag" $null } catch { $existing = $null }
  if ($existing) { throw "Release $tag already exists - bump the version in package.json" }

  $release = Api POST "https://api.github.com/repos/$Repo/releases" @{ tag_name = $tag; name = "BigBuncher $version"; body = $Notes; draft = $false; prerelease = $false }
  Write-Host "Created release $tag, uploading BigBuncher.exe ($([math]::Round((Get-Item $exe).Length / 1MB)) MB)..."

  $upload = "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets?name=BigBuncher.exe"
  Invoke-WebRequest -Method POST -Uri $upload -Headers $headers -InFile $exe -ContentType "application/octet-stream" -UseBasicParsing | Out-Null
  Write-Host "Done: $($release.html_url)"
}
finally {
  Remove-Variable token -ErrorAction SilentlyContinue
  $headers = $null
}
