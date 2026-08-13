export interface SystemScanSnapshot {
  schemaVersion: '1.0.0';
  timestamp: string;
  deviceHash: string;
  metrics: {
    os: { caption: string; version: string; build: string; architecture: string };
    cpu: { name: string; cores: number; logicalProcessors: number; maxClockSpeedMhz: number };
    memory: { totalBytes: number; freeBytes: number; loadPercentage: number };
    storage: Array<{
      driveLetter: string;
      label: string;
      totalBytes: number;
      freeBytes: number;
      isSSD: boolean;
      trimEnabled: boolean;
    }>;
    startupItems: Array<{ name: string; path: string; source: 'Registry' | 'TaskScheduler'; enabled: boolean }>;
    tempFiles: { totalSizeBytes: number; pathCount: number };
  };
  metadata: {
    executionTimeMs: number;
    elevated: boolean;
    errors: Array<{ component: string; message: string }>;
  };
}

export interface AuditJournalEntry {
  id: string;
  timestamp: string;
  actionId: string;
  title: string;
  category: string;
  preAction: unknown;
  resultingState: unknown;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  rollback: { available: boolean; reason: string; kind?: 'restore-registry-run-value'; completedAt?: string };
}

export interface GroundedAiAudit {
  facts: string[];
  inferences: string[];
  recommendations: Array<{
    title: string;
    rationale: string;
    action: 'REVIEW' | 'OPTIONAL_MAINTENANCE' | 'NO_ACTION';
  }>;
  limitations: string[];
}

export interface MaintenanceAction {
  id: string;
  title: string;
  description: string;
  evidence: string;
  reversible: boolean;
  kind: 'clear-temp-files' | 'retrim-drive';
}

export interface StartupManagementItem {
  id: string;
  name: string;
  path: string;
  source: 'Registry' | 'TaskScheduler';
  enabled: boolean;
  scope: string;
  canDisable: boolean;
  managementNote: string;
}

export interface ManageableProcess {
  pid: number;
  name: string;
  cpuPercent: number;
  workingSetBytes: number;
  efficiencyMode: boolean;
}

export interface SafeOsPolicy {
  id: 'disable-windows-consumer-features';
  title: string;
  description: string;
  risk: 'Safe';
  enabled: boolean;
  keyExists: boolean;
  valueExists: boolean;
  value: number | null;
  valueKind: string | null;
}
