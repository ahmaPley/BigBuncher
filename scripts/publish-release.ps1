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
  [string]$Notes = "",
  # Replace the exe of an already published release (hotfix without a version bump).
  [switch]$Replace,
  # Upload every file of this folder to the "packs" pre-release (packs of the recommended servers; never latest).
  [string]$PackDir = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "release\BigBuncher.exe"
$version = (Get-Content (Join-Path $root "package.json") -Raw | ConvertFrom-Json).version
if ($PackDir) {
  $token = (Get-Content $TokenFile -Raw).Trim()
  $h = @{ "Authorization" = "Bearer $token"; "Accept" = "application/vnd.github+json"; "User-Agent" = "bigbuncher-release" }
  try {
    try { $rel = (Invoke-WebRequest -Uri "https://api.github.com/repos/$Repo/releases/tags/packs" -Headers $h -UseBasicParsing).Content | ConvertFrom-Json }
    catch {
      $body = [Text.Encoding]::UTF8.GetBytes((@{ tag_name = "packs"; name = "Packs"; body = "Files BigBuncher downloads by itself (recommended servers). Not a launcher release."; prerelease = $true } | ConvertTo-Json))
      $rel = (Invoke-WebRequest -Method POST -Uri "https://api.github.com/repos/$Repo/releases" -Headers $h -Body $body -ContentType "application/json; charset=utf-8" -UseBasicParsing).Content | ConvertFrom-Json
    }
    foreach ($file in Get-ChildItem $PackDir -File) {
      $old = $rel.assets | Where-Object { $_.name -eq $file.Name }
      if ($old) { Invoke-WebRequest -Method DELETE -Uri "https://api.github.com/repos/$Repo/releases/assets/$($old.id)" -Headers $h -UseBasicParsing | Out-Null }
      Write-Host "Uploading $($file.Name) ($([math]::Round($file.Length / 1MB)) MB)"
      Invoke-WebRequest -Method POST -Uri "https://uploads.github.com/repos/$Repo/releases/$($rel.id)/assets?name=$($file.Name)" -Headers $h -InFile $file.FullName -ContentType "application/octet-stream" -UseBasicParsing | Out-Null
    }
    Write-Host "Done: $($rel.html_url)"
  } finally { Remove-Variable token -ErrorAction SilentlyContinue; $h = $null }
  exit 0
}
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
  $oldAsset = if ($existing) { $existing.assets | Where-Object { $_.name -eq "BigBuncher.exe" } } else { $null }
  if ($oldAsset -and -not $Replace) {
    throw "Release $tag already has BigBuncher.exe - bump the version in package.json (or pass -Replace for a hotfix)"
  }
  if ($oldAsset) {
    Write-Host "Removing the old BigBuncher.exe from $tag"
    Invoke-WebRequest -Method DELETE -Uri "https://api.github.com/repos/$Repo/releases/assets/$($oldAsset.id)" -Headers $headers -UseBasicParsing | Out-Null
  }
  # A release left without the exe (failed upload) is reused, so the script can simply be re-run.
  $release = if ($existing) { $existing } else {
    Api POST "https://api.github.com/repos/$Repo/releases" @{ tag_name = $tag; name = "BigBuncher $version"; body = $Notes; draft = $false; prerelease = $false }
  }
  Write-Host "Release $tag ready, uploading BigBuncher.exe ($([math]::Round((Get-Item $exe).Length / 1MB)) MB)..."

  $upload = "https://uploads.github.com/repos/$Repo/releases/$($release.id)/assets?name=BigBuncher.exe"
  Invoke-WebRequest -Method POST -Uri $upload -Headers $headers -InFile $exe -ContentType "application/octet-stream" -UseBasicParsing | Out-Null
  Write-Host "Done: $($release.html_url)"
}
finally {
  Remove-Variable token -ErrorAction SilentlyContinue
  $headers = $null
}
