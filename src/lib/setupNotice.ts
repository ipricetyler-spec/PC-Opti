// The Input devices notice for devices whose originals setup recorded but that are not connected.
// It names the device when setup's record has its name and says plainly what to do first.
export function missingDevicesNotice(count: number, names: string[]): string {
  const one = count === 1;
  const who = names.length === count && count > 0
    ? (one ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)
    : one ? 'A device whose original settings setup recorded' : `${count} devices whose original settings setup recorded`;
  return one
    ? `${who} isn't connected. Setup recorded its original settings. Plug it back into the same USB port before you restore them or change its rate.`
    : `${who} aren't connected. Setup recorded their original settings. Plug each one back into the same USB port before you restore those settings or change a rate.`;
}
