# Local working agreement

## Executable for checking changes

The user checks application changes at:

`C:\Users\brandon.lepore\invoice\src-tauri\target\release\invoice.exe`

After changing application source, finish the relevant checks and rebuild this
release executable before reporting the change as available. A debug build or
frontend-only build does not update this path. If rebuilding fails, report the
blocker and explicitly say that the release executable is not current.

From `C:\Users\brandon.lepore\invoice`, run:

```powershell
bun run build:release
```

This package script uses `scripts/native.mjs` and the configured local Windows
toolchain to run Tauri's release build with `--no-bundle -- --locked`. Tauri first
runs the configured frontend build, then builds the native executable. It does
not create or update an installer. Confirm the command succeeds and the executable
at the exact path above is updated. Do not copy a debug executable into this path.

If a running instance prevents replacement, ask the user to save their work and
close it; do not terminate an instance that may contain unsaved changes.

## Procedural instructions

For methods, steps, how-tos, checklists, runbooks, and corrections to instructions,
use `C:/Users/brandon.lepore/.codex/skills/verified-procedures/SKILL.md`. Verify the
exact context, commands, and complete outcome before presenting steps.
