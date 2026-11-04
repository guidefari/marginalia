# Marginalia

A personal reading desk with contextual AI marginalia, notes and a searchable library.

Choose a reading window, continue an article, or find something by asking for it. While reading, explain a passage, follow connections to your notes, save highlights, or record what stayed with you. RSS, pasted links, optional Readwise Reader sync and articles sent from other apps feed the same library.

Readers sign in with a passkey or password, and each sees only their own library. Signup is closed: people request access and the owner approves them under **Readers**, which issues a one-time invite. Read [access control](docs/operations.md#access-control) before deploying your own copy.

## Run locally

Use Bun 1.3.4 or newer, Node.js 24+ for Portless, and a Convex account. [Portless](https://github.com/vercel-labs/portless) is pinned as a web dev dependency and installed by Bun; no global installation is needed. Start from a checkout of this repo:

```bash
bun install --frozen-lockfile
bun run --cwd packages/backend dev
```

The Convex CLI creates or selects a development deployment and writes `packages/backend/.env.local`. Leave it running. In another terminal, create the web config:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Replace both example URLs with `CONVEX_URL` and `CONVEX_SITE_URL` from your backend's `.env.local`. Never copy the existing personal deployment into a new installation. Then start the web app:

```bash
bun run --cwd apps/web dev
```

On first run, Portless may ask for administrator approval to trust its local HTTPS certificate and bind port 443. Approve these prompts on your development machine. If certificate trust was skipped, run `bun run --cwd apps/web portless trust`.

Open **https://marginalia.localhost**. Set `SITE_URL=https://marginalia.localhost` on your isolated Convex deployment so sign-in trusts the Portless origin. The existing numbered localhost origins remain supported; the Portless-assigned backend port is not the browser origin. Add an RSS feed in **Sources**, or paste an article URL into the desk's search. For AI annotations and search, set `PROVIDER_KEYS_ENCRYPTION_KEY` on your Convex deployment and add your own provider key in Your account; see [setup](docs/development.md#enable-ai). Ordinary library data lives in Convex, not in the web process.

## Check a change

```bash
bun run check
bun run build
```

`check` runs formatting/lint checks, TypeScript and every package's tests. Building the web app requires its public Convex URL configuration. Tests use fixtures and mocked requests rather than your live library or paid model calls.

## Documentation

- [Set up integrations and development](docs/development.md)
- [Send articles in from other apps](docs/api.md)
- [Use the reader and keyboard shortcuts](docs/reader-guide.md)
- [Use your phone and install the PWA](docs/mobile-and-pwa.md)
- [Understand the architecture](ARCHITECTURE.md)
- [Product boundaries](PRODUCT.md) and [recorded decisions](docs/decisions.md)
- [Web design conventions](apps/web/DESIGN.md)
- [Deploy, verify and troubleshoot](docs/operations.md)
- [Remaining limitations](docs/limitations.md)
- [Polish-pass verification](docs/verification.md)

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or [MIT license](LICENSE-MIT) at your option.
