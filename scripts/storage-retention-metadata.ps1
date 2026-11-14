# Fixed, read-only metadata worker. Paths arrive as JSON strings on stdin.
$ErrorActionPreference = 'Stop'
while ($null -ne ($line = [Console]::In.ReadLine())) {
    try {
        $request = ConvertFrom-Json -InputObject $line
        if ($request -isnot [string] -or $request.Length -gt 32767) { throw 'invalid request' }
        $item = Get-Item -Force -LiteralPath $request
        $reparse = [bool]($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint)
        [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ reparse = $reparse }))
    } catch {
        [Console]::Out.WriteLine('{"error":"METADATA_UNAVAILABLE"}')
    }
}
