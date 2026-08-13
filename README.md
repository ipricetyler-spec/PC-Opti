# PC-Opti

PC-Opti is a local-first Windows 10/11 diagnostics and maintenance utility built around verifiable system telemetry, explicit actions, and deterministic rollback.

The current source is distributed in [pc-optimizer (1).zip](./pc-optimizer%20(1).zip). Extract it, then run the app from the `pc-optimizer` directory.

## Safe feature set

- Native Windows system, storage, startup, and temporary-file telemetry.
- Dynamic Eco-Balance, which can apply reversible Windows EcoQoS to a selected non-system process in the current user session.
- Current-user startup management with an exact Registry-value rollback.
- A documented `DisableWindowsConsumerFeatures` policy control that requests a System Restore checkpoint before applying and retains its prior policy state for rollback.
- Local audit history for every supported configuration change.
- Actionable memory-pressure guidance without unsafe RAM cleaners or forced memory flushing.

PC-Opti intentionally does not provide registry cleaners, generic driver updaters, RAM flushers, process termination, forced service disabling, or destructive debloat scripts.

## Build

```powershell
npm install
npm run lint
npm run electron:build
```

The packaged Electron app may request administrator rights for supported Windows maintenance and policy operations. It never sends system telemetry to a cloud service for these native actions.

## Development

```powershell
npm run build
npm run electron:dev
```
