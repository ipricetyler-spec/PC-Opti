import type { AuditJournalEntry, GroundedAiAudit, ManageableProcess, SafeOsPolicy, StartupManagementItem, SystemScanSnapshot } from './types';

declare global {
  interface Window {
    pcOptiNative?: {
      scanSystem: () => Promise<SystemScanSnapshot>;
      runAiAudit: () => Promise<GroundedAiAudit>;
      listStartupItems: () => Promise<{ items: StartupManagementItem[]; errors: Array<{ component: string; message: string }> }>;
      disableStartupItem: (itemId: string) => Promise<{ success: boolean; entry: AuditJournalEntry; result?: unknown; error?: string }>;
      listManageableProcesses: () => Promise<{ items: ManageableProcess[]; errors: Array<{ component: string; message: string }> }>;
      enableProcessEcoQos: (processId: number) => Promise<{ success: boolean; entry: AuditJournalEntry; result?: unknown; error?: string }>;
      listSafePolicies: () => Promise<{ items: SafeOsPolicy[]; errors: Array<{ component: string; message: string }> }>;
      enableConsumerFeaturesPolicy: () => Promise<{ success: boolean; entry: AuditJournalEntry; result?: unknown; error?: string }>;
      executeMaintenance: (actionId: string) => Promise<{
        success: boolean;
        entry: AuditJournalEntry;
        result?: unknown;
        error?: string;
      }>;
      getAuditHistory: () => Promise<AuditJournalEntry[]>;
      rollbackAuditEntry: (entryId: string) => Promise<{ success: boolean; entry: AuditJournalEntry; result?: unknown; error?: string }>;
    };
  }
}

export {};
