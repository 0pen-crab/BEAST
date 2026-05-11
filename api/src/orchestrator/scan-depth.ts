/** Valid scan depth values (files per Sniper agent module) */
export const SCAN_DEPTH_VALUES = [1500, 500, 100] as const;
export type ScanDepth = (typeof SCAN_DEPTH_VALUES)[number];

export const DEFAULT_SCAN_DEPTH: ScanDepth = 500;
