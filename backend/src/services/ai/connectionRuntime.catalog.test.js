import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  selectChatModels,
  quotaFractions,
  modelMetadataRecords,
  parseQuotaModels,
  classifyGatewayError,
  humanizeModelId,
} from './connectionRuntime.js';

// Real :fetchAvailableModels response captured 2026-09-30 (prompt-experiment
// blobs stripped; structure, ids, flags and quota untouched).
const FIXTURE = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../tests/providers/fixtures/antigravity-fetchAvailableModels-2026-09-30.json'),
  'utf8',
));
const clone = () => structuredClone(FIXTURE);
const ids = (payload) => selectChatModels(payload).map((m) => m.id);

describe('selectChatModels — against the live 2026-09-30 catalog', () => {
  it("mirrors Google's picker: Recommended sort first, then the current-tier pointers", () => {
    expect(ids(FIXTURE)).toEqual([
      'gemini-3.6-flash-high', 'gemini-3.6-flash-medium', 'gemini-3.6-flash-low',
      'gemini-pro-agent', 'gemini-3.1-pro-low',
      'claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gpt-oss-120b-medium',
      // tieredModelIds in Google's key order: flashLite → 3.5-lite, flash → 3.8
      // (pro → 3.1-pro-low, already listed above)
      'gemini-3.5-flash-lite', 'gemini-3.8-flash-tiered',
    ]);
  });

  it('surfaces Gemini 3.8 Flash, which the Recommended-sort-only filter hid', () => {
    const [m] = selectChatModels(FIXTURE).filter((x) => x.id === 'gemini-3.8-flash-tiered');
    expect(m).toMatchObject({ name: 'Gemini 3.8 Flash', maxTokens: 1048576, maxOutputTokens: 65536, supportsImages: true, supportsThinking: true });
  });

  it('never offers retired, aliased, tab, internal, image or deprecated entries', () => {
    const offered = new Set(ids(FIXTURE));
    for (const id of [
      'gemini-3-flash-agent', 'gemini-3.5-flash-low', 'gemini-3.5-flash-extra-low', // canned "no longer available"
      'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-flash-thinking', // aliased onto 3.5 Flash Lite
      'chat_20706', 'chat_23310', 'tab_flash_lite_preview', 'tab_jump_flash_lite_preview',
      'gemini-3.1-flash-image', 'gemini-3.1-pro-high', // image-only; deprecated → gemini-pro-agent
    ]) expect(offered.has(id), id).toBe(false);
  });

  it('picks up a brand-new model the moment Google lists it — no code change', () => {
    const inSort = clone();
    inSort.models['gemini-4-argon'] = { displayName: 'Gemini 4 Argon', maxTokens: 2097152, maxOutputTokens: 131072, supportsImages: true, supportsThinking: true };
    inSort.agentModelSorts[0].groups[0].modelIds.unshift('gemini-4-argon');
    expect(ids(inSort)[0]).toBe('gemini-4-argon');

    const asTier = clone();
    asTier.models['gemini-4-argon'] = { displayName: 'Gemini 4 Argon' };
    asTier.tieredModelIds.pro = ['gemini-4-argon'];
    expect(ids(asTier)).toContain('gemini-4-argon');
  });

  it('drops a Recommended model once Google deprecates it or its quota is exhausted', () => {
    const payload = clone();
    payload.deprecatedModelIds['gemini-3.6-flash-low'] = { newModelId: 'gemini-3.8-flash-tiered' };
    payload.models['claude-sonnet-4-6'].quotaInfo = { remainingFraction: 0, isExhausted: true };
    const offered = ids(payload);
    expect(offered).not.toContain('gemini-3.6-flash-low');
    expect(offered).not.toContain('claude-sonnet-4-6');
  });

  it('ignores ids referenced by the picker but absent from the models map', () => {
    const payload = clone();
    payload.agentModelSorts[0].groups[0].modelIds.push('ghost-model');
    expect(ids(payload)).not.toContain('ghost-model');
  });

  it('degrades to an empty list on a malformed or empty payload, never throws', () => {
    for (const bad of [null, undefined, {}, { models: null }, { agentModelSorts: [{}], tieredModelIds: { flash: 'x' } }]) {
      expect(selectChatModels(bad)).toEqual([]);
    }
  });
});

describe('Antigravity quota + metadata helpers', () => {
  it('reports known quota fractions only', () => {
    expect(quotaFractions([{ quotaRemaining: 0.5 }, { quotaRemaining: null }, {}])).toEqual([0.5]);
  });

  it("records Google's own context window and capabilities at zero subscription cost", () => {
    const [record] = modelMetadataRecords(selectChatModels(FIXTURE).filter((m) => m.id === 'gemini-3.8-flash-tiered'));
    expect(record).toEqual({
      id: 'gemini-3.8-flash-tiered', contextWindow: 1048576, maxOutputLength: 65536,
      supportsVision: true, reasoning: true, inputCostPer1M: 0, outputCostPer1M: 0,
    });
  });
});

describe('parseQuotaModels', () => {
  it('lists each entitled model once, in Google order, from retrieveUserQuota buckets', () => {
    expect(parseQuotaModels({
      buckets: [
        { modelId: 'gemini-3.8-flash', tokenType: 'REQUESTS', remainingFraction: 1 },
        { modelId: 'gemini-3.8-flash', tokenType: 'TOKENS', remainingFraction: 0.9 },
        { modelId: 'models/gemini-2.5-pro', remainingFraction: 0 },
        { tokenType: 'REQUESTS' },
        { modelId: '  ' },
      ],
    })).toEqual(['gemini-3.8-flash', 'gemini-2.5-pro']);
  });

  it('returns [] for a missing or empty payload', () => {
    expect(parseQuotaModels(null)).toEqual([]);
    expect(parseQuotaModels({ buckets: [] })).toEqual([]);
  });
});

describe('classifyGatewayError', () => {
  const httpError = (status, error) => ({ message: 'Request failed', response: { status, data: { error } } });

  it('flags the live "no valid license (#3501)" 403 as unlicensed', () => {
    expect(classifyGatewayError(httpError(403, {
      code: 403,
      message: 'You do not have a valid license of this product. Please contact your administrator to request a license. (#3501)',
    }))).toMatchObject({ status: 403, unlicensed: true });
  });

  it('does not treat transient or unrelated failures as unlicensed', () => {
    expect(classifyGatewayError(httpError(500, { message: 'backend error' })).unlicensed).toBe(false);
    expect(classifyGatewayError(httpError(403, { message: 'Rate limited by policy', status: 'RESOURCE_EXHAUSTED' })).unlicensed).toBe(false);
    expect(classifyGatewayError(new Error('socket hang up'))).toMatchObject({ status: null, unlicensed: false });
  });
});

describe('humanizeModelId', () => {
  it('names tiered ids after their generation', () => {
    expect(humanizeModelId('gemini-3.8-flash-tiered')).toBe('Gemini 3.8 Flash');
    expect(humanizeModelId('gemini-4-argon')).toBe('Gemini 4 Argon');
  });
});

import { beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import { Readable } from 'node:stream';
import { createManagedConnection, createGatewayClient, getConnection, listConnectionModels } from './connectionRuntime.js';
vi.mock('./clientVersions.js', () => ({ getClientVersion: async () => 'test-version', getClientIdentity: async () => 'test-identity', getCachedClientVersion: () => 'test-version' }));
let testHome;
beforeEach(() => { testHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-contract-')); });
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(testHome, { recursive: true, force: true }); });
function account(id, request = vi.fn()) {
  const dirname = id === 'antigravity' ? '.antigravity' : '.gemini';
  fs.mkdirSync(path.join(testHome,dirname),{recursive:true});
  fs.writeFileSync(path.join(testHome,dirname,'oauth_creds.json'),JSON.stringify({access_token:'test-token',refresh_token:'refresh',expiry_date:Date.now()+3600000}));
  class Client {setCredentials(){}on(){}request(options){return request(options);}}
  const httpClient={post:vi.fn(async()=>({status:200,data:{currentTier:{id:'standard-tier'}}})),get:vi.fn()};
  return {connection:createManagedConnection(id,{homedir:()=>testHome,env:{},httpClient,OAuth2Client:Client,sleep:async()=>{}}),httpClient,request};
}
function scripted(values) {
  return vi.fn(async options => {
    const key=options.url.replace(/^.*v1internal/,''); const next=values[key];
    const result=typeof next==='function'?next(options):next;
    if(result instanceof Error)throw result;
    return {status:200,data:result};
  });
}

describe('shared gateway lifecycle',()=>{
  it('onboards a project-less standard account only once on production',async()=>{
    const request=scripted({':loadCodeAssist':{allowedTiers:[{id:'standard-tier'}]},':onboardUser':{done:true,response:{cloudaicompanionionProject:{}}}});
    const {connection}=account('antigravity',request);
    for(let n=0;n<5;n++)expect(await connection.ensureOnboarded()).toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    for(const [options]of request.mock.calls){expect(options.url).toMatch(/^https:\/\/cloudcode-pa.googleapis.com\/v1internal:/);expect(options.headers['User-Agent']).toBe('google-api-nodejs-client/9.15.1');expect(options.headers).not.toHaveProperty('X-Goog-Api-Client');}
  });
  it('uses the project returned by a bounded long-running operation',async()=>{
    const request=scripted({':loadCodeAssist':{allowedTiers:[{id:'standard-tier'}]},':onboardUser':{name:'operations/one'},'/operations/one':{done:true,response:{cloudaicompanionProject:{id:'project-1'}}}});
    const {connection}=account('antigravity',request);expect(await connection.ensureOnboarded()).toBe('project-1');expect(request).toHaveBeenCalledTimes(3);
    await connection.ensureOnboarded();expect(request).toHaveBeenCalledTimes(3);
  });
  it('does not turn a failed onboarding call into a cached success',async()=>{
    let failed=true;const request=scripted({':loadCodeAssist':()=>failed?Error('offline'):{currentTier:{id:'standard-tier'}}});
    const {connection}=account('antigravity',request);await connection.ensureOnboarded();failed=false;await connection.ensureOnboarded();await connection.ensureOnboarded();expect(request).toHaveBeenCalledTimes(2);
  });
  it('invalidates onboarding when project changes, and keeps connections independent',async()=>{
    const request=scripted({':loadCodeAssist':{currentTier:{id:'standard-tier'}}});
    const first=account('antigravity',request).connection,second=account('antigravity',request).connection;
    await first.ensureOnboarded();await second.ensureOnboarded();expect(request).toHaveBeenCalledTimes(2);
    first.saveGcpProject('new-project');await first.ensureOnboarded();await second.ensureOnboarded();expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[2][0].data.project).toBe('new-project');
  });
  it('keeps discovery on the model gateway and applies the soft quota floor',async()=>{
    const request=scripted({':loadCodeAssist':{currentTier:{id:'standard-tier'}},':fetchAvailableModels':{models:{test:{displayName:'Test',quotaInfo:{remainingFraction:0.05}}},agentModelSorts:[{groups:[{modelIds:['test']}]}]}});
    const {connection,httpClient}=account('antigravity',request);expect(await connection.fetchAvailableModels()).toHaveLength(1);
    const options=request.mock.calls[1][0];expect(options.url).toBe('https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels');expect(options.headers['User-Agent']).toContain('Antigravity/test-version');expect(options.headers).not.toHaveProperty('X-Goog-Api-Client');
    expect(connection.isCoolingDown()).toBe(true);expect(await connection.checkApiUsable()).toMatchObject({coolingDown:true});expect(httpClient.post).not.toHaveBeenCalled();
    await connection.logout();expect(await connection.checkApiUsable()).toMatchObject({available:false});expect(connection.isCoolingDown()).toBe(false);
  });
  it('a 200 health response does not mask missing entitlement',async()=>{
    const denied=Object.assign(Error('denied'),{response:{status:403,data:{error:{message:'You do not have a valid license (#3501)'}}}});
    const request=scripted({':loadCodeAssist':{currentTier:{id:'standard-tier'},cloudaicompanionProject:'project-1'},':retrieveUserQuota':denied});
    const {connection,httpClient}=account('gemini-cli',request);
    expect(await connection.checkApiUsable()).toMatchObject({available:true,apiUsable:false,unlicensed:true,deprecated:true,apiStatus:403,entitledModels:[]});expect(httpClient.post).toHaveBeenCalledTimes(1);
  });
  it('a transient entitlement failure retains availability and licensed models use the discovery identity',async()=>{
    const request=scripted({':loadCodeAssist':{currentTier:{id:'standard-tier'},cloudaicompanionProject:'project-1'},':retrieveUserQuota':()=>Error('offline')});
    const {connection}=account('gemini-cli',request);expect(await connection.checkApiUsable()).toMatchObject({apiUsable:true,entitledModels:[]});
    expect(request.mock.calls.at(-1)[0]).toMatchObject({url:'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',data:{project:'project-1'}});expect(request.mock.calls.at(-1)[0].headers['User-Agent']).toContain('GeminiCLI/test-version');
  });
  it.each(['gemini-cli','antigravity'])('builds the %s inference envelope and streams split UTF-8',async id=>{
    const packets=['data: {"response":{"candidates":[{"content":{"parts":[{"text":"héllo"}]}}]}}\n\n','data: [DONE]\n\n'];
    const request=vi.fn(async options=>options.responseType==='stream'?{data:Readable.from([...Buffer.from(packets.join(''))].map(byte=>Buffer.from([byte])))}:{data:{response:{candidates:[{content:{parts:[{text:'hello'},{functionCall:{name:'tool',args:{x:1}}}]}}]}}});
    const client=createGatewayClient(id,{request},'project-1'),params={model:'models/test-model',contents:[{role:'user',parts:[{text:'hi'}]}],config:{temperature:0,maxOutputTokens:64,topP:0,topK:1,thinkingConfig:{thinkingBudget:0},responseMimeType:'application/json',systemInstruction:'system',tools:[],toolConfig:{}}};
    const response=await client.models.generateContent(params);expect(response.text).toBe('hello');expect(response.functionCalls).toEqual([{name:'tool',args:{x:1}}]);
    const options=request.mock.calls[0][0];expect(options.data).toMatchObject({model:'test-model',project:'project-1',request:{contents:params.contents,generationConfig:{temperature:0,topP:0,maxOutputTokens:64,topK:1}}});
    if(id==='antigravity'){expect(options.data).toMatchObject({requestType:'agent',userAgent:'antigravity'});expect(options.headers['X-Goog-Api-Client']).toBe('google-cloud-sdk vscode_cloudshelleditor/0.1');expect(options.url).toContain('daily-cloudcode');}else{expect(options).not.toHaveProperty('headers');expect(options.data).not.toHaveProperty('requestType');expect(options.url).toBe('https://cloudcode-pa.googleapis.com/v1internal:generateContent');}
    const events=[];for await(const event of await client.models.generateContentStream(params))events.push(event);expect(events.map(event=>event.text)).toEqual(['héllo']);
  });
  it('streaming gateway errors trip the correct cooldown operation',async()=>{
    const connection=getConnection('antigravity'),trip=vi.spyOn(connection,'tripCooldown').mockImplementation(()=>{});
    const request=vi.fn(async()=>{throw Object.assign(Error('denied'),{response:{status:403}});});
    await expect(createGatewayClient('antigravity',{request}).models.generateContentStream({model:'test',contents:[]})).rejects.toThrow('access was denied');expect(trip).toHaveBeenCalledWith('streamGenerateContent HTTP 403');
  });
  it('cancels an underlying gateway stream when the consumer stops',async()=>{
    const source=Readable.from([Buffer.from('data: {"candidates":[]}\n\n'),Buffer.from('data: {"candidates":[]}\n\n')]);
    const iterator=await createGatewayClient('gemini-cli',{request:async()=>({data:source})}).models.generateContentStream({model:'test',contents:[]});for await(const event of iterator){expect(event.text).toBe('');break;}expect(source.destroyed).toBe(true);
  });
  it('catalog routing returns a cooldown without touching discovery or credentials',async()=>{
    const connection=getConnection('antigravity');vi.spyOn(connection,'isUsingApiKey').mockReturnValue(false);vi.spyOn(connection,'checkApiUsable').mockResolvedValue({available:true,coolingDown:true,retryAfterMs:10,hint:'wait'});const token=vi.spyOn(connection,'getAccessToken');
    expect(await listConnectionModels('antigravity')).toEqual({status:429,body:{success:false,coolingDown:true,retryAfterMs:10,error:'wait'}});expect(token).not.toHaveBeenCalled();
  });
});
