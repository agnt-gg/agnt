import { API_CONFIG } from '@/tt.config.js';

// Independent metadata requests: search must work before any of the library screens mount.
export const SEARCH_SOURCES = [
  ['outputs','Conversations & outputs','/content-outputs','outputs'],
  ['agents','Agents','/agents/','agents'],
  ['workflows','Workflows','/workflows/summary','workflows'],
  ['goals','Goals','/goals/summary','goals'],
  ['tools','Tools','/tools/orchestrator-tools','tools'],
  ['customTools','Custom tools','/custom-tools/','tools'],
  ['skills','Skills','/skills/','skills'],
  ['widgets','Widgets','/widget-definitions','widgets'],
  ['plugins','Plugins','/plugins/installed','plugins'],
];
export async function searchRequest(endpoint,{signal,token,fetcher=fetch}={}) {
  const response=await fetcher(API_CONFIG.BASE_URL+endpoint,{signal,credentials:'include',headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw Error('HTTP '+response.status);
  return response.json();
}
export async function loadSearchSources({signal,token,onSource,onError,fetcher=fetch}) {
  if(!token){onError('Catalog','Sign in to search saved items.');return;}
  await Promise.all(SEARCH_SOURCES.map(async([key,label,path,field])=>{
    try {const body=await searchRequest(path,{signal,token,fetcher});if(!Array.isArray(body[field]))throw Error('Invalid response');if(!signal?.aborted)onSource(key,body[field]);}
    catch(error){if(error.name!=='AbortError'&&!signal?.aborted)onError(label,error.message);}
  }));
}
// ── The Store as the empty state ──────────────────────────────────────────
//
// Searching for an asset you do not own is not a dead end, it is a shopping
// intent: the answer to "agent that triages email" when you own no such agent
// is the listing that sells one. Public endpoint (no authenticateToken on GET
// /marketplace/items), so this works signed out, and every caller treats a
// failure as "no suggestions" — the Store must never be able to break local
// search.
const STORE_ICONS = {
  workflow: 'fas fa-project-diagram',
  agent: 'fas fa-robot',
  tool: 'fas fa-wrench',
  plugin: 'fas fa-puzzle-piece',
  skill: 'fas fa-graduation-cap',
};

const tokens = (value) => String(value || '').toLowerCase().split(/\s+/).filter(Boolean);

/**
 * How well does one listing answer this query? Title hits count for more than
 * blurb hits because the title is what the user was typing at.
 */
export function storeRelevance(item, query) {
  const title = String(item.title || '').toLowerCase();
  const blurb = [item.tagline, item.description, item.category, Array.isArray(item.tags) ? item.tags.join(' ') : item.tags]
    .filter(Boolean).join(' ').toLowerCase();
  let score = 0;
  for (const token of tokens(query)) {
    if (title.includes(token)) score += 3;
    else if (blurb.includes(token)) score += 1;
  }
  if (title === String(query || '').trim().toLowerCase()) score += 5;
  return score;
}

/**
 * The catalogue's own search is a single LIKE over the whole phrase, so
 * "email triage agent" matches nothing unless a title contains that exact
 * string. NEAREST matching is the point of this surface, so a phrase that
 * finds nothing is retried word by word.
 *
 * Longest word first because it is the most specific, but the loop CANNOT
 * stop at the longest one: "nonexistent triage" would then be judged on
 * "nonexistent", find nothing, and hide the triage agent the user was
 * obviously reaching for. It stops at the first word that actually answers,
 * and tries at most MAX_TOKEN_RETRIES of them so a long sentence cannot turn
 * one keystroke into a dozen round trips.
 */
const MAX_TOKEN_RETRIES = 3;

export async function marketplaceSearch(query, { signal, fetcher = fetch } = {}) {
  const phrase = String(query || '').trim();
  if (!phrase) return [];
  const ask = async (term) => {
    const response = await fetcher(
      `${API_CONFIG.REMOTE_URL}/marketplace/items?type=all&search=${encodeURIComponent(term)}`,
      { signal }
    );
    if (!response.ok) throw Error('HTTP ' + response.status);
    const body = await response.json();
    return Array.isArray(body?.items) ? body.items : [];
  };

  const items = await ask(phrase);
  if (items.length) return items;

  const candidates = tokens(phrase)
    .filter((token) => token.length >= 3 && token !== phrase.toLowerCase())
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_TOKEN_RETRIES);
  for (const token of candidates) {
    const nearby = await ask(token);
    if (nearby.length) return nearby;
  }
  return [];
}

export function marketplaceStoreItems(items, query, limit = 8) {
  return (items || [])
    .filter((item) => item && item.asset_id)
    .map((item) => ({ item, score: storeRelevance(item, query) }))
    .sort((a, b) =>
      b.score - a.score ||
      Number(b.item.installs || 0) - Number(a.item.installs || 0) ||
      Number(b.item.rating || 0) - Number(a.item.rating || 0)
    )
    .slice(0, limit)
    .map(({ item }) => {
      const type = item.asset_type || 'workflow';
      const price = Number(item.price || 0);
      return {
        id: 'store:' + item.id,
        label: item.title || item.asset_id,
        icon: STORE_ICONS[type] || 'fas fa-store',
        hint: price > 0 ? `${type} · $${price.toFixed(2)}` : `${type} · free`,
        snippet: item.tagline || item.description || '',
        action: { type: 'store', assetId: item.asset_id },
      };
    });
}

export function historySearchItems(results){
  return results.map(row=>{
    const meta=row.meta||{};
    let action,screen='ArtifactsScreen',id='history:'+row.kind+':'+row.id;
    if(row.kind==='output'){
      const outputId=meta.output_id||row.id;
      if(meta.content_type==='conversation'||meta.conversation_id){screen='ChatScreen';id='chat:'+outputId;action={type:'chat',id:outputId};}
      else action={type:'output',id:outputId};
    }else if(row.kind==='conversation'){screen='ChatScreen';action={type:'conversation',id:meta.conversation_id||row.id};}
    else if(row.kind==='execution'){screen='TracesScreen';action={type:'inspect',kind:'trace',id:meta.execution_id||row.id,screen};}
    else if(row.kind==='memory'){screen='MemoryScreen';action={type:'inspect',kind:'memory',id:meta.memory_id||row.id,screen};}
    else if(row.kind==='version'){screen='WorkflowsScreen';action={type:'inspect',kind:'workflow',id:meta.workflow_id,screen};}
    else {screen='LearningScreen';action={type:'screen',screen,opts:{select:{kind:row.kind,id:row.id}}};}
    return {id,label:row.title||row.kind,icon:screen==='ChatScreen'?'fas fa-comments':'fas fa-file-alt',hint:row.kind,snippet:row.snippet||'',action,screen,serverMatched:true};
  });
}
