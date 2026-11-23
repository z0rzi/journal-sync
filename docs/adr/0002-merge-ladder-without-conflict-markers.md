# Merge ladder, never conflict markers

When both Devices changed a note, we try git's ordinary line-by-line three-way merge first. Only if that fails do we merge Section by Section, and only Sections both Devices really changed get Stacked. Conflict markers are never written into a note and no merge is ever left for the user. We accept that a real clash produces two stacked versions to tidy by hand, because a journal entry must never be lost and the user must never be blocked.

## Consequences

- A Blank section on one side always gives way to the other side. This is what makes a template note created on the phone before a Pull harmless.
- When both sides changed the same frontmatter field differently, the version already on GitHub wins.
- Fenced code blocks are never duplicated by a merge: the result never has more copies of a block than either side had.
