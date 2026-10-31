/**
 * Routes for plugin install requests and the owner's install policy.
 *
 *   GET  /install-policy               anyone: the policy, and whether you may edit it / decide requests
 *   PUT  /install-policy               owner only
 *   GET  /requests                     yours, plus every open one if you may decide
 *   POST /requests/:id/approve         owner, or an admin when the owner allows it: installs it, switches it on for
 *                                      everyone who asked, and lets members USE it (pre-approved)
 *   POST /requests/:id/decline         same deciders
 *   POST /requests/:id/seen            the requester dismisses a decided request
 *
 * deps:
 *   requests   PluginInstallRequests store
 *   installer  { installFromMarketplace(name, version, opts), getAvailablePlugins() }
 *   accounts   { add(name, userId) }
 *   reload     () => Promise   reload plugin processes after an install
 *   notify     (userId, payload) => void   tell the requester (realtime)
 *   roleOf     (req) => Promise<'owner'|'admin'|'member'>
 *   restricted () => boolean   a shared instance (requests only exist there)
 *   serialize  (handler) => handler   the host's one-at-a-time plugin mutation queue (approve installs)
 */
import { PLUGIN_FEATURES } from './pluginFeaturePolicy.js';

const userOf = (req) => req.user?.userId || req.user?.id;
const send = (res, error) => res.status(error.status || 500).json({ success: false, error: error.message, code: error.code });

/** Who decides requests: always the owner; admins only when the owner allows it. */
export function canDecide(role, policy) {
  return role === 'owner' || (role === 'admin' && policy.adminsCanApprove === true);
}

export function mountPluginRequestRoutes(router, { requests, installer, accounts, reload, notify, roleOf, restricted, refreshPolicy = async () => {}, serialize = (handler) => handler }) {
  router.get('/install-policy', async (req, res) => {
    try {
      const [policy, role] = await Promise.all([requests.policy(), roleOf(req)]);
      res.json({ success: true, policy, features: PLUGIN_FEATURES, hosted: restricted(), canEdit: role === 'owner', canDecide: canDecide(role, policy) });
    } catch (error) { send(res, error); }
  });

  router.put('/install-policy', serialize(async (req, res) => {
    try {
      if ((await roleOf(req)) !== 'owner') return res.status(403).json({ success: false, error: 'Only the instance owner can change who may add plugins' });
      const policy = await requests.setPolicy(req.body || {});
      await refreshPolicy();
      res.json({ success: true, policy });
    } catch (error) { send(res, error); }
  }));

  router.get('/requests', async (req, res) => {
    try {
      const [policy, role] = await Promise.all([requests.policy(), roleOf(req)]);
      const decides = canDecide(role, policy);
      res.json({ success: true, canDecide: decides, pending: decides ? await requests.pending() : [], mine: await requests.mine(userOf(req)) });
    } catch (error) { send(res, error); }
  });

  async function decider(req) {
    const [policy, role] = await Promise.all([requests.policy(), roleOf(req)]);
    if (!canDecide(role, policy)) throw Object.assign(new Error(role === 'admin' ? 'The owner decides plugin requests on this instance' : 'Only the owner or an admin can decide plugin requests'), { status: 403 });
    const request = await requests.find(req.params.id);
    if (!request) throw Object.assign(new Error('Request not found'), { status: 404 });
    if (request.status !== 'pending') throw Object.assign(new Error('This request was already decided'), { status: 409, code: 'already_decided' });
    return request;
  }

  router.post('/requests/:id/approve', serialize(async (req, res) => {
    try {
      const request = await decider(req);
      const name = request.pluginName;
      // The owner's block wins over any approval, including an admin's.
      if ((await requests.policy()).blockedPlugins?.includes(name)) throw Object.assign(new Error('The owner has blocked this plugin on this instance. Unblock it in Settings first.'), { status: 409, code: 'plugin_blocked' });
      const listing = (await installer.getAvailablePlugins()).plugins?.find((p) => p.name === name);
      if (!listing) throw Object.assign(new Error('This plugin is no longer in the marketplace'), { status: 410 });
      // A purchase is each person's own: an approval never spends the approver's.
      if (Number(listing.price) > 0) throw Object.assign(new Error('Paid plugins are bought by each member; they cannot be approved here'), { status: 409, code: 'paid_plugin' });
      // The approver adds it to the instance, as an owner install would.
      const result = await installer.installFromMarketplace(name, 'latest', { authToken: req.headers.authorization || null });
      if (!result?.success) {
        const failed = await requests.decide(request.id, 'failed', userOf(req), String(result?.error || 'Install failed').slice(0, 500));
        notify(request.requesterId, { kind: 'plugin_request', status: 'failed', pluginName: name });
        return res.status(502).json({ success: false, error: result?.error || 'Install failed', request: failed });
      }
      // Approving it means members may use it, not only have it installed: without this grant every tool
      // in a plugin that reaches beyond the network stayed refused to the very member it was approved for.
      await requests.grantToMembers(name);
      // Everyone who asked for it gets it switched on, and hears so.
      const asked = await requests.pendingFor(name);
      for (const open of asked) {
        await accounts.add(name, open.requesterId);
        await requests.decide(open.id, 'approved', userOf(req));
        notify(open.requesterId, { kind: 'plugin_request', status: 'approved', pluginName: name });
      }
      await reload();
      res.json({ success: true, request: await requests.find(request.id), approved: asked.length });
    } catch (error) { send(res, error); }
  }));

  router.post('/requests/:id/decline', async (req, res) => {
    try {
      const request = await decider(req);
      const decided = await requests.decide(request.id, 'declined', userOf(req));
      notify(request.requesterId, { kind: 'plugin_request', status: 'declined', pluginName: request.pluginName });
      res.json({ success: true, request: decided });
    } catch (error) { send(res, error); }
  });

  router.post('/requests/:id/seen', async (req, res) => {
    try { await requests.markSeen(req.params.id, userOf(req)); res.json({ success: true }); } catch (error) { send(res, error); }
  });
}
