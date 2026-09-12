// Scrubbing runs on every setup evaluation, including worker reuse.
import {initializeTestStorage} from '../../backend/src/utils/testStorageContext.js';
const HOST_ENV_TO_SCRUB = [
  // Auth model switches. The most dangerous: they turn verification off, so a
  // leaked value makes security tests pass or fail for reasons unrelated to
  // the code under test.
  'TRUST_REMOTE_AUTH',
  'TRUST_PROXY',
  // Secrets. A suite asserting "generates one when absent" cannot be trusted
  // if the host already supplied one.
  'JWT_SECRET',
  'SESSION_SECRET',
  'ENCRYPTION_KEY',
  'AGNT_LEGACY_ENCRYPTION_KEY',
];
for(const key of HOST_ENV_TO_SCRUB)delete process.env[key];
if(process.env.AGNT_TEST_USE_REAL_DATA)throw new Error('[test-storage] real-data escape refused');
initializeTestStorage();
