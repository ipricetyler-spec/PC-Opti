const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const b=require('../src/main/benchmarks/index.cjs');
function fixture(count=6){
 const sources=Array.from({length:count},(_,i)=>({format:'PRESENTMON',sourceId:crypto.randomUUID(),metricColumn:'FrameTime',unit:'ms',direction:'LOWER_IS_BETTER',capturedAt:'2026-09-05T00:00:00Z',applications:[{application:'Fixture.exe',samples:i<3?[9,10,11]:[8,9,10]}]}));
 const metadata={experimentId:'repeated-native',workload:'replay',toolVersion:'2.5.1',changeDescription:'one setting',conditions:Object.fromEntries(b.CONDITION_FIELDS.map(k=>[k,'declared'])),runs:sources.map((s,i)=>({sourceId:s.sourceId,application:'Fixture.exe',phase:i<3?'BASELINE':'CANDIDATE',variant:i<3?'before':'after'}))};
 return {sources,metadata};
}
test('six native-style captures aggregate one mean per run with unique identities',()=>{
 const {sources,metadata}=fixture();const records=b.createPresentMonRecords(sources,metadata);
 assert.equal(records.length,2);assert.equal(records[0].sampleUnit,'TRIAL');
 assert.deepEqual(records[0].samples,[10,10,10]);assert.deepEqual(records[1].samples,[9,9,9]);
 assert.deepEqual(records[0].trialIds,sources.slice(0,3).map(s=>s.sourceId));
 assert.deepEqual(sources[0].applications[0].samples,[9,10,11]);
});
test('grouping refuses insufficient phase runs, duplicates and differing applications',()=>{
 const {sources,metadata}=fixture();metadata.runs[2].phase='CANDIDATE';
 assert.throws(()=>b.createPresentMonRecords(sources,metadata),/three runs/);
 metadata.runs[2].phase='BASELINE';metadata.runs[5].sourceId=sources[0].sourceId;
 assert.throws(()=>b.createPresentMonRecords(sources,metadata),/exactly once/);
 metadata.runs[5].sourceId=sources[5].sourceId;sources[5].applications[0].application='Other.exe';metadata.runs[5].application='Other.exe';
 assert.throws(()=>b.createPresentMonRecords(sources,metadata),/same application/);
});
test('native recorded timestamps cannot be replaced by renderer metadata',()=>{
 const {sources,metadata}=fixture();
 for(const source of sources){source.nativeCaptureId=source.sourceId;source.toolVersion='2.5.1';}
 for(const run of metadata.runs)run.capturedAt='2099-01-01T00:00:00Z';
 const records=b.createPresentMonRecords(sources,metadata);
 assert.equal(records[0].capturedAt,'2026-09-05T00:00:00.000Z');
});
test('capture history selects newest valid manifests after ordering, with bounded inventory',()=>{
 const p=require('../src/main/presentmon/index.cjs');const path=require('node:path');
 const records=Array.from({length:105},(_,i)=>({schemaVersion:p.CAPTURE_SCHEMA_VERSION,captureId:crypto.randomUUID(),status:'COMPLETE',startedAt:new Date(1700000000000+i*1000).toISOString()}));
 const map=new Map(records.map(r=>[r.captureId+'.json',r]));
 const fileSystem={lstatSync:()=>({isDirectory:()=>true,isSymbolicLink:()=>false,isFile:()=>true,size:100}),readdirSync:()=>[...map.keys()].map(name=>({name,isFile:()=>true})),readFileSync:f=>JSON.stringify(map.get(path.basename(f)))};
 const history=p.readCaptureManifests('/fixture',fileSystem);
 assert.equal(history.length,p.MAX_CAPTURE_COUNT);assert.equal(history[0].captureId,records[104].captureId);
 fileSystem.readdirSync=()=>Array.from({length:10001},()=>({name:crypto.randomUUID()+'.json',isFile:()=>true}));
 assert.throws(()=>p.readCaptureManifests('/fixture',fileSystem),/safe read limit/);
});

test('repeated manual sessions retain their declared timestamp without an audit identity',()=>{
 const {sources,metadata}=fixture();
 const declaration='User-declared manual change at 2026-09-05T01:04:00Z. Not verified by Dialed; no automatic restore.';
 for(const run of metadata.runs){run.notes=declaration;run.linkedAuditEntryId=null;}
 const records=b.createPresentMonRecords(sources,metadata);
 for(const record of records){
  assert.ok(record.notes.includes(declaration));
  assert.match(record.notes,/One mean frame time/);
  assert.equal(record.notes.split(declaration).length-1,1);
  assert.equal(record.linkedAuditEntryId,null);
  assert.ok(record.notes.length<=500);
 }
});
test('grouped notes reject overflow instead of silently losing declarations',()=>{
 const {sources,metadata}=fixture();
 for(const run of metadata.runs)run.notes='x'.repeat(500);
 assert.throws(()=>b.createPresentMonRecords(sources,metadata),/Combined repeated-run notes/);
});
