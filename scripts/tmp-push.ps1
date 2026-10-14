# 临时推送脚本（直连 github 不通，走 Git Data API）。跑完即删。
param(
  [string]$Repo = 'Kimcop-kc/vela',
  [string]$DiffFrom = 'HEAD~1',
  [Parameter(Mandatory = $true)][string]$BaseCommit,
  [Parameter(Mandatory = $true)][string]$LocalHead,
  [Parameter(Mandatory = $true)][string]$CommitMessageFile,
  [Parameter(Mandatory = $true)][string]$TagName,
  [Parameter(Mandatory = $true)][string]$TagMessageFile
)
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Write-Json($p, $o) { [System.IO.File]::WriteAllText($p, ($o | ConvertTo-Json -Depth 12 -Compress), $utf8) }
function Retry([scriptblock]$action, $what) {
  for ($i = 1; $i -le 5; $i++) {
    try {
      $text = (& $action | Out-String).Trim()
      if ($text -match '^[0-9a-f]{40}$') { return $text }
      throw "$what 返回的不是 sha：$text"
    } catch {
      if ($i -lt 5 -and $_.Exception.Message -match 'EOF|connect|timeout|reset') { Write-Host "$what 第 $i 次失败，重试…"; Start-Sleep -Seconds (2 * $i); continue }
      throw
    }
  }
}
$baseTree = (gh api "repos/$Repo/git/commits/$BaseCommit" --jq '.tree.sha').Trim()
$dir = Join-Path $env:TEMP ("vela-push-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$entries = New-Object System.Collections.ArrayList
$n = 0
foreach ($line in (git diff --name-status $DiffFrom $LocalHead)) {
  if (-not $line.Trim()) { continue }
  $parts = $line -split "`t"
  $status = $parts[0].Substring(0, 1)
  $file = ($parts[1..($parts.Count - 1)] -join "`t")
  if ($status -eq 'D') { [void]$entries.Add(@{ path = $file; mode = '100644'; type = 'blob'; sha = $null }); continue }
  $n++
  $payload = Join-Path $dir "b$n.json"
  $bytes = [System.IO.File]::ReadAllBytes((Join-Path (Get-Location) $file))
  $normalized = [System.Text.Encoding]::UTF8.GetBytes(([System.Text.Encoding]::UTF8.GetString($bytes) -replace "`r`n", "`n"))
  Write-Json $payload @{ content = [Convert]::ToBase64String($normalized); encoding = 'base64' }
  $sha = Retry { gh api --method POST "repos/$Repo/git/blobs" --input $payload --jq '.sha' 2>&1 } "blob($file)"
  $expect = (git rev-parse "${LocalHead}:$file").Trim()
  if ($sha -ne $expect) { throw "blob 与本地提交不一致：$file" }
  [void]$entries.Add(@{ path = $file; mode = '100644'; type = 'blob'; sha = $sha })
}
Write-Output "blobs verified: $n"
$treePayload = Join-Path $dir 'tree.json'
Write-Json $treePayload @{ base_tree = $baseTree; tree = $entries.ToArray() }
$treeSha = Retry { gh api --method POST "repos/$Repo/git/trees" --input $treePayload --jq '.sha' 2>&1 } 'tree'
$localTree = (git rev-parse "${LocalHead}^{tree}").Trim()
if ($treeSha -ne $localTree) { throw "远端树 $treeSha 与本地 $localTree 不一致，已停止" }
Write-Output "tree OK: $treeSha"
$commitPayload = Join-Path $dir 'commit.json'
Write-Json $commitPayload @{ message = [System.IO.File]::ReadAllText($CommitMessageFile, $utf8); tree = $treeSha; parents = @($BaseCommit) }
$commitSha = Retry { gh api --method POST "repos/$Repo/git/commits" --input $commitPayload --jq '.sha' 2>&1 } 'commit'
Write-Output "commit: $commitSha"
$refPayload = Join-Path $dir 'ref.json'
Write-Json $refPayload @{ sha = $commitSha; force = $true }
gh api --method PATCH "repos/$Repo/git/refs/heads/master" --input $refPayload | Out-Null
Write-Output 'branch master updated'
& { gh api --method DELETE "repos/$Repo/git/refs/tags/$TagName" } 2>&1 | Out-Null
Start-Sleep -Seconds 2
$tagPayload = Join-Path $dir 'tag.json'
Write-Json $tagPayload @{ tag = $TagName; message = [System.IO.File]::ReadAllText($TagMessageFile, $utf8); object = $commitSha; type = 'commit' }
$tagSha = Retry { gh api --method POST "repos/$Repo/git/tags" --input $tagPayload --jq '.sha' 2>&1 } 'tag'
$tagRef = Join-Path $dir 'tagref.json'
Write-Json $tagRef @{ ref = "refs/tags/$TagName"; sha = $tagSha }
gh api --method POST "repos/$Repo/git/refs" --input $tagRef | Out-Null
Write-Output "tag $TagName -> $commitSha"
Remove-Item -Recurse -Force $dir
