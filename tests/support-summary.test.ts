import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSupportSummary } from '../src/lib/supportSummary';
test('support summary exports only allowlisted aggregate fields and never source identifiers or notes', () => {
  const secret = 'PRIVATE-IDENTIFIER-PATH-AND-NOTES';
  const summary = buildSupportSummary({appVersion:'2.8.0',theme:'console',technicalDetails:false,density:'comfortable',background:'simple',auditEntries:[{status:'SUCCESS',id:secret,stderr:secret},{status:secret}],comparisons:[{classification:'REGRESSION',baseline:{notes:secret}}],sessionRaw:JSON.stringify([{id:secret,notes:secret}])});
  assert.equal(summary.audit.counts.SUCCESS,1);
  assert.equal(summary.audit.counts.UNKNOWN,1);
  assert.equal(summary.comparisons.counts.REGRESSION,1);
  assert.equal(summary.sessions.count,1);
  assert.equal(JSON.stringify(summary).includes(secret),false);
  const invalid = buildSupportSummary({appVersion:secret,theme:secret,density:{toString:()=> 'comfortable',toJSON:()=> secret},sessionRaw:'broken'});
  assert.equal(invalid.appearance.density,'UNKNOWN');
  assert.equal(invalid.sessions.count,null);
  assert.equal(JSON.stringify(invalid).includes(secret),false);
});
test('support aggregates are bounded, missing evidence is unavailable rather than zero', () => {
  assert.equal(buildSupportSummary({}).audit.availability,'UNAVAILABLE');
  const bounded = buildSupportSummary({auditEntries:Array.from({length:10001},()=>({status:'SUCCESS'})),sessionRaw:JSON.stringify(Array(21).fill({}))});
  assert.equal(bounded.audit.counts.SUCCESS,10000);
  assert.equal(bounded.audit.availability,'BOUNDED_TO_10000');
  assert.equal(bounded.sessions.availability,'UNAVAILABLE');
});
