# Journal Sync

Keeps one journal vault identical across the desktop and the phone through a single GitHub repository, without ever leaving the user a conflict to resolve by hand.

## Language

**Device**:
One installation of the vault (the desktop, the phone), known by the name set in its settings.
_Avoid_: machine, client, host

**Sync**:
Committing this device's changes, bringing in the other device's, and pushing the result.
_Avoid_: backup, save

**Pull**:
Bringing in the other device's changes without committing this device's pending edits.
_Avoid_: fetch, update

**Quiet period**:
The time with no edits after which a Sync starts (10 minutes by default).
_Avoid_: debounce, delay

**Section**:
A heading line together with the text under it, up to the next heading of any level.
_Avoid_: block, chunk, subtitle

**Preamble**:
Everything in a note above its first heading, frontmatter excluded.

**Blank section**:
A Section whose text is empty or still exactly what the note's template put there.
_Avoid_: untouched, default section

**Stacking**:
Keeping both devices' versions of a Section, one after the other, each under a Device marker.
_Avoid_: combining, concatenating

**Device marker**:
The line naming which Device a stacked version came from.
_Avoid_: subheader, separator
