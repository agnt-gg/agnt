import {parentPort,workerData} from 'node:worker_threads';
import {convertDocument,DOCUMENT_ERRORS} from './documents.js';
try{
 parentPort.postMessage({ok:true,result:await convertDocument(Buffer.from(workerData.bytes),workerData.options)});
}catch(error){
 const known=DOCUMENT_ERRORS.includes(error.message);
 // A diagnostic trail without file content: which converter failed and how.
 if(!known)console.error(JSON.stringify({event:'convert_failed',detail:String(error?.name||'Error'),extension:workerData.options?.extension||null}));
 parentPort.postMessage({ok:false,error:known?error.message:'extraction_failed'});
}
