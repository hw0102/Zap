# Contributing to Zap

Thanks for contributing.

## Scope

Zap is a local-only project focused on wireless file transfer between nearby devices using LAN/hotspot and WebRTC.

- Keep changes aligned with local/private usage.
- Avoid adding public cloud hosting, internet-facing deployment, or account/auth platform dependencies unless explicitly discussed first.

## Development Setup

1. Install dependencies:

```bash
npm install
```

2. Run locally:

```bash
npm run dev
```

3. Run on LAN (for multi-device testing):

```bash
npm run dev:lan
```

## Regression Checks

Run before opening or updating a PR:

```bash
npm run check
```

This runs:

- `npm run check:syntax`
- `npm test` (server smoke test)

## Pull Requests

1. Keep PRs focused and small where possible.
2. Include a short description of what changed, why it changed, and how you validated it.
3. Update docs (`README.md`, this file, or inline comments) when behavior or workflows change.
4. Ensure GitHub Actions CI passes on your PR before merge.

## Coding Notes

- Prefer clear, minimal JavaScript and avoid unnecessary dependencies.
- Keep the no-build-step workflow intact unless there is a strong reason to change it.
- Preserve privacy-first behavior: server for signaling/discovery, data peer-to-peer whenever possible.

## Testing Guidance

- Validate at least one sender and one receiver path when touching transfer flow.
- If your change affects hotspot mode, test QR session setup and file transfer completion.
