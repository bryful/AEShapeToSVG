param([string]$PluginPath = "$PSScriptRoot/bin/x64/Release/ShapeProbe.aex")
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ProbeResource {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr LoadLibraryEx(string p, IntPtr f, uint flags);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindResource(IntPtr m, IntPtr name, string type);
 [DllImport("kernel32.dll")] public static extern uint SizeofResource(IntPtr m, IntPtr r);
 [DllImport("kernel32.dll")] public static extern IntPtr LoadResource(IntPtr m, IntPtr r);
 [DllImport("kernel32.dll")] public static extern IntPtr LockResource(IntPtr r);
 [DllImport("kernel32.dll")] public static extern bool FreeLibrary(IntPtr m);
}
'@
# LOAD_LIBRARY_AS_DATAFILE: never execute plugin initialization outside AE.
$module = [ProbeResource]::LoadLibraryEx([IO.Path]::GetFullPath($PluginPath), [IntPtr]::Zero, 2)
if ($module -eq [IntPtr]::Zero) { throw 'Cannot load plugin resources' }
try {
    $resource = [ProbeResource]::FindResource($module, [IntPtr]16000, 'PiPL')
    if ($resource -eq [IntPtr]::Zero) { throw 'PiPL resource missing' }
    $size = [ProbeResource]::SizeofResource($module, $resource)
    $bytes = [byte[]]::new($size)
    $ptr = [ProbeResource]::LockResource([ProbeResource]::LoadResource($module, $resource))
    [Runtime.InteropServices.Marshal]::Copy($ptr, $bytes, 0, $size)
    if ($bytes[0] -ne 1 -or [BitConverter]::ToUInt32($bytes, 2) -ne 0 -or [BitConverter]::ToUInt32($bytes, 6) -ne 5) { throw 'Invalid PiPL header' }
    $offset = 10
    $keys = @()
    for ($i = 0; $i -lt 5; $i++) {
        if ([Text.Encoding]::ASCII.GetString($bytes, $offset, 4) -ne 'MIB8') { throw 'Invalid property vendor' }
        $key = [Text.Encoding]::ASCII.GetString($bytes, $offset + 4, 4)
        $length = [BitConverter]::ToUInt32($bytes, $offset + 12)
        $offset += 16
        $keys += $key
        if ($key -eq 'dnik' -and [Text.Encoding]::ASCII.GetString($bytes, $offset, $length) -ne 'xgEA') { throw 'Invalid AEGP kind' }
        if ($key -eq '4668' -and [Text.Encoding]::ASCII.GetString($bytes, $offset, $length).Trim([char]0) -ne 'EntryPointFunc') { throw 'Invalid entry point' }
        $offset += $length
    }
    if ($offset -ne $size -or ($keys -join ',') -ne 'dnik,eman,gtac,srev,4668') { throw 'Invalid PiPL layout' }
    Write-Output 'Embedded PiPL resource verified (5 properties, AEGP, x64 entry point)'
} finally { [void][ProbeResource]::FreeLibrary($module) }
