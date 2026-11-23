# Daily-note creation is not held back until the pull finishes

We considered blocking creation of today's note until a Pull finishes, which is the usual cure for "the template note collides with the real one". We dropped it: Obsidian gives a plugin no clean hook to delay another plugin's file creation, and the Blank section rule (ADR 0002) already makes a freshly templated note merge into the real one without trace. Combined with a Pull every time the app comes back to the foreground, the collision becomes harmless instead of impossible.
