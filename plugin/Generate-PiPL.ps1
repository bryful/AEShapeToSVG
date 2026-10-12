param([Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
# Minimal Windows PiPL writer; not a general .r compiler.
# Layout references: SDK Resources/AE_General.r and
# https://docs.rs/pipl/latest/src/pipl/lib.rs.html (Windows byte order/padding).
$data = [System.Collections.Generic.List[byte]]::new()
function UInt32([uint32]$value) { $data.AddRange([BitConverter]::GetBytes($value)) }
function FourCC([string]$text) {
    $bytes = [Text.Encoding]::ASCII.GetBytes($text)
    [Array]::Reverse($bytes)
    $data.AddRange($bytes)
}
function Property([string]$key, [byte[]]$bytes) {
    FourCC '8BIM'
    FourCC $key
    UInt32 0
    UInt32 $bytes.Length
    $data.AddRange($bytes)
}
function PString([string]$text) {
    $bytes = [Text.Encoding]::ASCII.GetBytes($text)
    $result = [byte[]]::new([int]([Math]::Ceiling(($bytes.Length + 1) / 4.0) * 4))
    $result[0] = $bytes.Length
    [Array]::Copy($bytes, 0, $result, 1, $bytes.Length)
    return ,$result
}
$data.AddRange([byte[]](1, 0))
UInt32 0
UInt32 5
Property 'kind' ([Text.Encoding]::ASCII.GetBytes('xgEA'))
Property 'name' (PString 'Shape Contents SDK Probe')
Property 'catg' (PString 'General Plugin')
Property 'vers' ([BitConverter]::GetBytes([uint32]65536))
$entry = [byte[]]::new(16)
[Array]::Copy([Text.Encoding]::ASCII.GetBytes('EntryPointFunc'), $entry, 14)
Property '8664' $entry
$words = for ($i = 0; $i -lt $data.Count; $i += 2) {
    '0x{0:x4}' -f ($data[$i] + 256 * $data[$i + 1])
}
[IO.File]::WriteAllText($OutputPath, "16000 PiPL DISCARDABLE`r`nBEGIN`r`n" + ($words -join ",`r`n") + "`r`nEND`r`n", [Text.Encoding]::ASCII)
