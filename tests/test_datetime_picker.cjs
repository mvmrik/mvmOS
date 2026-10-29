// Run with: node --test tests/test_datetime_picker.cjs
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../frontend/datetime-picker.js'), 'utf8');
function picker(settings = {}, profile = {}) {
  const requests=[];
  const context={window:{mvmOS:{lang:'en'},_vosSettings:settings},localStorage:{getItem:()=> 'test-token'},Intl,Date,
    fetch:async url=>{requests.push(url);return {ok:true,json:async()=>url.includes('/me')?profile:{timezone:'Europe/Sofia',date_format:'DD/MM/YYYY',time_format:'24',week_starts:'monday'}};}};
  vm.runInNewContext(source,context);
  return {api:context.window.mvmOS.dateTimePicker,context,requests};
}
test('all regional formats are explicit and independent of the browser locale',()=>{
  const {api}=picker({date_format:'DD/MM/YYYY',time_format:'24',timezone:'Europe/Sofia'});
  assert.equal(api.format('2026-10-29T15:07'),'29/10/2026 15:07');
  assert.equal(api.format('2026-10-29',{type:'date',dateFormat:'YYYY-MM-DD'}),'2026-10-29');
  assert.equal(api.format('2026-10-29T15:07',{dateFormat:'MM/DD/YYYY',timeFormat:12}),'10/29/2026 3:07 PM');
  assert.equal(api.format('00:05',{type:'time'}),'00:05');
});
test('rejects invalid dates and clocks without normalizing them to a different day',()=>{
  const {api}=picker();
  for(const v of ['2026-02-29T12:00','2026-04-31T12:00','2026-13-01T12:00','2026-10-29T24:00','2026-10-29T12:60','invalid'])assert.equal(api.toEpoch(v),null,v);
  assert.equal(api.toEpoch('2024-02-29',{type:'date',timeZone:'UTC'}),Date.parse('2024-02-29T00:00Z')/1000);
  assert.equal(api.toEpoch('15:07',{type:'time'}),null);
});
test('converts using the selected zone and handles both DST transitions',()=>{
  const {api}=picker({timezone:'Europe/Sofia'});
  assert.equal(api.toEpoch('2026-03-29T03:30'),null);
  assert.equal(api.toEpoch('2026-10-25T03:30'),Date.parse('2026-10-25T00:30Z')/1000);
  assert.equal(api.fromEpoch(api.toEpoch('2026-10-29T15:07')),'2026-10-29T15:07');
  assert.equal(api.toEpoch('2026-10-29T15:07',{timeZone:'Asia/Kolkata'}),Date.parse('2026-10-29T09:37Z')/1000);
});
test('public preferences override installation formats while desktop settings take precedence',async()=>{
  const {api,context,requests}=picker(undefined,{date_format:'MM/DD/YYYY',time_format:'12'});
  delete context.window._vosSettings;
  await api.ready();
  assert.equal(api.format('2026-10-29T15:07'),'10/29/2026 3:07 PM');
  context.window._vosSettings={date_format:'YYYY-MM-DD',time_format:'24'};
  assert.equal(api.format('2026-10-29T15:07'),'2026-10-29 15:07');
  await api.ready();assert.equal(requests.length,2);
});
