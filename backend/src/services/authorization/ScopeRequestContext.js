import {AsyncLocalStorage} from 'node:async_hooks';
const contexts=new AsyncLocalStorage();
const trustedRequests=new WeakMap();
export const currentScopeRequest=()=>contexts.getStore()||null;
export const trustedScopeRequest=req=>trustedRequests.get(req);
export function withScopeRequest(req,context,next){trustedRequests.set(req,context);return contexts.run(Object.freeze(context),next);}
