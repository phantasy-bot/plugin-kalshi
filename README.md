# Kalshi

Kalshi prediction-market integration plugin for Phantasy.

Package: `@phantasy/plugin-kalshi`
Repo: https://github.com/phantasy-bot/plugin-kalshi

## Status

This repository is the standalone source for the Kalshi plugin. It ships an installable Phantasy plugin package instead of keeping this optional capability in the core Phantasy runtime.

## Development

```bash
npm install
npm run typecheck
npm run build
npm pack --dry-run
```

## Runtime Contract

The plugin uses the public `@phantasy/agent/plugins` and `@phantasy/agent/plugin-runtime` surfaces. Do not import private paths from the Phantasy monorepo.
