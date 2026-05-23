# DropBoard

DropBoard is split into two layers:

1. `@adrian3/dropboard-core`: reusable board engine
2. `standalone/`: standalone local app shell

## Repo shape

- `src/`: shared DropBoard core package source
- `standalone/`: local single-board runtime and build output flow

## Why this split exists

The shared core is meant to be reused by:

1. Ade's World Builder
2. the standalone DropBoard app
3. future hosts

The core owns board behavior. Hosts own navigation, app shell, and board registry concerns.
