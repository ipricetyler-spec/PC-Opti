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

function createTempMaintenancePowerShellScript(deleteEligible = false) {
  return createFileCleanupPowerShellScript({
    rootsExpression: "@($env:TEMP, (Join-Path $env:WINDIR 'Temp'))",
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
  $pending = [System.Collections.Generic.Stack[string]]::new()
  $pending.Push($root)
  while ($pending.Count -gt 0) {
    $directory = $pending.Pop()
    $directoryErrors = @()
    $children = @(Get-ChildItem -LiteralPath $directory -Force -ErrorAction SilentlyContinue -ErrorVariable directoryErrors)
    $enumerationErrorCount += $directoryErrors.Count
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
        if ($item.PSIsContainer) {
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
          try {
            $current = Get-Item -LiteralPath $fullName -Force -ErrorAction Stop
            $currentFullName = [IO.Path]::GetFullPath($current.FullName)
            if ($current.PSIsContainer -or
                ($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
                -not $currentFullName.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) -or
                $current.LastWriteTimeUtc -ge $cutoffUtc) {
              $skippedFileCount++
              continue
            }
            $length = [int64]$current.Length
            Remove-Item -LiteralPath $currentFullName -Force -ErrorAction Stop
            $reclaimedBytes += $length
            $deletedFileCount++
          } catch {
            $skippedFileCount++
          }
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
  CACHE_CLEANUP_KINDS,
  TEMP_FILE_MAX_AGE_DAYS,
  createCacheCleanupPowerShellScript,
  createTempMaintenancePowerShellScript,
  isWithinWindowsRoot,
  selectEligibleTempCandidates,
};
