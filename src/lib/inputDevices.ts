export interface InputDevice {
  id: string; product: string; name: string; connected: boolean; problem: number;
  portId: string; portLabel: string; portNumber: number | null; location: string;
  routeComplete: boolean; hubs: number | null; hubNames: string[]; controller: string;
  connection: 'CPU' | 'CHIPSET' | 'UNKNOWN'; connectionEvidence: string; speed: string;
  filterActive: boolean; configuredHz: number | null; maxSupportedHz: number | null; canApply: boolean; eligibilityReason: string | null;
  rates: number[]; canTest: boolean; testKinds: Array<'MOUSE' | 'KEYBOARD' | 'JOYSTICK' | 'GAMEPAD'>; advice: string;
}
export interface BundledInputStatus {
  nativeBroker?: { available: boolean; code: string; message: string };
  identity: 'VERIFIED' | 'INVALID_OR_MISSING';
  packaged: boolean;
  selectedFileCount: number;
  commit: string | null;
  credit: string;
  status: 'UNCONFIGURED';
  installEnabled: false;
  reasons: Array<{ code: string; message: string }>;
  rates: Array<{ hz: number; available: false; state: 'UNTESTED'; reason: string }>;
}
export interface InputChange {
  beforeInterval?: number; afterInterval?: number;
  id: string; deviceId: string; name: string; createdAt: string;
  beforeHz: number; afterHz: number; status: 'PENDING' | 'CONFIGURED' | 'RESTORED' | 'NEEDS_REVIEW' | 'NOT_APPLIED';
  purpose: 'POLLING' | 'TIER_ISOLATION';
}
export interface FilteredInputDevice {
  id: string; name: string; speed: string; configuredHz: number | null; isInput: boolean;
  interfaceNames: string[]; wouldExceed1k: boolean; uncertainImpact: boolean;
  canSetSafe1k: boolean; safetyReason: string | null;
  scopeResolved: boolean; filterDirect: boolean; attachmentCount: number; attachmentHash: string;
}
export interface InputTierChange {
  beforeSetting?: string; afterSetting?: string;
  id: string; targetDeviceId: string; targetName: string; createdAt: string;
  beforeTier: number | null; afterTier: number | null;
  status: 'PENDING' | 'NEEDS_REVIEW' | 'SCOPE_DRIFT' | 'REBOOT_REQUIRED' | 'RESTORE_REBOOT_REQUIRED' | 'PRESUMED_ACTIVE' | 'RESTORED' | 'NOT_APPLIED';
  restores: string | null; scopeDrift: string | null;
}
export interface InputInventory {
  legacyRestoreAuthority?: { allowed: boolean; message: string };
  legacyNewWritesAllowed?: boolean; legacyWriteMessage?: string;
  scannedAt: string; devices: InputDevice[]; filteredDevices: FilteredInputDevice[]; elevated: boolean; history: InputChange[]; tierHistory: InputTierChange[]; upstream: string;
  security: { memoryIntegrity: 'Enabled' | 'Configured' | 'Disabled' | 'Unknown' };
  driver: {
    state: string; mode: string; signature: string; hash: string; tier: string;
    patchUsbXhci: number | null; activePatchUsbXhci: number | null; patchSource: string;
    maxHighSpeedHz: number | null; configuredMaxHighSpeedHz: number | null;
    restartState: 'NONE' | 'REBOOT_REQUIRED' | 'VERIFY_AFTER_REBOOT' | 'NEEDS_REVIEW'; tierHistoryId: string | null;
  };
}
export interface InputPreview {
  token: string; deviceId: string; name: string; beforeHz: number; afterHz: number;
  action: 'APPLY' | 'RESTORE' | 'ISOLATE'; expiresAt: string;
}
export interface InputResult {
  status: string; historyId: string; reconnectRequired: boolean; message: string;
}
export interface InputTest {
  capturedAt: string; deviceId: string; method: string; configuredRequestHz: number | null;
  measurement: { unit: 'WINDOWS_RAW_INPUT_MESSAGES'; controlActivity: 'NOT_MEASURED' | 'DECODED_CONTROL_CHANGES' };
  controlActivity?: {
    status: 'UNAVAILABLE' | 'DETECTED' | 'NO_SIGNIFICANT_CHANGE' | 'INCONCLUSIVE';
    coverage: 'NONE' | 'PARTIAL' | 'AVAILABLE'; message: string;
    decoded: number; unsupported: number; errors: number; buttons: number; keys: number; movement: number; axes: number; hats: number;
  };
  deliveryAssessment: {
    status: 'NO_REQUEST' | 'INCONCLUSIVE' | 'CONSISTENT_WITH_REQUEST' | 'BELOW_REQUEST_OBSERVED';
    requestedHz: number | null; observedHz: number | null; message: string;
    channelAssessments?: Array<{ channel: number; kind: string; status: string; observedHz: number | null; message: string }>;
  };
  channels: { channel: number; kind: 'MOUSE' | 'KEYBOARD' | 'JOYSTICK' | 'GAMEPAD' | 'INPUT'; samples: number; activeDurationMs: number; eventHz: number | null; hidReports?: number | null; reportHz?: number | null; motionSpanMs?: number; motionHz?: number | null; medianGapMs: number | null; p95GapMs: number | null }[];
}
export interface InputTierPreview {
  token: string; action: 'ENABLE' | 'RESTORE'; targetDeviceId: string; targetName: string;
  beforeTier: number | null; afterTier: number | null; expiresAt: string;
  affectedDevices: { id: string; name: string; speed: string; configuredHz: number | null; isTarget: boolean }[];
}
export interface InputTierResult {
  status: string; historyId: string; rebootRequired: boolean; message: string;
}
export interface InputDriverLifecycleStatus {
  status: InputDriverLifecycleState;
  installEnabled: boolean;
  capabilities: InputDriverLifecycleCapabilities;
  package: InputDriverLifecyclePackage | null;
  ownership: 'NONE' | 'DIALED' | 'ADOPTED';
  managedDeviceCount: number;
  operationId: string | null;
  lastOutcome: { action: InputDriverLifecycleAction; outcome: 'APPLIED' | 'CANCELLED'; recordedAt: string } | null;
  reasons: Array<{ code: string; message: string }>;
}

export type InputDriverLifecycleState =
  | 'UNAVAILABLE' | 'READY_FOR_PREFLIGHT' | 'EXTERNAL_PACKAGE_PRESENT'
  | 'INSTALL_PREVIEWED' | 'INSTALLING_PACKAGE' | 'PACKAGE_INSTALLED'
  | 'ATTACHING_FILTER' | 'FILTER_ATTACHED' | 'RESTART_REQUIRED' | 'ACTIVE'
  | 'REPAIR_PREVIEWED' | 'REPAIRING_PACKAGE' | 'UPGRADE_PREVIEWED'
  | 'UPGRADING_PACKAGE' | 'DETACH_PREVIEWED' | 'DETACHING_FILTER'
  | 'FILTER_DETACHED' | 'PACKAGE_REMOVAL_PREVIEWED' | 'REMOVING_PACKAGE'
  | 'REMOVED' | 'NOT_APPLIED' | 'NEEDS_REVIEW';

export type InputDriverLifecycleAction = 'INSTALL' | 'ATTACH' | 'ADOPT' | 'REPAIR' | 'UPGRADE' | 'DETACH' | 'REMOVE_PACKAGE';

export interface InputDriverLifecycleCapabilities {
  install: boolean;
  repair: boolean;
  upgrade: boolean;
  detach: boolean;
  removePackage: boolean;
  adopt: boolean;
}

export interface InputDriverLifecyclePackage {
  packageId: string;
  version: string;
  publisher: string;
  attribution: string;
  supportedPollingHz: number[];
  maximumPollingHz: number;
}

export interface InputDriverLifecyclePreview {
  action: InputDriverLifecycleAction;
  token: string;
  expiresAt: string;
  operationId: null;
  requestedHz: number | null;
  requiresElevation: boolean;
  requiresRestart: boolean;
  package: InputDriverLifecyclePackage;
  summary: string[];
}

export interface InputDriverLifecycleResult {
  status: InputDriverLifecycleState;
  action: InputDriverLifecycleAction;
  operationId: string;
  canceled: boolean;
  restartRequired: boolean;
  managedDeviceCount: number;
  package: InputDriverLifecyclePackage;
  summary: string;
}
