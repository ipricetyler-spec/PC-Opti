# Security policy

## Supported scope

Security reports are welcome for the current `main` branch and the latest released version of PC-Opti.

The highest-priority reports involve privilege escalation, unsafe Windows configuration changes, process-management scope escapes, command injection, local data exposure, or rollback failures.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private security-advisory form for this repository, or contact the maintainer through the repository owner profile with:

- a concise impact statement;
- affected version and Windows version;
- minimal reproduction steps or proof of concept;
- expected versus observed behavior; and
- any suggested mitigation.

We will acknowledge receipt, investigate privately, and coordinate a fix before public disclosure when practical. Do not run destructive commands against systems you do not own or have permission to test.

## Security boundaries

PC-Opti deliberately limits its native actions. It does not terminate processes, modify core Windows services, remove system packages, clean the Registry, or retrieve drivers. Privileged operations must validate their targets, capture rollback state where applicable, and create an audit-journal entry.

The optional AI audit is separate from native maintenance. It is requested only from the UI and is unavailable unless the local service has a configured API key; never put API keys in commits or issue reports.
