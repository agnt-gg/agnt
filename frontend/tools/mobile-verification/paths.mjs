import path from 'node:path';import fs from 'node:fs';import {fileURLToPath} from 'node:url';
export const frontendRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
export const evidence=process.env.AGNT_MOBILE_EVIDENCE_DIR;
if(!evidence)throw Error('Set AGNT_MOBILE_EVIDENCE_DIR to a fresh evidence directory');
export const output=name=>path.join(evidence,name);
