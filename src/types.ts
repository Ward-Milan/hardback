export interface StorageDevice {
  id: string;
  name: string;
  mountPoint: string;
  fileSystem: string;
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  isRemovable: boolean;
  deviceType: "sd_card" | "ssd" | "hdd" | "internal_ssd";
  protocolLabel: string;
}

export interface PathInspection {
  paths: string[];
  path: string;
  name: string;
  isDir: boolean;
  isPackage: boolean;
  exists: boolean;
  fileCount: number;
  totalBytes: number;
  availableBytes: number;
  deviceType: string;
  summaryLabel: string;
  rootFolderPath?: string;
  rootFolderName?: string;
}

export interface SubfolderEntry {
  name: string;
  path: string;
  hasChildren: boolean;
}

export interface AppSettings {
  smartCascading: boolean;
  fastInlineVerifyOnly: boolean;
  turboIo: boolean;
  ignoreJunkFiles: boolean;
  ignoreCameraProxies: boolean;
  writeReportsOnDisk: boolean;
  sortByMediaType: boolean;
  moveModeDeleteSource: boolean;
  autoEjectSource: boolean;
  launchAtStartup?: boolean;
  soundNotification: boolean;
  webhookUrl: string;
  hashAlgorithm: "xxh64" | "xxh3" | "md5" | "sha256";
}

export interface VerifiedFileRecord {
  relativePath: string;
  sizeBytes: number;
  sourceHash: string;
  destHashes: string[];
  algorithm: string;
  status: string;
  videoHealth?: "ok" | "corrupted_moov" | "truncated" | null;
}

export interface VisualCertificateData {
  jobId: string;
  dateLocal: string;
  sourcePath: string;
  destinationPath: string;
  algorithm: string;
  durationSecs: number;
  totalBytes: number;
  avgSpeedMbS: number;
  totalFiles: number;
  verifiedFiles: number;
  resumedFiles: number;
  records: VerifiedFileRecord[];
  rawText: string;
  corruptedVideos?: string[];
}

export interface TransferJobState {
  id: string;
  sourceName: string;
  sourcePath: string;
  sourcePaths: string[];
  destinationPaths: string[];
  createSubfolder: boolean;
  customFolderName?: string | null;
  algorithm: "xxh64" | "xxh3" | "md5" | "sha256";
  status: "scanning" | "copying" | "verifying" | "paused" | "completed" | "failed" | "cancelled" | "queued";
  phaseLabel: string;
  currentFile: string;
  totalFiles: number;
  processedFiles: number;
  verifiedFiles: number;
  resumedFiles: number;
  totalBytes: number;
  copiedBytes: number;
  verifiedBytes: number;
  progressPercent: number;
  speedBps: number;
  etaSeconds: number | null;
  elapsedSeconds: number;
  errorMessage: string | null;
  reportPaths: string[];
  startedAt: string;
  corruptedVideos?: string[];
}

export interface IngestHistoryEntry {
  id: string;
  sourceName: string;
  sourcePath: string;
  sourcePaths?: string[];
  destinationPaths: string[];
  totalFiles: number;
  verifiedFiles: number;
  resumedFiles: number;
  totalBytes: number;
  durationSecs: number;
  averageSpeedBps: number;
  status: "completed" | "interrupted" | "failed";
  errorMessage: string | null;
  algorithm: string;
  reportPaths: string[];
  createdAt: string;
}
