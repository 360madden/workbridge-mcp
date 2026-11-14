#requires -Version 5.1
$ErrorActionPreference='Stop'
$source=[IO.File]::ReadAllText((Join-Path $PSScriptRoot '..\scripts\Storage-RetentionMaintenance.ps1'))
$match=[regex]::Match($source,"(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")
if(-not $match.Success){throw 'Native type definition missing'}
Add-Type -TypeDefinition $match.Groups[1].Value
$leaseType=[RetentionMaintenanceNative].GetNestedType('Lease')
$method=$leaseType.GetMethod('SafeInventoryName',[Reflection.BindingFlags]'Static,NonPublic')
if($null -eq $method){throw 'Inventory name validator missing'}
foreach($prefix in @('COM','LPT')){
  foreach($number in @(1,2,3,9)){
    $name=$prefix+$number
    if($method.Invoke($null,@($name))){throw "Reserved device accepted: $name"}
  }
  foreach($codepoint in @(0x00B9,0x00B2,0x00B3)){
    $name=$prefix+[char]$codepoint+'.txt'
    if($method.Invoke($null,@($name))){throw 'Superscript device accepted'}
  }
}
foreach($name in @('COM10','LPT10',('COM'+[char]0x00C2),'ordinary.txt')){
  if(-not $method.Invoke($null,@($name))){throw 'Ordinary filename incorrectly rejected'}
}
Write-Output 'PASS native inventory device names and Unicode without encoding-dependent literals'
