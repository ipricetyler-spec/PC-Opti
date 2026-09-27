const path = require('path');

const TEMP_FILE_MAX_AGE_DAYS = 7;

function normalizedWindowsPath(value) {
  const raw = String(value || '').trim();
  return raw ? path.win32.resolve(raw).replace(/[\\/]+$/, '').toLowerCase() : '';
}

function isWithinWindowsRoot(candidatePath, rootPath) {
  const candidate = normalizedWindowsPath(candidatePath);
  const root = normalizedWindowsPath(rootPath);
  return Boolean(candidate && root && candidate !== root && candidate.startsWith(`${root}\\`));
}

function selectEligibleTempCandidates(candidates, roots, now = Date.now()) {
  const cutoff = now - TEMP_FILE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const allowedRoots = (Array.isArray(roots) ? roots : []).map(normalizedWindowsPath).filter(Boolean);
  const selected = [];
  const skipped = { recent: 0, reparsePoint: 0, outOfScope: 0, directory: 0, invalid: 0 };

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const candidatePath = String(candidate?.path || '');
    const lastWrite = Date.parse(candidate?.lastWriteTimeUtc);
    const length = Number(candidate?.length);
    if (!candidatePath || !Number.isFinite(lastWrite) || !Number.isFinite(length) || length < 0) {
      skipped.invalid++;
    } else if (candidate.isReparsePoint) {
      skipped.reparsePoint++;
    } else if (candidate.isDirectory) {
      skipped.directory++;
    } else if (!allowedRoots.some((root) => isWithinWindowsRoot(candidatePath, root))) {
      skipped.outOfScope++;
    } else if (lastWrite >= cutoff) {
      skipped.recent++;
    } else {
      selected.push({ path: path.win32.resolve(candidatePath), length, lastWriteTimeUtc: new Date(lastWrite).toISOString() });
    }
  }

  return { selected, skipped, cutoffUtc: new Date(cutoff).toISOString() };
}

// Fixed, app-owned cache roots. Vendors rebuild these caches on demand; a missing
// vendor folder is normal and is not counted as an unavailable root.
const CACHE_CLEANUP_KINDS = Object.freeze({
  'clear-shader-caches': Object.freeze({
    title: 'Clear graphics shader caches',
    maxAgeDays: 1,
    rootsExpression: "@((Join-Path $env:LOCALAPPDATA 'D3DSCache'), (Join-Path $env:LOCALAPPDATA 'NVIDIA\\DXCache'), (Join-Path $env:LOCALAPPDATA 'NVIDIA\\GLCache'), (Join-Path $env:LOCALAPPDATA 'AMD\\DxCache'), (Join-Path $env:LOCALAPPDATA 'AMD\\GLCache'), (Join-Path $env:LOCALAPPDATA 'AMD\\VkCache'))",
  }),
  'clear-crash-dumps': Object.freeze({
    title: 'Clear old app crash dumps',
    maxAgeDays: 7,
    rootsExpression: "@((Join-Path $env:LOCALAPPDATA 'CrashDumps'))",
  }),
});

// Dialed deletes as administrator inside folders a program running as the user can change,
// so a path checked a moment ago may lead somewhere else by the time it is deleted: a folder
// on the way swapped for a link. Each file is therefore opened once, without following a link
// at the file itself; its real location (every link on the way resolved), age, and number of
// names are read from that open handle, and the delete is set on the same handle. The file
// that was checked is the file that is deleted.
const SAFE_DELETE_SOURCE = String.raw`
using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class DialedSafeDelete {
  [StructLayout(LayoutKind.Sequential)]
  struct FileInformation {
    public uint Attributes;
    public System.Runtime.InteropServices.ComTypes.FILETIME Created, LastAccess, LastWrite;
    public uint VolumeSerial, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
  }
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint length, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInformation info);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetFileInformationByHandle(SafeFileHandle handle, int infoClass, ref uint info, uint size);
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern bool SetFileInformationByHandle(SafeFileHandle handle, int infoClass, ref byte info, uint size);

  const uint DeleteAccess = 0x00010000, ReadAttributes = 0x80, ShareAll = 7, OpenExisting = 3;
  const uint OpenReparsePoint = 0x00200000, BackupSemantics = 0x02000000;

  static string FinalPath(SafeFileHandle handle) {
    StringBuilder buffer = new StringBuilder(1024);
    uint length = GetFinalPathNameByHandleW(handle, buffer, (uint)buffer.Capacity, 0);
    if (length == 0 || length >= buffer.Capacity) return null;
    string value = buffer.ToString();
    if (value.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) return null;
    return value.StartsWith(@"\\?\") ? value.Substring(4) : value;
  }

  // The folder's real path, with every link along it resolved.
  public static string RealFolderPath(string folder) {
    using (SafeFileHandle handle = CreateFileW(folder, ReadAttributes, ShareAll, IntPtr.Zero, OpenExisting, BackupSemantics, IntPtr.Zero)) {
      return handle.IsInvalid ? null : FinalPath(handle);
    }
  }

  // The file's size once deleted, or -1 when it is refused or Windows declines.
  public static long DeleteIfOld(string path, string realRoot, long cutoffFileTimeUtc) {
    using (SafeFileHandle handle = CreateFileW(path, DeleteAccess | ReadAttributes, ShareAll, IntPtr.Zero, OpenExisting, OpenReparsePoint, IntPtr.Zero)) {
      if (handle.IsInvalid) return -1;
      FileInformation info;
      if (!GetFileInformationByHandle(handle, out info)) return -1;
      if ((info.Attributes & 0x410) != 0) return -1; // a folder, or a link
      if (info.Links != 1) return -1; // the same file also has a name elsewhere
      long lastWrite = ((long)(uint)info.LastWrite.dwHighDateTime << 32) | (uint)info.LastWrite.dwLowDateTime;
      if (lastWrite >= cutoffFileTimeUtc) return -1;
      string real = FinalPath(handle);
      if (real == null || !real.StartsWith(realRoot.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)) return -1;
      long size = ((long)info.SizeHigh << 32) | info.SizeLow;
      uint flags = 0x1 | 0x10; // delete, even when read-only
      if (!SetFileInformationByHandle(handle, 21, ref flags, 4)) {
        byte deleteFile = 1;
        if (!SetFileInformationByHandle(handle, 4, ref deleteFile, 1)) return -1;
      }
      return size;
    }
  }
}
`;

function createTempMaintenancePowerShellScript(deleteEligible = false) {
  return createFileCleanupPowerShellScript({
    // The user's own temporary folder only. Windows\Temp is left alone: every account on the
    // PC can write there. Not $env:TEMP, which Dialed points at its admin-only folder.
    rootsExpression: "@((Join-Path $env:LOCALAPPDATA 'Temp'))",
    maxAgeDays: TEMP_FILE_MAX_AGE_DAYS,
    skipMissingRoots: false,
    deleteEligible,
  });
}

function createCacheCleanupPowerShellScript(kind, deleteEligible = false) {
  const definition = CACHE_CLEANUP_KINDS[kind];
  if (!definition) throw new Error('This cache cleanup kind is not recognized.');
  return createFileCleanupPowerShellScript({ rootsExpression: definition.rootsExpression, maxAgeDays: definition.maxAgeDays, skipMissingRoots: true, deleteEligible });
}

function createFileCleanupPowerShellScript({ rootsExpression, maxAgeDays, skipMissingRoots, deleteEligible }) {
  const shouldDelete = deleteEligible ? '$true' : '$false';
  const skipMissing = skipMissingRoots ? '$true' : '$false';
  // Microsoft documents ReparsePoint as a FileSystem attribute and LiteralPath as a
  // non-wildcard target: https://learn.microsoft.com/powershell/module/microsoft.powershell.management/get-childitem
  // https://learn.microsoft.com/powershell/module/microsoft.powershell.management/remove-item
  return `
$deleteEligible = ${shouldDelete}
$skipMissingRoots = ${skipMissing}
if ($deleteEligible) {
  Add-Type -TypeDefinition @'
${SAFE_DELETE_SOURCE}
'@
}
$cutoffUtc = (Get-Date).ToUniversalTime().AddDays(-${Number(maxAgeDays)})
$candidateRoots = ${rootsExpression} | Where-Object { $_ } | Select-Object -Unique
$roots = New-Object System.Collections.Generic.List[string]
[int]$unavailableRootCount = 0
$seenRoots = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($candidateRoot in $candidateRoots) {
  if ($skipMissingRoots -and -not (Test-Path -LiteralPath $candidateRoot)) { continue }
  try {
    $rootItem = Get-Item -LiteralPath $candidateRoot -Force -ErrorAction Stop
    if (($rootItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
    $root = [IO.Path]::GetFullPath($rootItem.FullName).TrimEnd('\\')
    if ($seenRoots.Add($root)) { $roots.Add($root) }
  } catch { $unavailableRootCount++ }
}
[int64]$eligibleBytes = 0
[int]$eligibleCount = 0
[int64]$reclaimedBytes = 0
[int]$deletedFileCount = 0
[int]$skippedFileCount = 0
[int]$recentFileCount = 0
[int]$reparsePointCount = 0
[int]$outOfScopeCount = 0
[int]$enumerationErrorCount = 0
foreach ($root in $roots) {
  $rootPrefix = $root + [IO.Path]::DirectorySeparatorChar
  if ($deleteEligible) {
    # A root whose real location is elsewhere, through a link further up, is not cleaned.
    $realRoot = [DialedSafeDelete]::RealFolderPath($root)
    if (-not $realRoot -or -not [string]::Equals($realRoot.TrimEnd('\\'), $root, [StringComparison]::OrdinalIgnoreCase)) {
      $unavailableRootCount++
      continue
    }
  }
  $pending = [System.Collections.Generic.Stack[string]]::new()
  $pending.Push($root)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    # .NET lists a folder much faster than Get-ChildItem and includes hidden and system
    # items, as -Force did. A folder that cannot be read counts as an enumeration error.
    try { $children = @(([IO.DirectoryInfo]::new($directory)).GetFileSystemInfos()) }
    catch { $enumerationErrorCount++; $children = @() }
    foreach ($item in $children) {
      try {
        $fullName = [IO.Path]::GetFullPath($item.FullName)
        if (-not $fullName.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
          $outOfScopeCount++
          continue
        }
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
          $reparsePointCount++
          continue
        }
        if ($item -is [IO.DirectoryInfo]) {
          $pending.Push($fullName)
          continue
        }
        if ($item.LastWriteTimeUtc -ge $cutoffUtc) {
          $recentFileCount++
          continue
        }
        $eligibleCount++
        $eligibleBytes += [int64]$item.Length
        if ($deleteEligible) {
          $length = [DialedSafeDelete]::DeleteIfOld($fullName, $realRoot, $cutoffUtc.ToFileTimeUtc())
          if ($length -lt 0) { $skippedFileCount++; continue }
          $reclaimedBytes += $length
          $deletedFileCount++
        }
      } catch {
        $skippedFileCount++
      }
    }
  }
}
[pscustomobject]@{
  paths = @($roots)
  cutoffUtc = $cutoffUtc.ToString('o')
  totalSizeBytes = $eligibleBytes
  pathCount = $eligibleCount
  deletedFileCount = $deletedFileCount
  reclaimedBytes = $reclaimedBytes
  skippedFileCount = $skippedFileCount
  recentFileCount = $recentFileCount
  reparsePointCount = $reparsePointCount
  outOfScopeCount = $outOfScopeCount
  unavailableRootCount = $unavailableRootCount
  enumerationErrorCount = $enumerationErrorCount
  inventoryComplete = ($unavailableRootCount -eq 0 -and $enumerationErrorCount -eq 0)
} | ConvertTo-Json -Compress
`;
}

module.exports = {
  SAFE_DELETE_SOURCE,
  CACHE_CLEANUP_KINDS,
  TEMP_FILE_MAX_AGE_DAYS,
  createCacheCleanupPowerShellScript,
  createTempMaintenancePowerShellScript,
  isWithinWindowsRoot,
  selectEligibleTempCandidates,
};
