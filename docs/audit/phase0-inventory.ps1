# CT HUB - Phase 0 inventory (free: no model, no database writes, no branch switching)
# Run from the repo root in PowerShell 5.1:   .\docs\audit\phase0-inventory.ps1
#
# Reads both branches with `git ls-tree` - the working tree is never touched, so it is
# safe to run with uncommitted changes. Greps use `git grep` (tracked files only; rg is
# not on PowerShell's PATH). Never prints a key or a secret: .env files are scanned for
# the Supabase HOST only. Keep this file pure ASCII - PowerShell 5.1 reads a BOM-less
# file as ANSI and a stray em-dash breaks the parser.

$ErrorActionPreference = 'Continue'
$live   = 'main'
$revamp = 'revamp-trial'
$out    = 'docs/audit'

New-Item -ItemType Directory -Force $out | Out-Null

function Save($name, $lines) {
  $path = Join-Path $out $name
  if ($null -eq $lines) { $lines = @() }
  $lines | Out-File -Encoding utf8 $path
  "  $name  ($(@($lines).Count) lines)"
}

Write-Host "Routes (page.tsx AND route.ts - API handlers count too)"
$routesLive   = git ls-tree -r --name-only $live   -- app | Where-Object { $_ -match '/(page\.tsx|route\.ts)$' } | Sort-Object
$routesRevamp = git ls-tree -r --name-only $revamp -- app | Where-Object { $_ -match '/(page\.tsx|route\.ts)$' } | Sort-Object
Save 'routes-live.txt'   $routesLive
Save 'routes-revamp.txt' $routesRevamp
$diff = Compare-Object $routesLive $routesRevamp | ForEach-Object {
  if ($_.SideIndicator -eq '=>') { "NEW-ON-REVAMP   $($_.InputObject)" } else { "MISSING-ON-REVAMP  $($_.InputObject)" }
}
Save 'routes-diff.txt' $diff

Write-Host "Branch shape"
$ahead = git rev-list --left-right --count "$live...$revamp"
Save 'branch-shape.txt' @("main-only  revamp-only commits: $ahead", '', (git log --oneline "$live..$revamp"))
Save 'diffstat.txt' (git diff --stat "$live..$revamp")
Save 'migrations-diff.txt' @('Migrations on revamp not on live (empty = none):', (git diff --name-status "$live..$revamp" -- supabase/migrations))

Write-Host "Supabase target (host only - never the keys)"
$hosts = @()
foreach ($b in @($live, $revamp)) {
  $h = git grep -h -o -E '[a-z]{20}\.supabase\.co' $b -- . ':!node_modules' 2>$null | Sort-Object -Unique
  $hosts += "branch $b : $($h -join ', ')"
}
$local = Get-ChildItem .env* -File -ErrorAction SilentlyContinue | ForEach-Object {
  $m = Select-String -Path $_.FullName -Pattern '[a-z]{20}\.supabase\.co' -AllMatches | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
  "$($_.Name) : $($m -join ', ')"
}
Save 'supabase-target.txt' ($hosts + $local)

# PCRE word boundary: git grep -P understands the two-character sequence backslash-b.
# It is built from a variable below so that no editor or shell ever turns it into a
# literal backspace character (which happened once while writing this file).
$B = [char]92 + 'b'   # backslash + b

Write-Host "Risk greps (git grep, PCRE)"
$src = @('app', 'lib', 'components', 'proxy.ts')
$noT = ':!*.test.*'
Save 'smells.txt'     (git grep -a -n -P ('console\.(log|error)|TODO|FIXME|@ts-ignore|:\s*any' + $B + '|' + $B + 'as any' + $B) -- $src $noT)
Save 'env-and-db.txt' (git grep -a -n -P 'createClient|service_role|process\.env' -- $src)
Save 'numeric.txt'    (git grep -a -n -P 'toFixed|Math\.round|parseFloat|Number\(' -- $src $noT)

Write-Host "Trial-site safety: every place the demo harness and the write block are used"
Save 'demo-mode.txt'  (git grep -a -n -P 'IS_DEMO|DEMO_MODE|READ_ONLY_METHODS' -- $src)

Write-Host "IN4: every query sent to SQL Server, and every non-SELECT keyword in lib/in4 (Fable triages; sb.from() writes are the Supabase mirror, not IN4)"
Save 'in4-queries.txt' (git grep -a -n -P 'in4Query' -- app lib)
Save 'in4-write-keywords.txt' (git grep -a -n -i -P ($B + '(insert|update|delete|merge|exec|truncate|alter)' + $B) -- lib/in4 $noT)

Write-Host "GET handlers that write (the method gate cannot stop these)"
Save 'get-handlers.txt' (git grep -a -l -P 'export (async )?function GET' -- app/api)

Write-Host ''
Write-Host "Done. Now run docs/audit/phase0-readonly.sql in the Supabase SQL editor and save the output as docs/audit/db-inventory.txt"
