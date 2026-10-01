import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainSettingName, plainSettingValue } from '../src/lib/gameSettingNames';

test('profile settings read as the game menus name them, and unknown keys stay as they are', () => {
  assert.equal(plainSettingName('sg.ShadowQuality'), 'Shadows');
  assert.equal(plainSettingName('MotionBlur'), 'Motion blur');
  assert.equal(plainSettingName('sg.SomethingNew'), 'sg.SomethingNew');
  assert.equal(plainSettingValue('sg.EffectsQuality', '0'), 'Low');
  assert.equal(plainSettingValue('sg.EffectsQuality', '3'), 'Epic');
  assert.equal(plainSettingValue('sg.EffectsQuality', '9'), '9');
  assert.equal(plainSettingValue('MotionBlur', 'False'), 'Off');
  assert.equal(plainSettingValue('DynamicShadows', 'True'), 'On');
  assert.equal(plainSettingValue('MotionBlur', ''), 'Not set');
});
