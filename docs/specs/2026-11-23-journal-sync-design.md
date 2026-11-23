# Journal Sync: design

Replaces obsidian-git for the journal vault (`github.com/z0rzi/journal`), on the desktop and the phone. Words in **bold** are defined in `GLOSSARY.md`.

## When things happen

| Trigger | Action |
|---|---|
| An edit, then a **Quiet period** (default 10 min) with no other edit | **Sync** |
| The app goes to the background, or Obsidian quits | **Sync**, if there are uncommitted edits |
| Startup, the app coming back to the foreground, every 10 min | **Pull** |
| "Sync now" command or the status bar item | **Sync** |

Both intervals are configurable. Only one Sync or Pull runs at a time. A request arriving while one runs is queued once.

## A Sync

1. Stage every change in the vault (`.gitignore` respected), and commit it as `sync <device>: <YYYY-MM-DD HH:mm>` if there is anything.
2. Fetch `origin/master`.
3. Same commit: push if there are local commits, otherwise stop.
4. Remote is behind: push.
5. Remote is ahead: fast-forward (see "Applying the other side").
6. Both moved: merge every file (see "Merging"), write the merge commit with both parents, push.
7. If the push is rejected because the other Device pushed meanwhile, run the cycle again, at most 3 times.

## A Pull

Fetch. If the remote is ahead and there are no local commits waiting, fast-forward without committing pending edits. Files with pending edits that the remote also changed are merged on disk ("Merging" below, with the last commit as the base). If both sides have commits, a full Sync runs instead.

## Applying the other side

For each file the remote changed, read the file on disk just before writing it. If it differs from the version in the last local commit, because the user typed during the Sync, that disk content is merged in rather than overwritten.

## Merging a file changed on both sides

- One side unchanged: take the other side.
- Deleted on one side, edited on the other: keep the edited version.
- Non-Markdown, both changed: keep the local file and write the remote one next to it as `name (<other device>).ext`.
- Markdown, both changed: the merge ladder (ADR 0002):
  1. Line-by-line three-way merge. If it is clean, done.
  2. Otherwise split all three versions into frontmatter, **Preamble** and **Sections**, then merge each piece:
     - Frontmatter, field by field: the changed side wins. If both changed a field differently, the GitHub side wins.
     - Section, or the Preamble, the first rule that applies:
       1. Both versions identical: keep it.
       2. One side **Blank**: take the other.
       3. One side unchanged since the base: take the other.
       4. Deleted on one side and unchanged on the other: drop it. Edited on the other side: keep the edit.
       5. Line-by-line merge of the Section is clean: use it.
       6. Otherwise **Stack**: the GitHub version first, then the local one, each preceded by its **Device marker** `*— <device> —*`. Fenced code blocks of the second version that already appear in the first are left out.
     - Section order follows the GitHub version. Sections only the local side has are inserted after the Section that precedes them locally.
  3. Last, the whole result is checked so no fenced code block appears more often than it does in either side.

A Section is identified by its heading line. If the same heading appears twice in a note, it is identified by occurrence order. Headings inside fenced code blocks are not headings.

The template for a note is found from Templater's folder templates (`folder_templates` in Templater's settings). A Section is Blank when its trimmed text is empty, or equal to the trimmed text of the same Section in the template. The same goes for the Preamble.

The other Device's name is read from the last remote commit message (`sync <device>: …`), and is "other device" if it can't be read.

## Feedback

- A status bar item shows the last sync time, "syncing…", "offline" or "error". Clicking it runs a Sync.
- A notice lists the files after an automatic merge that Stacked something, so you can check them.
- Being offline is not an error: the next trigger retries.

## Settings, per Device

- Device name
- GitHub token (fine-grained, contents read and write on the journal repo only)
- Remote URL: defaults to the HTTPS form of `origin`
- Author name and email for commits
- Quiet period in minutes (10), Pull interval in minutes (10)

## Out of scope

- Cloning a fresh vault: both Devices already have a clone.
- Syncing `.obsidian/`: it stays in `.gitignore`.
- Holding back daily-note creation (ADR 0003).
