import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingDevicesNotice } from '../src/lib/setupNotice';

test('the not-connected notice names the device and says what to do first', () => {
  assert.equal(missingDevicesNotice(1, ['DualSense Edge Wireless Controller']),
    "DualSense Edge Wireless Controller isn't connected. Setup recorded its original settings. Plug it back into the same USB port before you restore them or change its rate.");
  assert.match(missingDevicesNotice(2, ['DualSense Edge Wireless Controller', 'Razer Viper V2 Pro']), /^DualSense Edge Wireless Controller and Razer Viper V2 Pro aren't connected\. Setup recorded their original settings\./);
  // Without a name it still says which kind of device, never a guess.
  assert.match(missingDevicesNotice(1, []), /^A device whose original settings setup recorded isn't connected\./);
  assert.match(missingDevicesNotice(3, ['Only one name']), /^3 devices whose original settings setup recorded aren't connected\./);
});
