import { test } from 'node:test';
import assert from 'node:assert/strict';
import { friendlyError } from '../src/lib/friendlyError';

// Real messages seen on the owner's PC.
const RETRIM = "Optimize-Volume : Access denied Activity ID: {b9ffdfb8-3e03-000e-a760-08ba033edd01} At line:1 char:1 + Optimize-Volume -DriveLetter 'E' -ReTrim -Verbose -ErrorAction Stop | ... + CategoryInfo : PermissionDenied: (StorageWMI:ROOT/Microsoft/...age/MSFT_Volume) [Optimize-Volume], CimException + FullyQualifiedErrorId : StorageWMI 40001,Optimize-Volume";
const MISSING = "ENOENT: no such file or directory, lstat 'C:\\Users\\user\\AppData\\Roaming\\pc-opti\\presentmon-captures\\4237e701.csv'";
const MODULE = "Get-AuthenticodeSignature : The 'Get-AuthenticodeSignature' command was found in the module 'Microsoft.PowerShell.Security', but the module could not be loaded. + FullyQualifiedErrorId : CouldNotAutoloadMatchingModule";

test('raw Windows errors become one plain sentence, and the original is kept', () => {
  const retrim = friendlyError(RETRIM);
  assert.match(retrim.message, /not running as administrator\. Reopen Dialed as administrator/);
  assert.equal(retrim.technical, RETRIM);
  assert.match(friendlyError(MISSING).message, /file Dialed needed was missing/);
  assert.match(friendlyError(MODULE).message, /part of Windows that Dialed uses could not be loaded/);
});

test("Dialed's own plain messages pass through unchanged, even when they mention administrator rights", () => {
  for (const plain of [
    'Machine-wide entry: Dialed must be running as administrator.',
    'Windows did not confirm the change. Check Restore › Recovery & history before trying again.',
    'The update check failed. Nothing was downloaded.',
  ]) assert.deepEqual(friendlyError(plain), { message: plain, technical: null });
});

test('unrecognised raw output still gets a plain first line', () => {
  const raw = 'Set-ItemProperty : Something odd happened. At line:3 char:5 + FullyQualifiedErrorId : Weird,Microsoft.PowerShell.Commands.SetItemPropertyCommand';
  assert.deepEqual(friendlyError(raw), { message: 'Windows reported a problem with this step.', technical: raw });
  assert.deepEqual(friendlyError(''), { message: '', technical: null });
  assert.deepEqual(friendlyError(null), { message: '', technical: null });
});

test('the other common causes each get their own sentence', () => {
  assert.match(friendlyError('EBUSY: resource busy or locked, open C:\\x').message, /Another program is using that file/);
  assert.match(friendlyError('Error: connect ETIMEDOUT 1.2.3.4:443').message, /took too long|could not reach/);
  assert.match(friendlyError('getaddrinfo ENOTFOUND speed.cloudflare.com').message, /could not reach the server/);
  assert.match(friendlyError('ENOSPC: no space left on device, write').message, /drive is full/);
});
