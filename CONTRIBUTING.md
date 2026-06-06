# Contributing to Voltius

Contributions are welcome — bug fixes, features, and improvements of all sizes.

## Reporting issues

- Search existing issues before opening a new one.
- Include your OS, Voltius version, and steps to reproduce.
- For security vulnerabilities, **do not open a public issue** — email [contact@voltius.app](mailto:contact@voltius.app) instead.

## Development setup

See the [Prerequisites and Development & Build](README.md#prerequisites) sections in the README.

## Commit messages

Use the format `type: short description` — for example:

- `fix: prevent crash when vault is empty`
- `feat: add process manager keyboard shortcuts`
- `chore: update russh to 0.61`

Common types: `feat`, `fix`, `refactor`, `chore`, `docs`, `perf`, `style`. Keep the subject line under 72 characters.

## Submitting a pull request

1. Fork the repo and create a branch from `dev`.
2. Keep commits focused — one logical change per PR.
3. Before opening a PR, make sure the following all pass with no additional warnings:
   - `cargo fmt` and `cargo clippy`
   - `cargo build`
   - `pnpm run build`
4. If your change affects behavior, update the relevant section of the README.
5. Open a PR targeting `dev` with a clear description of what and why.

**Review times:** This project is built in my free time with the goal of eventually going full-time on it. I'll do my best to review PRs promptly, but response times will vary depending on my availability and the number of open PRs. I appreciate your patience.

## Code style

- Rust: `cargo fmt` and `cargo clippy` must pass before submitting.
- No new dependencies without discussion — open an issue first if you need to add one.

## Plugins

Plugins live in the [marketplace repo](https://github.com/VoltiusApp/marketplace) and are licensed under MIT. See that repo for plugin development guidelines.
