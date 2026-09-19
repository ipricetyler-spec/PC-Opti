import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSessions, previewSessionImport, sessionPairIssue, selectedSessionId, sessionCaptureIds, sameCaptureGroup, recoverSessionStorage, SESSION_KEY, SESSION_RECOVERY_KEY, type ExperimentSession } from '../src/lib/experimentSessions';
const session: ExperimentSession = {id:'session-fixture',workload:'Replay',changeDescription:'One change',createdAt:'2026-09-05T01:00:00Z',baselineId:'before',candidateId:'after',auditId:'action',decision:'UNDECIDED'};
const captures = [
  {captureId:'before',status:'COMPLETE',protocolComplete:true,startedAt:'2026-09-05T01:01:00Z',completedAt:'2026-09-05T01:01:10Z',durationSeconds:10,stopReason:'TIMED',target:{name:'fixture'}},
  {captureId:'after',status:'COMPLETE',protocolComplete:true,startedAt:'2026-09-05T01:03:00Z',completedAt:'2026-09-05T01:03:10Z',durationSeconds:10,stopReason:'TIMED',target:{name:'fixture'}},
];
test('session progress round trips without treating a decision as operation authority',()=>{
  assert.deepEqual(parseSessions(JSON.stringify([session])),[session]);
  assert.throws(()=>parseSessions(JSON.stringify([session,session])),/identity/);
  assert.throws(()=>parseSessions(JSON.stringify([{...session,candidateId:'before'}])),/both/);
  assert.throws(()=>parseSessions('invalid'));
});
test('session requires current, matched, completed and chronological evidence',()=>{
  const audit=[{id:'action',status:'SUCCESS',timestamp:'2026-09-05T01:02:00Z'}];
  assert.equal(sessionPairIssue(session,captures,audit),null);
  assert.match(sessionPairIssue(session,[captures[0],{...captures[1],protocolComplete:false}],audit)!,/verified duration/);
  assert.match(sessionPairIssue(session,captures,[{...audit[0],timestamp:'invalid'}])!,/between/);
  assert.match(sessionPairIssue(session,captures,[{id:'action',status:'SUCCESS'}])!,/between/);
  assert.match(sessionPairIssue(session,[],audit)!,/missing|Missing/);
  assert.match(sessionPairIssue(session,captures,[])!,/successful/);
  assert.match(sessionPairIssue(session,[captures[0],{...captures[1],stopReason:'USER'}],audit)!,/timed/);
  assert.match(sessionPairIssue(session,[captures[0],{...captures[1],durationSeconds:20}],audit)!,/duration/);
  assert.match(sessionPairIssue(session,captures,[{...audit[0],timestamp:'2026-09-05T01:04:00Z'}])!,/between/);
});


test('remembered selection follows an existing session and falls back after deletion', () => {
  const second = {...session,id:'session-second'};
  assert.equal(selectedSessionId([session,second],second.id),second.id);
  assert.equal(selectedSessionId([session],second.id),session.id);
  assert.equal(selectedSessionId([],second.id),'');
});
test('corrupt-data recovery preserves exact bytes before replacing the active list', () => {
  const raw = '{unreadable session notes';
  const data = new Map([[SESSION_KEY,raw]]);
  recoverSessionStorage({getItem: (key) => data.get(key) ?? null,setItem: (key,value) => { data.set(key,value); }});
  assert.equal(data.get(SESSION_RECOVERY_KEY),raw);
  assert.deepEqual(parseSessions(data.get(SESSION_KEY)!),[]);
});
test('failed recovery backup cannot overwrite the original saved sessions', () => {
  const raw = '{valuable unreadable notes';
  const writes: string[] = [];
  assert.throws(() => recoverSessionStorage({getItem: (key) => key === SESSION_KEY ? raw : null,setItem: (key) => { writes.push(key); throw new Error('quota'); }}),/quota/);
  assert.deepEqual(writes,[SESSION_RECOVERY_KEY]);
});
test('failed active-store reset leaves both original and recovery backup intact', () => {
  const raw = '{original';
  const data = new Map([[SESSION_KEY,raw]]);
  assert.throws(() => recoverSessionStorage({getItem: (key) => data.get(key) ?? null,setItem: (key,value) => { if (key === SESSION_KEY) throw new Error('write failed'); data.set(key,value); }}),/write failed/);
  assert.equal(data.get(SESSION_KEY),raw);
  assert.equal(data.get(SESSION_RECOVERY_KEY),raw);
});

test('recovery refuses to overwrite an older distinct backup', () => {
  const data = new Map([[SESSION_KEY,'current corrupt'],[SESSION_RECOVERY_KEY,'older corrupt']]);
  assert.throws(() => recoverSessionStorage({getItem: (key) => data.get(key) ?? null,setItem: (key,value) => { data.set(key,value); }}),/older recovery backup/);
  assert.equal(data.get(SESSION_KEY),'current corrupt');
  assert.equal(data.get(SESSION_RECOVERY_KEY),'older corrupt');
});

test('manual changes require explicit declaration and never fabricate an audit action', () => {
  const manual: ExperimentSession = {...session,changeMode:'MANUAL',manualChangedAt:'2026-09-05T01:02:00Z',auditId:''};
  assert.deepEqual(parseSessions(JSON.stringify([manual])),[manual]);
  assert.equal(sessionPairIssue(manual,captures,[]),null);
  assert.match(sessionPairIssue({...manual,manualChangedAt:''},captures,[])!,/Declare when/);
  assert.match(sessionPairIssue({...manual,manualChangedAt:captures[0].completedAt},captures,[])!,/between/);
  assert.match(sessionPairIssue({...manual,manualChangedAt:captures[1].startedAt},captures,[])!,/between/);
  assert.match(sessionPairIssue({...manual,auditId:'action'},captures,[])!,/cannot claim/);
  assert.throws(() => parseSessions(JSON.stringify([{...manual,auditId:'action'}])),/cannot claim/);
  assert.throws(() => parseSessions(JSON.stringify([{...manual,changeMode:undefined}])),/explicit manual mode/);
  assert.throws(() => parseSessions(JSON.stringify([{...manual,manualChangedAt:'invalid'}])),/timestamp/);
  assert.throws(() => parseSessions(JSON.stringify([{...manual,changeMode:'IMPLIED'}])),/mode/);
});

test('multi-run sessions round trip and require every capture in both comparison groups', () => {
  const grouped: ExperimentSession = {...session,baselineIds:['before','b2','b3'],candidateIds:['after','a2','a3']};
  assert.deepEqual(parseSessions(JSON.stringify([grouped])),[grouped]);
  assert.deepEqual(sessionCaptureIds(session,'baseline'),['before']);
  assert.equal(sameCaptureGroup(['b3','before','b2'],grouped.baselineIds!),true);
  assert.equal(sameCaptureGroup(['before'],grouped.baselineIds!),false);
  assert.equal(sameCaptureGroup(['before','b2','b2'],grouped.baselineIds!),false);
  assert.throws(() => parseSessions(JSON.stringify([{...grouped,baselineIds:['other','b2','b3']} ])),/legacy/);
  assert.throws(() => parseSessions(JSON.stringify([{...grouped,candidateIds:['after','b2','a3']} ])),/distinct/);
});
test('all runs bracket one declared or saved change and use matched protocols', () => {
  const rows = [1,2,3,5,6,7].map((minute,index) => ({...captures[0],captureId:`run-${index}`,startedAt:`2026-09-05T01:0${minute}:00Z`,completedAt:`2026-09-05T01:0${minute}:10Z`}));
  const grouped: ExperimentSession = {...session,baselineId:'run-0',candidateId:'run-3',baselineIds:['run-0','run-1','run-2'],candidateIds:['run-3','run-4','run-5']};
  const audit=[{id:'action',status:'SUCCESS',timestamp:'2026-09-05T01:04:00Z'}];
  assert.equal(sessionPairIssue(grouped,rows,audit),null);
  assert.equal(sessionPairIssue({...grouped,changeMode:'MANUAL',auditId:'',manualChangedAt:audit[0].timestamp},rows,[]),null);
  assert.match(sessionPairIssue(grouped,rows,[{...audit[0],timestamp:'2026-09-05T01:02:30Z'}])!,/between/);
  assert.match(sessionPairIssue({...grouped,candidateIds:['run-3','run-4']},rows,audit)!,/at least three/);
  assert.match(sessionPairIssue(grouped,rows.slice(0,-1),audit)!,/Missing/);
  assert.match(sessionPairIssue(grouped,rows.map((row,index) => index === 5 ? {...row,protocolComplete:false} : row),audit)!,/verified duration/);
  assert.match(sessionPairIssue(grouped,rows.map((row,index) => index === 5 ? {...row,durationSeconds:30} : row),audit)!,/duration/);
  assert.match(sessionPairIssue(grouped,rows.map((row,index) => index === 5 ? {...row,target:{name:'other'}} : row),audit)!,/target/);
  assert.match(sessionPairIssue({...grouped,baselineIds:Array.from({length:18},(_,index) => `extra-${index}`)},rows,audit)!,/20/);
});

test('archive state round trips without losing linked evidence and restores reversibly', () => {
 const archived={...session,archived:true};
 assert.deepEqual(parseSessions(JSON.stringify([archived])),[archived]);
 const restored=parseSessions(JSON.stringify([{...archived,archived:false}]))[0];
 assert.equal(restored.archived,false);
 assert.equal(restored.baselineId,session.baselineId);
 assert.equal(restored.auditId,session.auditId);
 assert.throws(()=>parseSessions(JSON.stringify([{...session,archived:'yes'}])),/archive/);
});
test('import preview merges new IDs, discards unknown fields, resets imported decisions and preserves archives', () => {
 const raw=JSON.stringify([{...session,id:'session-imported',decision:'KEEP',archived:true,unsafeAction:'execute'}]);
 const original=[{...session,decision:'KEEP' as const}];
 const preview=previewSessionImport(original,raw);
 assert.equal(preview.added,1);assert.equal(preview.skipped,0);
 assert.equal(preview.sessions[0].decision,'KEEP');
 assert.equal(preview.sessions[1].decision,'UNDECIDED');
 assert.equal(preview.sessions[1].archived,true);
 assert.equal('unsafeAction' in preview.sessions[1],false);
 assert.deepEqual(original,[{...session,decision:'KEEP'}]);
});
test('import preview skips identical IDs but rejects conflicts without overwriting', () => {
 const identical=previewSessionImport([session],JSON.stringify([{...session,decision:'KEEP'}]));
 assert.equal(identical.added,0);assert.equal(identical.skipped,1);
 assert.throws(()=>previewSessionImport([session],JSON.stringify([{...session,workload:'different'}])),/different content/);
 assert.throws(()=>previewSessionImport([],JSON.stringify([session,session])),/identity/);
 assert.throws(()=>previewSessionImport([], 'x'.repeat(64001)),/supported size/);
 const full=Array.from({length:20},(_,index)=>({...session,id:`session-${index}`}));
 assert.throws(()=>previewSessionImport(full,JSON.stringify([session])),/could not be read/);
});
