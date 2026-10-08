// Node 20 fetch doesn't consume HTTPS_PROXY by itself. Pin global fetch to
// the local egress broker, retaining the instance-local scoped API endpoint.
// This is convenience, not enforcement: the private network namespace blocks
// raw routes even if workload code removes or replaces this dispatcher.
const {Agent,ProxyAgent,setGlobalDispatcher} = require('/app/node_modules/undici');
const direct = new Agent();
const proxy = new ProxyAgent('http://127.0.0.1:3128');
setGlobalDispatcher({ dispatch(options,handler) {
  const origin=new URL(String(options.origin));
  const api=(origin.hostname==='127.0.0.1'||origin.hostname==='localhost')&&origin.port==='3333';
  if(api) options={...options,origin:'http://127.0.0.1:3333'};
  return (api?direct:proxy).dispatch(options,handler);
}});
