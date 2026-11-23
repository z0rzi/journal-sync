# The same JavaScript git on desktop and phone

Obsidian on the phone cannot run real git, so the phone must use isomorphic-git. We use isomorphic-git on the desktop too, even though real git is available there, so both Devices run exactly the same sync code and behave the same way. The cost: SSH is not supported, so each Device authenticates over HTTPS with a GitHub fine-grained token limited to the journal repository.

Only the file layer differs: the desktop reads files through Node's `fs` (much faster), the phone through Obsidian's vault adapter. The whole sync test suite runs over both, so they can't drift apart.
