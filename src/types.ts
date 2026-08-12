export type RiskLevel = 'SAFE' | 'MEDIUM' | 'RISKY' | 'DISCARDED' | 'DISCARD_SNAKE_OIL';

export type MaturityLevel =
  | 'LEVEL_0_RESEARCH'
  | 'LEVEL_1_DETECTION'
  | 'LEVEL_2_RECOMMENDATION'
  | 'LEVEL_3_OWNER_EXPERIMENTAL'
  | 'LEVEL_4_VALIDATED'
  | 'LEVEL_5_PUBLIC_PRODUCTION';

export type EvidenceClassification = 'VERIFIED' | 'PROMISING' | 'EXPERIMENTAL' | 'REJECTED';

export type SafetyPreflightDecision =
  | 'SAFE_APPLY'
  | 'WARNING_TEST_ONLY'
  | 'BLOCKED_COMPETITIVE_CONFLICT';

export interface ChangeJournalEntry {
  id: string;
  timestamp: string;
  optimizationId: string;
  title: string;
  category: string;
  previousState: string;
  requestedState: string;
  resultingState: string;
  success: boolean;
  verificationResult: string;
  benchmarkDelta: string;
  rollbackAvailable: boolean;
  maturityLevel: MaturityLevel;
}

export interface CloudHealthLog {
  id: string;
  timestamp: string;
  type: string;
  spaceReclaimedMb: number;
  itemsOptimized: number;
  healthBefore: number;
  healthAfter: number;
  status: string;
}

export type LanguageCode = 'en' | 'es' | 'de' | 'fr' | 'ja' | 'zh';

export type MaintenanceCategory =
  | 'JUNK_CLEAN'
  | 'REGISTRY_INTEGRITY'
  | 'TELEMETRY'
  | 'STARTUP_IMPACT'
  | 'DRIVER_RADAR'
  | 'MEMORY_TURBO';

export interface SystemVitals {
  cpuUsage: number;
  cpuTemp: number;
  ramUsage: number;
  ramUsedGb: number;
  ramTotalGb: number;
  gpuUsage: number;
  gpuTemp: number;
  diskIoMb: number;
  diskFreeGb: number;
  diskTotalGb: number;
  networkLatencyMs: number;
  activeProcessesCount: number;
  ambientTempC: number;
  coolerThermalSaturationPct: number;
  sustainedWattageW: number;
}

export interface OptimizationTweak {
  id: string;
  title: string;
  category: 'System Kernel' | 'Gaming & GPU' | 'Network' | 'Privacy & Services' | 'Storage & SSD' | 'Memory';
  description: string;
  riskLevel: RiskLevel;
  isApplied: boolean;
  expectedBenefit: string;
  technicalDetails: string;
  whyDiscardedOrWarning?: string;
  powershellApply: string;
  powershellRollback: string;
  verifiedBy: 'Windows 11 Hardware Lab' | 'Community Verified' | 'Rigorset Security Audit';
  antiCheatImpact?: 'COMPATIBLE' | 'WARNING_VANGUARD' | 'WARNING_EAC' | 'BLOCKS_ANTICHEAT';
  maturityLevel?: MaturityLevel;
  confidenceScore?: number;
  evidenceQuality?: EvidenceClassification;
}

export interface DriverItem {
  id: string;
  deviceName: string;
  category: 'GPU' | 'Chipset' | 'Network' | 'Audio' | 'Bluetooth';
  vendor: 'NVIDIA' | 'AMD' | 'Intel' | 'Realtek' | 'Qualcomm';
  installedVersion: string;
  latestVersion: string;
  releaseDate: string;
  status: 'UP_TO_DATE' | 'UPDATE_RECOMMENDED' | 'CRITICAL';
  whqlCertified: boolean;
  stabilityRating: number;
  patchNotes: string;
  downloadUrl: string;
}

export interface MaintenanceStep {
  id: MaintenanceCategory;
  nameKey: string;
  descriptionKey: string;
  itemsFound: number;
  spacePotentialMb: number;
  riskLevel: RiskLevel;
  status: 'PENDING' | 'SCANNING' | 'OPTIMIZING' | 'COMPLETED' | 'SKIPPED';
  log: string[];
}

export interface GameProfile {
  id: string;
  title: string;
  genre: string;
  iconName: string;
  installed: boolean;
  installPath?: string;
  detectedLauncher?: 'Steam' | 'Epic Games' | 'Riot Client' | 'Battle.net' | 'Xbox App' | 'EA App' | 'Custom';
  active: boolean;
  gpuPriority: 'High' | 'Realtime' | 'Normal';
  gpuSchedulingEnabled: boolean;
  networkPriorityEnabled: boolean;
  networkQosTag?: string;
  hagsRecommended: boolean;
  shaderCacheMb: number;
  workerThreads: number;
  lowLatencyMode: 'Reflex Boost' | 'Anti-Lag+' | 'Standard';
  customPowerShell: string;
  description: string;
  fpsGainPct: number;
  stutterReductionPct: number;
  executableName?: string;
}

export interface StartupApp {
  id: string;
  name: string;
  publisher: string;
  impact: 'High' | 'Medium' | 'Low';
  enabled: boolean;
  bootDelaySec: number;
  ramUsageMb: number;
  path: string;
}

export interface AntiCheatEngine {
  id: string;
  name: string;
  developer: string;
  protectedGames: string[];
  hvciRequired: boolean;
  testSigningAllowed: boolean;
  activeStatus: 'ACTIVE_GUARD' | 'STANDBY';
  riskAlertsCount: number;
}

export interface UefiVendorProvider {
  vendor: 'ASUS ROG' | 'MSI Dragon' | 'Gigabyte' | 'Lenovo Legion' | 'Generic WMI';
  wmiNamespace: string;
  cStatesConfigurable: boolean;
  pboLimitControl: boolean;
  secureBootStatus: 'ENABLED' | 'DISABLED';
  bitlockerSafetyStatus: 'SAFE' | 'REQUIRES_PAUSE';
}

export interface UserSubscription {
  tier: 'FREE' | 'PREMIUM_CLOUD' | 'OWNER_UNRESTRICTED';
  isProActive: boolean;
  isOwnerMode: boolean;
  expiresAt?: string;
  cloudBackupSync: boolean;
  autoMaintenanceEnabled: boolean;
  aiDiagnosticLimitRemaining: number;
}
