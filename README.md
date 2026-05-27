# DropBoard

DropBoard is split into two layers:

1. `@adrian3/dropboard-core`: reusable board engine
2. `standalone/`: standalone local app shell

## Repo shape

- `src/`: shared DropBoard core package source
- `standalone/`: local single-board runtime and build output flow

## Standalone build notes

- The standalone bundle imports the live core source from `src/` so the launcher and the reusable package stay in sync.
- The build script pins `react` and `react-dom` to the repo root copy to avoid duplicate React instances in the bundle.
- The launcher writes transient logs and PID files inside `standalone/`; they are ignored by Git.

## Why this split exists

The shared core is meant to be reused by:

1. Ade's World Builder
2. the standalone DropBoard app
3. future hosts

The core owns board behavior. Hosts own navigation, app shell, and board registry concerns.
