# Journal Sync: design

Replaces obsidian-git for the journal vault (`github.com/z0rzi/journal`), on the desktop and the phone. Words in **bold** are defined in `GLOSSARY.md`.

## When things happen

| Trigger | Action |
|---|---|
| An edit, then a **Quiet period** (default 10 min) with no other edit | **Sync** |
| The app goes to the background, or Obsidian quits | **Sync**, if there are uncommitted edits |
| Startup, the app coming back to the foreground, every 10 min | **Pull** |
| "Sync now" command or the status bar item | **Sync** |

Both intervals are configurable. Only one Sync or Pull runs at a time, the quit-time Sync included. A request arriving while one runs is queued once; a queued Sync replaces a queued Pull.

Before each Sync or Pull, open editors are saved, so the engine sees their text and an editor can't later overwrite a merged file with an older buffer.

## A Sync

1. Stage every change in the vault (`.gitignore` respected), and commit it as `sync <device>: <YYYY-MM-DD HH:mm>` if there is anything.
2. Fetch `origin/master`.
3. Same commit: push if there are local commits, otherwise stop.
4. Remote is behind: push.
5. Remote is ahead: fast-forward (see "Applying the other side").
6. Both moved: merge every file (see "Merging"), write the merge commit with both parents, push.
7. If the push is rejected because the other Device pushed meanwhile, go back to step 2, at most 3 more times.

## A Pull

Fetch, then:

- Remote is ahead: fast-forward without committing pending edits. Files with pending edits that the remote also changed are merged on disk ("Merging" below, with the last commit as the base).
- Local commits are waiting (an earlier push failed): push them, still without committing pending edits.
- Both sides have commits: a full Sync runs instead.

## Applying the other side

Fast-forward and merge bring files in the same way. For each file the remote changed since the common commit, the three versions are the common commit's, the file on disk now, and the remote's. Using the disk rather than the last commit means text typed during the Sync, or edits a Pull doesn't commit, is merged in rather than overwritten.

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
       4. On one side only. Deleted on the other: dropped if unchanged since the base, kept if edited. Added (not in the base): kept, unless its text is exactly the template's, which means the other side removed that template Section.
       5. Line-by-line merge of the Section is clean: use it.
       6. Otherwise **Stack**: the GitHub version first, then the local one, each preceded by its **Device marker** `*— <device> —*`. Fenced code blocks of the second version that already appear in the first are left out.
     - Section order follows the GitHub version. Sections only the local side has are inserted after the Section that precedes them locally.
  3. Last, the whole result is checked so no fenced code block appears more often than it does in either side.

A Section is identified by its heading line. If the same heading appears twice in a note, it is identified by occurrence order. Headings inside fenced code blocks are not headings.

The template for a note is found from Templater's folder templates (`folder_templates` in Templater's settings). A Section is Blank when its trimmed text is empty, or equal to the trimmed text of the same Section in the template. The same goes for the Preamble. A template Section containing Templater code (`<% … %>`) can render to anything, so a Section matching it is never Blank: otherwise what was written there could be silently replaced by the other side.

The other Device's name is read from the last remote commit message (`sync <device>: …`), and is "other device" if it can't be read.

## Feedback

- A status bar item shows "waiting" until the first job, then the last Sync or Pull time, "syncing…", "offline" or "error" (the message is in its tooltip). Clicking it runs a Sync. A "Sync now" command does the same.
- A notice that stays until dismissed lists the files where something was Stacked, and the conflict copies written, so you can check them.
- An error shows a notice once; the same error again stays in the status bar only.
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
