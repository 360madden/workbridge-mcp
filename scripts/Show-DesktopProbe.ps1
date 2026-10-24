#requires -Version 5.1
<#
.SYNOPSIS
  Disposable visible desktop probe for GUI-003 screenshot acceptance.
.DESCRIPTION
  Intended for the existing Workbridge interactive-user helper launcher.
  Creates only a non-sensitive test form and automatically closes it.
  Does not inspect, capture, focus, or inject input into another application.
#>
[CmdletBinding()]
param(
    [ValidateRange(15, 180)][int] $DurationSeconds = 75
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$probeDir = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools/desktop-evidence'
[void] [IO.Directory]::CreateDirectory($probeDir)
$probeLog = Join-Path $probeDir 'gui003-probe-diagnostic.jsonl'
function Add-ProbeRecord([string] $Stage, [string] $Message) {
    $record = [ordered]@{
        utc = [DateTime]::UtcNow.ToString('o')
        stage = $Stage
        message = $Message
        pid = [int] $PID
        sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    }
    [IO.File]::AppendAllText($probeLog, ($record | ConvertTo-Json -Compress) + [Environment]::NewLine)
}
Add-ProbeRecord 'start' ([Environment]::UserInteractive.ToString())
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Workbridge GUI-003 Scheduled Probe'
$form.Size = New-Object System.Drawing.Size(720, 460)
$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
$form.BackColor = [System.Drawing.Color]::FromArgb(23, 33, 56)
$form.ShowInTaskbar = $true

$headline = New-Object System.Windows.Forms.Label
$headline.Text = 'WORKBRIDGE  GUI-003  CAPTURE PROBE'
$headline.ForeColor = [System.Drawing.Color]::White
$headline.Font = New-Object System.Drawing.Font('Segoe UI', 18, [System.Drawing.FontStyle]::Bold)
$headline.AutoSize = $true
$headline.Location = New-Object System.Drawing.Point(42, 74)
$form.Controls.Add($headline)

$details = New-Object System.Windows.Forms.Label
$details.Text = 'Safe desktop test. No game input. Closes automatically.'
$details.ForeColor = [System.Drawing.Color]::LightGreen
$details.AutoSize = $true
$details.Location = New-Object System.Drawing.Point(46, 150)
$form.Controls.Add($details)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = $DurationSeconds * 1000
$timer.Add_Tick({
    $timer.Stop()
    $form.Close()
})
try {
    Add-ProbeRecord 'created' ([string] [long] $form.Handle)
    $form.Add_Shown({ Add-ProbeRecord 'shown' ([string] [long] $form.Handle) })
    $timer.Start()
    [void] $form.ShowDialog()
    Add-ProbeRecord 'dialog-closed' 'normal'
} catch {
    Add-ProbeRecord 'error' $_.Exception.Message
    throw
} finally {
    $timer.Stop()
    $timer.Dispose()
    $form.Dispose()
}
