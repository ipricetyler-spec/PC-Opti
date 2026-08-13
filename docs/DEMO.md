# Demo walkthrough

The dashboard screenshot in the project README is captured from the app's real local development build. It intentionally shows the pre-scan state because browser preview mode does not expose the Electron-only native bridge.

For a full Windows desktop walkthrough:

1. Run `npm install`, `npm test`, and `npm run electron:dev` from an elevated Windows terminal.
2. Select **Run verified scan**. Review the timestamp, elevation state, component errors, storage, startup, temporary-file, and memory-pressure evidence.
3. Open **Dynamic Eco-Balance**, refresh the inventory, and select a non-system process. Confirm the dialog explains the Windows EcoQoS action and the rollback limit before applying it.
4. Open **Local audit history** to inspect the exact recorded pre-action state and use **Restore** while the selected process still exists.
5. Open **Safe OS policies** to review the documented policy, the System Restore checkpoint requirement, and the exact rollback statement before choosing an action.

No demo step should claim an FPS gain or a successful system change without the corresponding local audit entry.
