# deploy-doop.ps1 — sekali jalan di RDP Windows VPS (23.137.105.146)
# Jalankan:  powershell -ExecutionPolicy Bypass -File deploy-doop.ps1
#
# Yang dilakukan:
#   1. cek/install Node + Bun
#   2. download source (branch custom-endpoint) ke C:\doop
#   3. bun install + bun run build
#   4. tulis .env (custom endpoint 9Router + auth secret)
#   5. buat Scheduled Task autostart (loop restart) + start sekarang
#   6. cek http://localhost:4400 hidup
#
# Setelah selesai, tambahkan public hostname di Cloudflare Tunnel:
#   doop.mafiablox.com  ->  http://localhost:4400
# (Cloudflare Zero Trust -> Networks -> Tunnels -> pilih tunnel
#  -> Public Hostname -> Add public hostname)

$ErrorActionPreference = 'Stop'
$Root    = 'C:\doop'
$Branch  = 'custom-endpoint'
$RepoZip = "https://github.com/Arkanuy/doop-custom/archive/refs/heads/$Branch.zip"
$Port    = 4400

Write-Host '=== 1/6 Node & Bun ===' -ForegroundColor Cyan
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host 'Node belum ada — install via winget (butuh winget / bisa juga download dari nodejs.org)…'
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
Write-Host ("node " + (node --version))
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host 'Install bun…'
    irm bun.sh/install.ps1 | iex
    $env:Path = "$env:USERPROFILE\.bun\bin;" + $env:Path
}
Write-Host ("bun " + (bun --version))

Write-Host '=== 2/6 Download source ===' -ForegroundColor Cyan
$zip = Join-Path $env:TEMP 'doop-src.zip'
Invoke-WebRequest -Uri $RepoZip -OutFile $zip
$tmp = Join-Path $env:TEMP 'doop-src'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive -Path $zip -DestinationPath $tmp
$src = Get-ChildItem $tmp -Directory | Select-Object -First 1
if (Test-Path $Root) {
    # jaga data & .env yang sudah ada
    if (Test-Path "$Root\.env")   { Copy-Item "$Root\.env"   "$env:TEMP\doop.env.keep" -Force }
    if (Test-Path "$Root\data")   { Copy-Item "$Root\data"   "$env:TEMP\doop.data.keep" -Recurse -Force }
    Remove-Item $Root -Recurse -Force
}
Move-Item $src.FullName $Root
if (Test-Path "$env:TEMP\doop.env.keep") { New-Item -ItemType Directory -Path $Root -Force | Out-Null; Copy-Item "$env:TEMP\doop.env.keep" "$Root\.env" -Force; Remove-Item "$env:TEMP\doop.env.keep" }
if (Test-Path "$env:TEMP\doop.data.keep") { Copy-Item "$env:TEMP\doop.data.keep" "$Root\data" -Recurse -Force; Remove-Item "$env:TEMP\doop.data.keep" -Recurse -Force }

Write-Host '=== 3/6 Install + build ===' -ForegroundColor Cyan
Set-Location $Root
bun install
bun run build

Write-Host '=== 4/6 Konfigurasi .env ===' -ForegroundColor Cyan
$envPath = Join-Path $Root '.env'
$existing = @{}
if (Test-Path $envPath) {
    Get-Content $envPath | ForEach-Object {
        if ($_ -match '^([^#=]+)=(.*)$') { $existing[$matches[1].Trim()] = $matches[2] }
    }
    Write-Host '  .env lama ditemukan — nilai yang sudah ada tidak ditimpa.'
}
function Set-EnvVal([string]$k, [string]$v) {
    $script:envMap[$k] = $v
}
$script:envMap = @{}
# 1) API key 9Router — paste dari chat, TANPA default (jangan commit secret)
if ($existing['DOOP_CUSTOM_CHAT_KEY']) {
    $key = $existing['DOOP_CUSTOM_CHAT_KEY']
    Write-Host '  DOOP_CUSTOM_CHAT_KEY: pakai nilai yang sudah ada.'
} else {
    $key = Read-Host '  API key 9Router (sk-61ea… — paste dari chat Arkan)'
    if (-not $key) { Write-Host '  ERROR: key wajib diisi.' -ForegroundColor Red; exit 1 }
}
# 2) endpoint: default ke gateway remote yang sudah terbukti
$urlDefault = 'http://43.133.33.248:20128/v1/chat/completions'
if ($existing['DOOP_CUSTOM_CHAT_URL']) { $urlDefault = $existing['DOOP_CUSTOM_CHAT_URL'] }
$url = Read-Host "  Endpoint URL [Enter = $urlDefault]"
if (-not $url) { $url = $urlDefault }
# 3) auth URL publik (untuk OAuth redirect; ganti kalau subdomain beda)
$authDefault = 'https://doop.mafiablox.com'
if ($existing['BETTER_AUTH_URL']) { $authDefault = $existing['BETTER_AUTH_URL'] }
$authUrl = Read-Host "  BETTER_AUTH_URL publik [Enter = $authDefault]"
if (-not $authUrl) { $authUrl = $authDefault }
# 4) secret acak (sekali generate, disimpan)
if ($existing['BETTER_AUTH_SECRET']) { $secret = $existing['BETTER_AUTH_SECRET'] }
else { $secret = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) }) }

# Chrome/Edge untuk screenshot agent
$chrome = ''
if (Test-Path 'C:\Program Files\Google\Chrome\Application\chrome.exe')      { $chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe' }
elseif (Test-Path 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe') { $chrome = 'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe' }
elseif (Test-Path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') { $chrome = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' }

$lines = @(
    "NODE_ENV=production",
    "PORT=$Port",
    "BETTER_AUTH_SECRET=$secret",
    "BETTER_AUTH_URL=$authUrl",
    "DOOP_AGENT_PROVIDER=custom",
    "DOOP_CUSTOM_CHAT_URL=$url",
    "DOOP_CUSTOM_CHAT_MODEL=nln/deepseek-v4.1-flash",
    "DOOP_CUSTOM_CHAT_LABEL=9Router",
    "DOOP_CUSTOM_CHAT_VISION=true",
    "DOOP_CUSTOM_CHAT_KEY=$key"
)
if ($chrome) { $lines += "CHROME_PATH=$chrome" }
# pertahankan entri .env lain yang sudah ada
foreach ($k in $existing.Keys) {
    $already = $false
    foreach ($l in $lines) { if ($l -like "$k=*") { $already = $true; break } }
    if (-not $already) { $lines += "$k=$($existing[$k])" }
}
Set-Content -Path $envPath -Value $lines -Encoding UTF8
Write-Host "  .env ditulis ($($lines.Count) baris)."

Write-Host '=== 5/6 Scheduled task (autostart + auto-restart) ===' -ForegroundColor Cyan
$startScript = Join-Path $Root 'start-doop.ps1'
@'
$ErrorActionPreference = 'SilentlyContinue'
Set-Location C:\doop
New-Item -ItemType Directory -Force -Path C:\doop\logs | Out-Null
while ($true) {
    $env:NODE_ENV = 'production'
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    Add-Content C:\doop\logs\server.log "[$stamp] starting doop…"
    npx tsx server/index.ts 2>&1 | Add-Content C:\doop\logs\server.log
    Add-Content C:\doop\logs\server.log "[$stamp] exited — restart in 5s"
    Start-Sleep 5
}
'@ | Set-Content -Path $startScript -Encoding UTF8

$taskName = 'DoopCanvas'
$existingTask = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existingTask) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$startScript`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType Interactive -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
Write-Host "  Task '$taskName' terdaftar (start saat boot)."
# jalankan sekarang juga
Start-ScheduledTask -TaskName $taskName

Write-Host '=== 6/6 Verifikasi ===' -ForegroundColor Cyan
$ok = $false
foreach ($i in 1..24) {
    Start-Sleep 5
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
}
if ($ok) {
    Write-Host "  OK — Doop hidup di http://localhost:$Port" -ForegroundColor Green
    Write-Host ''
    Write-Host 'SISA LANGKAH (bisa dari browser HP):' -ForegroundColor Yellow
    Write-Host '  1. Cloudflare Zero Trust -> Networks -> Tunnels -> tunnel aktif'
    Write-Host '     -> Public Hostname -> Add:  doop.mafiablox.com  ->  http://localhost:4400'
    Write-Host '  2. Buka https://doop.mafiablox.com — daftar akun (1 akun saja!)'
    Write-Host '  3. Settings -> Agent keys -> New key — kirim token barunya ke Arkan'
    Write-Host '     (token itu dipakai Hermes MCP dari laptop)'
    Write-Host "  4. Log: Get-Content C:\doop\logs\server.log -Tail 50"
} else {
    Write-Host '  GAGAL — cek Get-Content C:\doop\logs\server.log -Tail 60' -ForegroundColor Red
}
