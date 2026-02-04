/**
 * Workflow Version Retention Policy Configuration
 *
 * Controls how long workflow versions are kept before automatic cleanup
 */

export const VERSION_RETENTION = {
  // Keep all versions for this duration
  KEEP_ALL_DURATION_HOURS: 24,

  // After that, apply compression rules:
  KEEP_HOURLY_FOR_DAYS: 7, // One version per hour for 7 days
  KEEP_DAILY_FOR_MONTHS: 3, // One version per day for 3 months
  KEEP_CHECKPOINTS_FOREVER: true, // Never auto-delete checkpoints

  // Absolute limits
  MAX_VERSIONS_PER_WORKFLOW: 1000,
  MIN_VERSIONS_TO_KEEP: 10, // Always keep at least this many recent versions

  // Compression settings
  COMPRESSION_THRESHOLD_BYTES: 10000, // Compress workflow states larger than 10KB
};

export default VERSION_RETENTION;
