export type EvidenceStatus = 'AVAILABLE' | 'UNKNOWN' | 'UNSUPPORTED' | 'PERMISSION_REQUIRED';

export type DiagnosticEvidence<T> =
  | { status: 'AVAILABLE'; value: T; source: string }
  | { status: Exclude<EvidenceStatus, 'AVAILABLE'>; reason: string; source: string };

export interface AntiCheatDetection {
  product: string;
  serviceName: string;
  state: string;
  driverPresent: boolean;
}

export interface SystemScanSnapshot {
  schemaVersion: '1.3.0';
  timestamp: string;
  deviceHash: string;
  metrics: {
    os: { caption: string; version: string; build: string; architecture: string };
    cpu: DiagnosticEvidence<{ name: string; cores: number; logicalProcessors: number; maxClockSpeedMhz: number }>;
    memory: DiagnosticEvidence<{ totalBytes: number; freeBytes: number; loadPercentage: number }>;
    storage: DiagnosticEvidence<Array<{
      driveLetter: string;
      label: string;
      totalBytes: number;
      freeBytes: number;
      isSSD: boolean;
      trimEnabled: boolean;
    }>>;
    startupItems: Array<{ name: string; path: string; source: 'Registry' | 'TaskScheduler'; enabled: boolean }>;
    tempFiles: { totalSizeBytes: number; pathCount: number };
  };
  diagnostics: {
    graphics: DiagnosticEvidence<Array<{ name: string; driverVersion: string; status: string; adapterCompatibility: string }>>;
    motherboard: DiagnosticEvidence<{ manufacturer: string; product: string }>;
    powerScheme: DiagnosticEvidence<{ guid: string; name: string }>;
    hardwareGpuScheduling: DiagnosticEvidence<{ state: 'Enabled' | 'Disabled' | 'System default' | 'Unknown value'; configuredValue: number | null }>;
    gameDvr: DiagnosticEvidence<{ state: 'Enabled' | 'Disabled' | 'Mixed' | 'System default'; appCaptureEnabled: boolean | null; gameDvrEnabled: boolean | null }>;
    pageFile: DiagnosticEvidence<{
      mode: 'Automatic' | 'Custom' | 'Disabled' | 'Unknown';
      automaticManaged: boolean;
      settings: Array<{ name: string; initialSizeMb: number; maximumSizeMb: number }>;
      usage: Array<{ name: string; allocatedBaseSizeMb: number; currentUsageMb: number; peakUsageMb: number }>;
    }>;
    storageHealth: DiagnosticEvidence<Array<{
      friendlyName: string;
      mediaType: string;
      healthStatus: string;
      operationalStatus: string;
      sizeBytes: number;
    }>>;
    networkAdapters: DiagnosticEvidence<Array<{ name: string; interfaceDescription: string; status: string; linkSpeed: string }>>;
    secureBoot: DiagnosticEvidence<{ state: 'Enabled' | 'Disabled' }>;
    tpm: DiagnosticEvidence<{ present: boolean; ready: boolean; enabled: boolean; activated: boolean; manufacturerVersion: string }>;
    virtualization: DiagnosticEvidence<{
      hypervisorPresent: boolean;
      firmwareVirtualizationEnabled: boolean | null;
      secondLevelAddressTranslation: boolean | null;
    }>;
    antiCheat: DiagnosticEvidence<AntiCheatDetection[]>;
  };
  metadata: {
    executionTimeMs: number;
    elevated: boolean;
    errors: Array<{ component: string; message: string }>;
    migratedFromSchemaVersion?: '1.0.0' | '1.1.0' | '1.2.0';
  };
}

export interface BiosGuidancePlan {
  schemaVersion: '1.0.0';
  catalogVersion: string;
  reviewedAt: string;
  reviewAfter: string;
  generatedAt: string | null;
  fingerprint: string;
  status: 'GUIDANCE_AVAILABLE' | 'NO_REVIEWED_MATCH';
  reviewStatus: 'CURRENT' | 'REVIEW_DUE' | 'CLOCK_UNCERTAIN';
  hardware: {
    cpu: { name: string; manufacturer: string; socket: string; count: number };
    board: { manufacturer: string; product: string; revision: string };
    bios: { manufacturer: string; version: string; date: string };
    system: { manufacturer: string; model: string; pcSystemType: number | null };
    chassis: number[];
    memory: Array<{ manufacturer: string; partNumber: string; slot: string; capacityBytes: number | null; configuredSpeed: number | null; ratedSpeed?: number | null; memoryType: number | null }>;
    /** Read-only facts from NVIDIA's own tool, when present. */
    nvidia?: { memoryMiB: number | null; bar1MiB: number | null; genCurrent: number | null; genMax: number | null; widthCurrent: number | null; widthMax: number | null } | null;
    gpus: string[];
    errors: string[];
  };
  match: { vendor: string | null; platform: string | null; supported: boolean; reason: string; boardName: string | null; supportUrl: string | null; supportMatch: 'MODEL' | 'VENDOR' | null };
  preparation: string[];
  preparationSources: Array<{ title: string; url: string; reviewedAt: string }>;
  warnings: string[];
  limitations: string;
  recommendations: Array<{
    id: string; title: string; risk: string; advanced: boolean; status: 'CHECK_COMPATIBILITY'; currentState: string;
    /** What Windows reports that relates to this setting. Never proof of the BIOS setting. */
    observed?: string | null;
    matchReason: string; target: string; benefit: string; tradeoff: string; checks: string[]; steps: string[];
    verify: string; undo: string; menuHint: string; sources: Array<{ title: string; url: string; reviewedAt: string }>;
  }>;
}

export interface InstalledApplicationInventory {
  scannedAt: string;
  limitations: string;
  items: Array<{
    displayName: string;
    publisher: string;
    installLocation: string;
    displayVersion: string;
    estimatedSizeBytes: number | null;
  }>;
}

export interface OptionalAppCandidate {
  id: string;
  title: string;
  consequence: string;
  name: string;
  packageFullName: string;
  packageFamilyName: string;
  version: string;
  publisher: string;
  architecture: string;
  signatureKind: string;
  scope: 'CURRENT_USER';
  recovery: string;
  fingerprint: string;
}

export interface OptionalAppInventory {
  scannedAt: string;
  items: OptionalAppCandidate[];
  limitations: string;
}

export interface OptionalAppRemovalPreview extends OptionalAppCandidate {
  token: string;
  previewedAt: string;
  changes: string[];
  exclusions: string[];
}

export interface ReleaseStatus {
  version: string;
  packaged: boolean;
  executableName: string;
  updateMode: 'VERIFIED_USER_INITIATED';
  updateCheckAvailable: boolean;
  update: {
    status: 'UNCONFIGURED' | 'INVALID_CONFIGURATION' | 'READY';
    configured: boolean;
    channel: string;
    feedHost: string;
    missingFields: string[];
    errors: string[];
    backgroundUpdates: false;
  };
  signature: {
    status: string;
    statusMessage: string;
    signerSubject: string;
    signerThumbprint: string;
    timestampSubject: string;
  };
}

export interface UpdateCheckResult {
  checkedAt: string;
  currentVersion: string;
  status: 'UPDATE_AVAILABLE' | 'UP_TO_DATE' | 'FEED_OLDER_THAN_INSTALLED';
  release: null | {
    version: string;
    publishedAt: string;
    notesUrl: string;
    fileName: string;
    sizeBytes: number;
    sha256: string;
    signerSubject: string;
  };
  downloadToken: string | null;
  expiresAt: string | null;
}

export interface UpdateDownloadResult {
  status: 'READY_TO_INSTALL';
  version: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  signature: {
    status: 'VALID';
    signerSubject: string;
    signerThumbprint: string;
    timestampSubject: string;
  };
  installToken: string;
  expiresAt: string;
}

export interface LocalRecommendation {
  id: string;
  title: string;
  category: string;
  observation: string;
  rationale: string;
  evidence: { paths: string[]; summary: string };
  expectedBenefit: string;
  risk: 'Low' | 'Medium' | 'High';
  confidence: 'Low' | 'Medium' | 'High';
  applicability: 'APPLICABLE' | 'NOT_APPLICABLE' | 'UNAVAILABLE';
  actionStatus: 'OPTIONAL_ACTION' | 'GUIDANCE_ONLY' | 'REVIEW' | 'NO_ACTION';
  actionId: string | null;
  capabilityId: string;
  targetPanel: {
    id: 'overview' | 'startup' | 'balancer' | 'maintenance' | 'readiness' | 'workload-profiles' | 'plan-composer' | 'performance-lab' | 'network-quality' | 'clean-room-parity' | 'drift' | 'game-settings' | 'benchmarks' | 'history';
    label: string;
    sectionId: string | null;
    evidenceId?: string;
  };
  rollback: { method: string; limitations: string };
  verification: string;
}

export interface ConsumerLicenseState {
  tier: 'free' | 'premium';
  mode: 'free' | 'trial' | 'activated';
  expiresAt: string | null;
  source: 'local-trial' | 'activation-code' | 'manual' | 'unknown';
  updatedAt: string;
}

export interface DriftChange {
  path: string;
  label: string;
  kind: 'ADDED' | 'REMOVED' | 'CHANGED';
  before: unknown | null;
  after: unknown | null;
}

export interface DriftReport {
  baseline: { createdAt: string; snapshotTimestamp: string } | null;
  currentSnapshotTimestamp: string;
  changes: DriftChange[];
}

export interface BenchmarkRecord {
  sampleUnit?: 'FRAME' | 'TRIAL' | 'UNKNOWN';
  trialIds?: string[];
  id: string;
  experimentId: string;
  phase: 'BASELINE' | 'CANDIDATE';
  workload: string;
  tool: string;
  toolVersion: string;
  metric: string;
  unit: string;
  direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
  variant: string;
  changeDescription: string;
  capturedAt: string;
  samples: number[];
  conditions: Record<string, string>;
  notes: string;
  linkedAuditEntryId: string | null;
  importedAt: string;
}

export interface BenchmarkStatistics {
  count: number;
  mean: number;
  median: number;
  minimum: number;
  maximum: number;
  standardDeviation: number;
  coefficientOfVariationPercent: number | null;
}

export interface BenchmarkComparison {
  sampleUnit?: 'FRAME' | 'TRIAL' | 'UNKNOWN';
  decisionRule?: string;
  experimentId: string;
  classification: 'INCOMPLETE' | 'INCOMPARABLE' | 'HIGH_VARIANCE' | 'INCONCLUSIVE' | 'REGRESSION' | 'MEASURED_DIFFERENCE';
  reason: string;
  scopeWarning?: string;
  baseline: BenchmarkRecord | null;
  candidate: BenchmarkRecord | null;
  baselineStats?: BenchmarkStatistics;
  candidateStats?: BenchmarkStatistics;
  rawDeltaPercent?: number;
  favorableDeltaPercent?: number;
  variabilityPercent?: number;
  conditionMismatches?: string[];
  rollbackGuidance?: { available: boolean; auditEntryId: string | null; capabilityId: string | null; reason: string } | null;
}

export interface BenchmarkEvidenceState {
  records: BenchmarkRecord[];
  comparisons: BenchmarkComparison[];
}

export interface TimingExperiment {
  id: string;
  title: string;
  kind: 'BOOT_CONFIGURATION' | 'RESEARCH_ONLY';
  hypothesis: string;
  framing: string;
  currentState: string;
  availability: 'APPLICABLE' | 'ALREADY_DEFAULT' | 'ALREADY_CONFIGURED' | 'RESEARCH_ONLY' | 'UNAVAILABLE';
  actionId: 'timing:restore-automatic-clock-source' | 'timing:disable-dynamic-tick' | null;
  /** Present when an explicit value exists that can be returned to the Windows default. */
  restoreDefaultActionId?: 'timing:restore-default-dynamic-tick' | null;
  actionLabel: string;
  risk: 'Medium' | 'Research';
  requiresElevation: boolean;
  requiresReboot: boolean;
  rollback: string;
  limitations: string;
  ongoingTesting: string;
  sources: string[];
  unavailableReason: string | null;
}

export interface GameSettingRecommendation {
  id: string;
  label: string;
  recommendation: string;
  rationale: string;
  tradeoff: string;
  verification: string;
}

export interface GameSettingsGuide {
  id: string;
  game: string;
  platform: string;
  status: 'VERIFIED_GUIDANCE';
  lastReviewed: string;
  objective: string;
  applicability: string;
  automation: 'GUIDANCE_ONLY';
  ongoingTesting: string;
  settings: GameSettingRecommendation[];
  sources: Array<{ title: string; url: string }>;
}

export interface InstalledGameDiscovery {
  scannedAt: string;
  limitations: string;
  games: Array<{
    guideId: string;
    game: string;
    detectedDisplayName: string;
    publisher: string;
    evidence: 'REGISTERED_APPLICATION';
    installLocation: string;
    configHints: Array<{
      path: string;
      state: 'EXISTING_FILE' | 'EXISTING_DIRECTORY' | 'NOT_FOUND' | 'UNSUPPORTED_LINK' | 'UNSUPPORTED_TYPE' | 'UNAVAILABLE';
    }>;
  }>;
}

export interface GameOptimizationProfile {
  id: string;
  gameId: string;
  game: string;
  title: string;
  description: string;
  evidence: string;
  sourceUrl: string;
  pathSourceUrl: string;
  fileHint: string;
  validation: 'MANUAL_ACCEPTANCE_PENDING';
  reviewedAt: string;
}

export interface GameOptimizationPreview {
  token: string;
  profileId: string;
  gameId: string;
  sourcePath: string;
  beforeSha256: string;
  afterSha256: string;
  previewedAt: string;
  changes: Array<{ section: string; key: string; before: string; after: string }>;
}

export interface GameOptimizationResult {
  profileId: string;
  backup: GameConfigBackup;
  appliedAt: string;
  afterSha256: string;
  changedCount: number;
  recoveryPath: string;
  status: 'FILE_VERIFIED';
  gameEffect: 'UNVERIFIED';
  log: string[];
}

export interface GameConfigBackup {
  recoveryWarnings?: string[];
  schemaVersion: '1.0.0';
  backupId: string;
  gameId: string;
  createdAt: string;
  totalBytes: number;
  files: Array<{ name: string; sourcePath: string; bytes: number; sha256: string }>;
}

export interface GameConfigRestorePreview {
  token: string;
  backupId: string;
  gameId: string;
  createdAt: string;
  files: Array<{
    name: string;
    sourcePath: string;
    backupSha256: string;
    currentState: 'FILE' | 'MISSING';
    currentSha256: string | null;
    willOverwriteChangedFile: boolean;
  }>;
}

export interface GameConfigRestoreResult {
  restoredAt: string;
  backupId: string;
  gameId: string;
  restoredCount: number;
  recoveryPath: string;
}

export interface NetworkProbeEndpoint {
  id: 'cloudflare-warmed-http-v2-quick' | 'cloudflare-warmed-http-v2-full';
  mode: 'quick' | 'full';
  methodVersion: 'warmed-https-v2';
  title: string;
  url: string;
  requests: number;
  idleRequests: number;
  loadedRequestsPerDirection: number;
  maximumDownloadBytes: number;
  maximumUploadBytes: number;
  maximumTotalBytes: number;
  maximumDurationSeconds: number;
  maximumParallelConnections: number;
  privacy: string;
}

export interface NetworkProbeSample {
  index: number;
  success: boolean;
  durationMs: number | null;
  responseWaitMs?: number | null;
  setupMs?: number | null;
  transferMs?: number | null;
  startedAtMs?: number;
  completedAtMs?: number;
  overlappedTransfer?: boolean;
  statusCode?: number;
  responseBytes?: number;
  requestBytes?: number;
  error?: string;
}

export interface NetworkProbeMetrics {
  latencyMs: number | null;
  jitterMs: number | null;
  idleLatencyMs: number | null;
  idleJitterMs: number | null;
  idleP10Ms: number | null;
  idleP90Ms: number | null;
  idleVariabilityMs: number | null;
  loadedLatencyMs: number | null;
  loadedJitterMs: number | null;
  loadedLatencyIncreaseMs: number | null;
  downloadLoadedLatencyMs: number | null;
  downloadLoadedP90Ms: number | null;
  downloadLoadedLatencyIncreaseMs: number | null;
  uploadLoadedLatencyMs: number | null;
  uploadLoadedP90Ms: number | null;
  uploadLoadedLatencyIncreaseMs: number | null;
  downloadMbps: number | null;
  uploadMbps: number | null;
  requestFailurePercent: number;
  successfulSamples: number;
  failedSamples: number;
  expectedSamples: number;
}

export interface NetworkQualityHistoryEntry {
  id: string;
  completedAt: string;
  status: 'COMPLETE' | 'PARTIAL' | 'OFFLINE';
  endpointId: string;
  methodVersion: 'warmed-https-v2' | 'legacy-v1';
  mode: 'quick' | 'full' | 'legacy';
  quality: 'SUFFICIENT' | 'INSUFFICIENT' | 'LEGACY';
  runConditions?: { downloadBytes: number | null; uploadBytes: number | null; maximumTotalBytes: number | null; maximumParallelConnections: number | null };
  metrics: Pick<NetworkProbeMetrics, 'idleLatencyMs' | 'idleJitterMs' | 'idleP90Ms' | 'idleVariabilityMs' | 'requestFailurePercent' | 'downloadLoadedLatencyMs' | 'downloadLoadedLatencyIncreaseMs' | 'uploadLoadedLatencyMs' | 'uploadLoadedLatencyIncreaseMs' | 'downloadMbps' | 'uploadMbps'>;
}

export interface NetworkQualityHistoryState {
  status: 'READY' | 'CORRUPT';
  entries: NetworkQualityHistoryEntry[];
  error?: string;
}

export interface NetworkProbeConsentPreview {
  token: string;
  endpoint: NetworkProbeEndpoint;
  consequence: string;
  mode: 'quick' | 'full';
}

export interface NetworkProbeProgress {
  phase: string;
  completedSteps: number;
  totalSteps: number;
  message: string;
  bytesTransferred: number;
  maximumTotalBytes: number;
}

export interface NetworkProbeResult {
  status: 'COMPLETE' | 'PARTIAL' | 'OFFLINE' | 'CANCELED';
  endpoint: NetworkProbeEndpoint;
  methodVersion: 'warmed-https-v2';
  mode: 'quick' | 'full';
  quality: 'SUFFICIENT' | 'INSUFFICIENT';
  startedAt: string;
  completedAt: string;
  samples: NetworkProbeSample[];
  idleSamples: NetworkProbeSample[];
  loadedSamples: NetworkProbeSample[];
  downloadLoadedSamples: NetworkProbeSample[];
  uploadLoadedSamples: NetworkProbeSample[];
  download: Omit<NetworkProbeSample, 'index'>;
  upload: Omit<NetworkProbeSample, 'index'>;
  metrics: NetworkProbeMetrics;
  limitations: string;
  loadQuality: {
    download: { status: 'SUFFICIENT' | 'INSUFFICIENT'; overlappingSuccessfulSamples: number; requiredOverlappingSamples: number; transferDurationMs: number | null; minimumTransferDurationMs: number };
    upload: { status: 'SUFFICIENT' | 'INSUFFICIENT'; overlappingSuccessfulSamples: number; requiredOverlappingSamples: number; transferDurationMs: number | null; minimumTransferDurationMs: number };
  };
  runConditions: { mode: 'quick' | 'full'; methodVersion: 'warmed-https-v2'; downloadBytes: number; uploadBytes: number; maximumTotalBytes: number; maximumParallelConnections: number };
  persistence?: { saved: boolean; reason?: string };
  history?: NetworkQualityHistoryState;
}

export interface PresentMonImportSourceSummary {
  sourceId: string;
  fileName: string;
  capturedAt: string;
  metric: string;
  metricColumn: string;
  unit: string;
  unavailableFrameCount: number;
  toolVersion?: string;
  applications: Array<{ application: string; processIds: number[]; sampleCount: number }>;
}

export interface PresentMonToolInfo {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  version: string;
  sha256: string;
  signerSubject: string;
  timestampSubject?: string;
  sourceUrl: string;
  license: string;
  executableName: string;
  reason?: string;
}

export interface PresentMonTarget {
  targetId: string;
  pid: number;
  name: string;
  windowTitle: string;
  startedAt: string;
  sessionId: number | null;
}

export interface PresentMonCaptureConsentPreview {
  token: string;
  target: PresentMonTarget;
  durationSeconds: 10 | 20 | 30;
  toolVersion: string;
  hardwareReadings?: boolean;
  consequence: string;
}

export interface TelemetryStat {
  count: number;
  min: number | null;
  mean: number | null;
  p95: number | null;
  max: number | null;
  stale: number;
  unavailable: number;
  warmup: number;
  coveragePercent: number | null;
}

export interface TelemetryReading {
  s: 'OK' | 'WARMING_UP' | 'STALE' | 'UNAVAILABLE';
  v: number | null;
}

export interface TelemetryView {
  status: 'RECORDED' | 'FAILED';
  stopReason: string;
  errors: string[];
  targetTracked: boolean;
  targetChanged: boolean;
  adapters: Array<{ id: string; label: string; identity: 'VERIFIED' | 'UNAVAILABLE'; dedicatedCapacityBytes: number | null; sensorsOnly?: boolean }>;
  sensors?: { source: 'NVML'; status: 'DISABLED' | 'NOT_PRESENT' | 'SIGNATURE_REJECTED' | 'UNAVAILABLE' | 'OK' | 'NOT_REPORTED'; driverVersion: string | null };
  summary: { samples: number; metrics: Record<string, TelemetryStat>; performanceLimitedShare: number | null };
}

export interface CaptureTelemetry {
  requested: true;
  status: 'RECORDING' | 'RECORDED' | 'FAILED' | 'INTERRUPTED';
  view: TelemetryView | null;
  error: string | null;
}

export interface LiveHardwareReading extends TelemetryView {
  collectedAt: string;
  latest: null | {
    t: number;
    cpu: Record<'utilityPercent' | 'performancePercent' | 'frequencyMhz' | 'performanceLimitPercent', TelemetryReading>;
    memory: { availableBytes: TelemetryReading };
    gpu: Record<string, Partial<Record<string, TelemetryReading>>>;
  };
}

/** Per-run frame-time summary saved with each capture (null for older captures). */
export interface FrameSummary {
  application: string;
  frames: number;
  averageFps: number;
  onePercentLowFps: number;
  medianFrameMs: number;
  p99FrameMs: number;
  spreadPercent: number;
  capLikely: boolean;
  capFps: number | null;
}

export interface PresentMonCaptureEntry {
  telemetry?: CaptureTelemetry | null;
  frameSummary?: FrameSummary | null;
  observedDurationSeconds?: number | null;
  protocolComplete?: boolean;
  captureId: string;
  status: 'STARTING' | 'RECORDING' | 'FINALIZING' | 'COMPLETE' | 'FAILED' | 'NEEDS_REVIEW';
  target: { targetId: string; pid: number; name: string; windowTitle: string; startedAt: string };
  durationSeconds: number;
  startedAt: string;
  completedAt: string | null;
  stopReason: 'USER' | 'TIMED' | 'EARLY_EXIT' | 'PROCESS_ERROR' | null;
  tool: { version: string; sha256: string; signerSubject: string; timestampSubject: string; sourceUrl: string; license: string };
  output: null | { fileName: string; bytes: number; sha256: string; metric: string; metricColumn: string; unit: string; unavailableFrameCount: number };
  applications: Array<{ application: string; processIds: number[]; sampleCount: number }>;
  error: string | null;
}

export interface PresentMonCaptureState {
  active: PresentMonCaptureEntry | null;
  entries: PresentMonCaptureEntry[];
  maximumEntries: number;
}

export interface PresentMonCaptureDeletionPreview {
  token: string;
  captureId: string;
  targetName: string;
  startedAt: string;
  status: PresentMonCaptureEntry['status'];
  files: Array<{ kind: string; fileName: string; bytes: number }>;
  totalBytes: number;
  fingerprint: string;
  consequence: string;
}

export interface PresentMonImportMetadata {
  experimentId: string;
  workload: string;
  toolVersion: string;
  changeDescription: string;
  conditions: Record<string, string>;
  runs: Array<{
    sourceId: string;
    phase: 'BASELINE' | 'CANDIDATE';
    application: string;
    variant: string;
    capturedAt: string;
    notes: string;
  }>;
}

export interface BenchmarkImportPreview {
  canceled: boolean;
  token?: string;
  format?: 'PRESENTMON';
  requiresMetadata?: boolean;
  sources?: PresentMonImportSourceSummary[];
  records?: Array<{
    experimentId: string;
    phase: 'BASELINE' | 'CANDIDATE';
    workload: string;
    tool: string;
    metric: string;
    direction: 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER';
    variant: string;
    sampleCount: number;
    samples: number[];
    conditions: Record<string, string>;
  }>;
}

export interface AuditJournalEntry {
  schemaVersion?: '1.1.0';
  id: string;
  timestamp: string;
  updatedAt?: string;
  actionId: string;
  capabilityId?: string | null;
  safetyClass?: 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | null;
  riskLevel?: 'Low' | 'Medium' | 'High' | null;
  title: string;
  category: string;
  preAction: unknown;
  resultingState: unknown;
  status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'NEEDS_REVIEW';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  rollback: { available: boolean; reason: string; kind?: 'restore-registry-run-value' | 'disable-process-ecoqos' | 'restore-consumer-features-policy' | 'restore-boot-timing-setting' | 'restore-power-plan' | 'restore-gpu-preference' | 'restore-user-setting' | 'restore-mouse-acceleration' | 'remove-power-plan' | 'restore-cpu-minimum-state' | 'restore-windowed-games' | 'restore-fullscreen-optimizations' | 'restore-usb-selective-suspend'; completedAt?: string };
  reconciliation?: {
    checkedAt: string;
    classification: 'INTENDED_STATE' | 'PRE_ACTION_STATE' | 'DIVERGED' | 'TARGET_CHANGED' | 'UNKNOWN' | 'UNAVAILABLE';
    message: string;
  };
}

export interface AuditHistoryRecovery {
  kind: 'INTERRUPTED' | 'CORRUPT' | 'INACCESSIBLE';
  pendingCount: number | null;
  reason: string;
  recoverable: boolean;
  issueCode: string;
}

export interface AuditHistoryState {
  entries: AuditJournalEntry[];
  recovery: AuditHistoryRecovery | null;
}

export interface AuditJournalRecoveryResult extends AuditHistoryState {
  quarantine: {
    fileName: string;
    bytes: number;
    sha256: string;
  };
}

export interface AuditExportPreview {
  payload: {
    schemaVersion: '1.0.0-redacted-audit-export';
    createdAt: string;
    entryCount: number;
    entries: Array<Record<string, unknown>>;
  };
  omittedFields: string[];
}

export type AuditDeletionMode = 'COMPLETED_30_DAYS' | 'COMPLETED_90_DAYS' | 'ALL_DELETABLE';

export interface AuditDeletionPreview {
  token: string;
  mode: AuditDeletionMode;
  cutoffTimestamp: string | null;
  previewEntries: Array<{ timestamp: string | null; actionFamily: string; category: string; status: 'SUCCESS' | 'FAILED' }>;
  deleteCount: number;
  retainCount: number;
  protectedCounts: { unresolved: number; rollbackAvailable: number; invalidOrUnclassified: number };
}

export interface CapabilityRecord {
  id: string;
  actionPattern: string;
  title: string;
  category: string;
  description: string;
  supportedWindows: string[];
  prerequisites: string[];
  detectionMethod: string;
  currentStateMethod: string;
  recommendedStateMethod: string;
  expectedBenefit: string;
  evidenceLevel: string;
  confidence: string;
  riskLevel: 'Low' | 'Medium' | 'High';
  safetyClass: 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5';
  privilegeRequirement: string;
  persistence: string;
  rebootRequirement: string;
  mutationScope: string;
  rollbackMethod: string;
  rollbackLimitations: string;
  verificationMethod: string;
  measurableSuccessCriteria: string;
  knownConflicts: string[];
  gamingConsiderations: string;
  securityImplications: string;
  unavailableReason: string;
  profiles: Array<'public' | 'consumer-premium' | 'owner' | 'experimental'>;
  publicAvailability: 'ENABLED' | 'CANDIDATE' | 'DISABLED';
}

export interface RuntimeProfileState {
  profile: 'public' | 'consumer-premium' | 'owner';
  capabilities: CapabilityRecord[];
  license?: ConsumerLicenseState;
}

export interface MaintenanceAction {
  id: string;
  title: string;
  description: string;
  evidence: string;
  reversible: boolean;
  kind: 'clear-temp-files' | 'retrim-drive' | 'clear-shader-caches' | 'clear-crash-dumps';
}

export interface CacheCleanupSummary {
  totalSizeBytes: number;
  pathCount: number;
  paths: string[];
}

export interface CacheCleanupInventory {
  scannedAt: string;
  items: Partial<Record<'clear-shader-caches' | 'clear-crash-dumps', CacheCleanupSummary>>;
  errors: Array<{ component: string; message: string }>;
}

export interface PowerPlan {
  guid: string;
  name: string;
  active: boolean;
}

export interface PowerPlanInventory {
  items: PowerPlan[];
  activeGuid: string | null;
}

export interface FullscreenOptimizationItem {
  id: string;
  exePath: string;
  exists: boolean;
  kind: string | null;
  data: string | null;
  /** Fullscreen optimizations are off for this program (current user). */
  disabled: boolean;
  /** Also turned off for all users, which Dialed does not change. */
  disabledForAllUsers: boolean;
}

export interface GpuPreferenceItem {
  id: string;
  exePath: string;
  kind: string | null;
  data: string | null;
  preference: 0 | 1 | 2 | null;
}

export interface DisplayModeReport {
  collectedAt: string;
  displays: Array<{
    label: string;
    /** Hash of the monitor's EDID-derived DeviceID. Stable across reconnects and
     *  reordering, so a saved baseline can be matched to the same physical panel.
     *  Null when Windows reported no monitor-level device. Never displayed. */
    monitorKey: string | null;
    /** Panel model as Windows reports it, e.g. "LG ULTRAGEAR". Null when unknown. */
    monitorName: string | null;
    /** Windows device name, e.g. "\\\\.\\DISPLAY1". Positional — not an identity. */
    deviceName: string | null;
    primary: boolean;
    adapter: string;
    currentWidth: number | null;
    currentHeight: number | null;
    currentHz: number | null;
    maxHzAtCurrentResolution: number | null;
    maxHzAnyResolution: number | null;
    status: 'HIGHER_RATE_AVAILABLE' | 'AT_HIGHEST_OFFERED' | 'UNKNOWN';
  }>;
}

export interface WifiStatusReport {
  collectedAt: string;
  status: 'AVAILABLE' | 'NO_WIFI' | 'UNAVAILABLE';
  reason: string | null;
  interfaces: Array<{
    name: string;
    state: string | null;
    radioType: string | null;
    band: string | null;
    channel: number | null;
    receiveRateMbps: number | null;
    transmitRateMbps: number | null;
    signalPercent: number | null;
    signalQuality: 'STRONG' | 'GOOD' | 'FAIR' | 'WEAK' | 'UNKNOWN';
  }>;
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
  cpuPercent: number | null;
  creationTime?: string | null;
  workingSetBytes: number;
  efficiencyMode: boolean;
}

export interface SafeOsPolicy {
  id: 'disable-windows-consumer-features';
  title: string;
  description: string;
  risk: 'Medium';
  enabled: boolean;
  keyExists: boolean;
  valueExists: boolean;
  value: number | null;
  valueKind: string | null;
}

export interface PolicyCheckpointResult {
  status: 'VERIFIED' | 'THROTTLED';
  description: string;
  sequenceNumber: number | null;
  creationTime: string;
  message: string;
}

export interface PolicyMutationResult {
  success: boolean;
  entry?: AuditJournalEntry;
  result?: unknown;
  error?: string;
  requiresThrottleConfirmation?: boolean;
  checkpoint?: PolicyCheckpointResult;
  throttleToken?: string;
}
