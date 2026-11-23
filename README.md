# Journal Sync

Git sync for the journal vault, on the desktop and the phone. It replaces obsidian-git. See `docs/specs/2026-11-23-journal-sync-design.md` for the full behaviour and `GLOSSARY.md` for the words used.

- **Sync** (commit, pull, push) 10 minutes after the last edit, and right away when the app goes to the background or Obsidian quits.
- **Pull** at startup, when the app comes back to the foreground, and every 10 minutes.
- When both devices changed a note, the plugin merges it itself and never leaves conflict markers. A template note created before pulling gives way to the real one. A section both devices really wrote is kept twice, one version under each device's name, and you get a notice naming the file.

## Setup, on each device

1. Disable obsidian-git. Two sync plugins at once recreate the mess.
2. Create a GitHub fine-grained token: repository access *only* `z0rzi/journal`, permission *Contents: Read and write*. One token per device makes it easy to revoke one.
3. Install the plugin (below), enable it, and in its settings:
   - set the **Device name** (`Desktop`, `Phone`),
   - pick or create the **GitHub token** secret and paste the token,
   - optionally set the commit author name and email.
4. Run **Journal Sync: Sync now** once and check the status bar says `Sync: <time>`.

The vault must already be a clone of the journal repository (it is on both devices). The repository URL defaults to the HTTPS form of `origin`.

## Install

- **Desktop**: this folder is the plugin. Run `npm install && npm run build`.
- **Phone**: install with BRAT from this repository's releases, or copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/journal-sync/` on the phone.

## Develop

```
npm install
npm test        # merge rules, scheduler, and full two-device sync cycles against a local git server,
                # over both the desktop's and the phone's file layer
npm run build
npm run lint
```
