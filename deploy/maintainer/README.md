# Maintainer scripts

These scripts are **not** included in the release bundles published on
GitHub.  They are used by the ArkManiaGest maintainer (Lomatek /
ArkMania.it) to cut new releases from a source checkout — end users do
not need them.

- **`release.ps1`** — one-shot release automation: bumps version,
  updates CHANGELOG, commits, pushes, tags, and monitors the GitHub
  Actions release workflow.
- **`package-release.ps1`** — produces the same `tar.gz` + `zip`
  artefacts the GitHub Actions workflow builds, but locally (useful
  when testing the release packaging offline).

Both scripts operate on the full source tree with `git` history and
`backend/` + `frontend/` source; they do not run inside a release
tarball.

If you are a regular user installing ArkManiaGest, use:

- **`deploy/install-panel.ps1`** (Windows client) or
- **`deploy/install-panel.sh`** (Linux client)

and ignore this folder entirely.
