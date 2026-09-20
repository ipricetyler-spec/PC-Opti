/**
 * Turns raw Windows, PowerShell and file-system errors into one plain sentence that says
 * what happened and what to do. Dialed's own messages are already plain and pass through
 * unchanged; only text that is clearly raw system output is rewritten. The original is
 * always kept, so nothing is lost for troubleshooting.
 */
export interface FriendlyError {
  message: string;
  /** The original text, when it was rewritten. */
  technical: string | null;
}

// Signs that text came straight from Windows, PowerShell or Node rather than from Dialed.
const RAW = /(At line:\d|CategoryInfo|FullyQualifiedErrorId|\w+Exception\b|\bE(NOENT|ACCES|PERM|BUSY|NOSPC|TIMEDOUT|CONNREFUSED|CONNRESET|NOTFOUND)\b|\{[0-9a-f-]{20,}\}|\bat [\w.<>]+ \(|0x[0-9a-f]{6,}|HRESULT|\blstat\b|\berrno\b|StorageWMI|CimException|^[A-Z][\w-]+ : )/i;

const RULES: Array<[RegExp, string]> = [
  [/Access (is )?denied|PermissionDenied|UnauthorizedAccess|\bEACCES\b|\bEPERM\b|requested registry access is not allowed|requires elevation/i,
    'Windows refused this because Dialed was not running as administrator. Reopen Dialed as administrator and try again.'],
  [/\bENOENT\b|no such file or directory|cannot find (the )?(path|file)|does not exist/i,
    'A file Dialed needed was missing. It may have been moved or deleted.'],
  [/\bEBUSY\b|being used by another process|sharing violation/i,
    'Another program is using that file. Close it and try again.'],
  [/\bENOSPC\b|not enough (disk )?space|disk (is )?full/i,
    'The drive is full. Free up some space and try again.'],
  [/timed? ?out|\bETIMEDOUT\b/i,
    'Windows took too long to answer, so Dialed stopped waiting. Try again.'],
  [/CouldNotAutoloadMatchingModule|CommandNotFoundException|is not recognized as the name of a cmdlet|module could not be loaded/i,
    'A part of Windows that Dialed uses could not be loaded. Restart Dialed; if it happens again, restart Windows.'],
  [/\bENOTFOUND\b|\bECONNREFUSED\b|\bECONNRESET\b|getaddrinfo|network is unreachable/i,
    'Dialed could not reach the server. Check your internet connection and try again.'],
];

// Dialed's own plain sentences often arrive wrapped in layers of machinery: Electron's IPC
// wrapper around PowerShell's "Exception calling ..." around the message the helper actually
// wrote. Pull that innermost sentence back out, so a message written for the reader is not
// hidden behind a stack trace it happens to be quoted inside.
const WRAPPERS: RegExp[] = [
  /Exception calling "[^"]+" with "\d+" argument\(s\): "([\s\S]*?)"(?=\s*(?:At line:\d|$))/i,
  /Error invoking remote method '[^']*': (?:\w*Error: )?([\s\S]*?)(?=\s*(?:At line:\d|$))/i,
];

function wrappedMessage(text: string): string | null {
  for (const pattern of WRAPPERS) {
    const found = pattern.exec(text)?.[1]?.trim();
    // Only worth surfacing if what's inside is itself plain — otherwise it's more machinery.
    if (found && found.length <= 260 && !RAW.test(found)) return found;
  }
  return null;
}

export function friendlyError(raw: string | null | undefined): FriendlyError {
  const text = (raw ?? '').trim();
  if (!text) return { message: '', technical: null };
  const isRaw = RAW.test(text) || text.length > 260;
  if (!isRaw) return { message: text, technical: null };
  // A specific rule beats the original wording: it says what to do about it.
  for (const [pattern, message] of RULES) {
    if (pattern.test(text)) return { message, technical: text };
  }
  const inner = wrappedMessage(text);
  if (inner) return { message: inner, technical: text };
  return { message: 'Windows reported a problem with this step.', technical: text };
}

const PART_NAMES: Record<string, string> = {
  processInventory: 'Running programs',
  startupItems: 'Startup programs',
  policyInventory: 'Windows policies',
  tempFiles: 'Temporary files',
  storageHealth: 'Drive health',
  networkAdapters: 'Network adapters',
  gameDvr: 'Game Bar recording',
  antiCheat: 'Anti-cheat',
  powerScheme: 'Power plan',
  pageFile: 'Page file',
  secureBoot: 'Secure Boot',
  tpm: 'TPM',
  cpu: 'Processor',
  os: 'Windows',
};

/** The part of Dialed or Windows an error came from, in words: 'processInventory' → 'Running programs'. */
export function partName(component: string): string {
  if (PART_NAMES[component]) return PART_NAMES[component];
  const words = component.replace(/[._-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Unknown';
}
