const test = require('node:test');
const assert = require('node:assert/strict');
const wifi = require('../src/main/wifi-status/index.cjs');

const fake = (stdout) => async () => ({ stdout });

test('a location-permission answer is named as such, not as a missing Wi-Fi adapter', async () => {
  // Windows 11 24H2 while Location is off.
  const notice = 'Network shell commands need location permission to access WLAN information. Turn on Location services on the Location page in Privacy & security settings.\r\n\r\nHere is the URI for the Location page in the Settings app:\r\nms-settings:privacy-location\r\n';
  const report = await wifi.readWifiStatus(fake(notice));
  assert.equal(report.status, 'UNAVAILABLE');
  assert.match(report.reason, /while Location is on/);
  assert.match(report.reason, /Dialed does not change this setting/);
  // The settings link is recognised whatever the display language.
  assert.match((await wifi.readWifiStatus(fake('Netzwerkshellbefehle benötigen eine Standortberechtigung.\r\nms-settings:privacy-location\r\n'))).reason, /while Location is on/);
});

test('a PC without Wi-Fi is told so plainly; unreadable output stays hedged', async () => {
  // As read on the owner's desktop.
  assert.deepEqual((({ status, reason }) => ({ status, reason }))(await wifi.readWifiStatus(fake('There is no wireless interface on the system.\r\n'))), { status: 'NO_WIFI', reason: 'This PC has no Wi-Fi adapter.' });
  assert.match((await wifi.readWifiStatus(fake('Es gibt keine Drahtlosschnittstelle.'))).reason, /language Dialed cannot read yet/);
});
