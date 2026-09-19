const path = require('node:path');
const { verifyBundledInventory } = require('../src/main/input-driver-lifecycle/bundled-inventory.cjs');
console.log(JSON.stringify(verifyBundledInventory(path.resolve(__dirname, '../vendor/hidusbf')), null, 2));
