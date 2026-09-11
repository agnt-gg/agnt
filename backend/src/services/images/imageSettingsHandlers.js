export function createImageSettingsHandlers(service) {
  const user = req => req.user?.isAuthenticated === true ? req.user.id || req.user.userId : null;
  const fail = (res,error) => res.status(error.code === 'IMAGE_SETTINGS_CONFLICT' || /revision conflict/i.test(error.message) ? 409 : 400).json({success:false,error:error.message});
  return {
    async get(req,res) {
      const id=user(req);if(!id)return res.status(401).json({error:'Authentication required'});
      try { res.json(await service.read(id,req.headers?.authorization)); } catch(error) { fail(res,error); }
    },
    async put(req,res) {
      const id=user(req);if(!id)return res.status(401).json({error:'Authentication required'});
      try { const settings=await service.update(id,req.body,req.headers?.authorization);res.json({success:true,settings:{...settings,authorizations:Object.fromEntries(Object.entries(settings.authorizations).map(([id,g])=>[id,{allowed:g.allowed,revision:g.revision}]))}}); } catch(error) { fail(res,error); }
    },
  };
}
