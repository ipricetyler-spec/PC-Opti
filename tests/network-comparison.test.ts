import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareNetworkRuns, parseNetworkContexts } from '../src/lib/networkComparison';
import type { NetworkQualityHistoryEntry } from '../src/types';
const before: NetworkQualityHistoryEntry = {id:'before',completedAt:'2026-09-05T01:00:00Z',status:'COMPLETE',endpointId:'cloudflare-warmed-http-v2-quick',methodVersion:'warmed-https-v2',mode:'quick',quality:'SUFFICIENT',metrics:{idleLatencyMs:0,idleJitterMs:0,idleP90Ms:1,idleVariabilityMs:1,requestFailurePercent:0,downloadLoadedLatencyMs:null,downloadLoadedLatencyIncreaseMs:null,uploadLoadedLatencyMs:null,uploadLoadedLatencyIncreaseMs:null,downloadMbps:10,uploadMbps:0}};
const after = {...before,id:'after',metrics:{...before.metrics,idleLatencyMs:2,downloadMbps:12}};
const notes = {adapter:'Ethernet',vpn:'none',background:'idle'};
test('network comparison retains zero, keeps missing metrics unavailable and rejects unmatched protocols or declarations', () => {
  const contexts = {before:notes,after:notes};
  assert.deepEqual(compareNetworkRuns(before,after,contexts).deltas,{idleMs:2,downloadLoadedMs:null,uploadLoadedMs:null,downloadMbps:2,uploadMbps:0});
  assert.ok(compareNetworkRuns(undefined,after,contexts).issue);
  assert.ok(compareNetworkRuns(before,before,contexts).issue);
  assert.ok(compareNetworkRuns(before,{...after,status:'PARTIAL'},contexts).issue);
  assert.ok(compareNetworkRuns(before,{...after,endpointId:'unknown'},contexts).issue);
  assert.ok(compareNetworkRuns(before,{...after,mode:'full'},contexts).issue);
  assert.ok(compareNetworkRuns(before,{...after,quality:'INSUFFICIENT'},contexts).issue);
  assert.ok(compareNetworkRuns(before,{...after,methodVersion:'legacy-v1',mode:'legacy',quality:'LEGACY'},contexts).issue);
  assert.ok(compareNetworkRuns(before,after,{}).issue);
  assert.ok(compareNetworkRuns(before,after,{...contexts,after:{...notes,vpn:'enabled'}}).issue);
  assert.ok(compareNetworkRuns(before,after,{...contexts,after:{...notes,background:''}}).issue);
});
test('network condition persistence is bounded and rejects corrupt or unexpected fields', () => {
  assert.deepEqual(parseNetworkContexts(JSON.stringify({before:notes})),{before:notes});
  assert.throws(() => parseNetworkContexts('{'));
  assert.throws(() => parseNetworkContexts(JSON.stringify({before:{...notes,extra:'x'}})));
  assert.throws(() => parseNetworkContexts(JSON.stringify({before:{...notes,adapter:'x'.repeat(241)}})));
  assert.throws(() => parseNetworkContexts(JSON.stringify(Object.fromEntries(Array.from({length:21},(_,i) => [`run${i}`,notes])))));
});
