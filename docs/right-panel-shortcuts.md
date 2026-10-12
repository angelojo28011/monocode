# Right panel shortcuts

With the right panel open (docked or fullscreen), press bare **B** to activate its existing Browser tab. If several Browser tabs exist, the active Browser stays active; otherwise the first Browser tab is selected. If none exists, B creates a Browser, reusing an active “Open a surface” picker tab when available. B never opens a closed panel.

The picker retains **T** Terminal, **F** Files, **D** Diff, **P** Pull request, **L** Linked pull requests, and **M** Device. Clicking any format remains available. Model/provider catalogs and model selection are unchanged.

Shortcuts yield to inputs, textareas, selects, nested contenteditable targets, terminal and editor contexts, and focused text controls (including chat). Composition, repeat, consumed events, and Ctrl/Meta/Alt combinations are ignored. B also ignores Shift; other picker keys retain their existing uppercase/Shift behavior. Open DOM dialogs, popovers, and model pickers own keys even when focus remains outside them.

Browser and Device both host the native browser; switching to other formats or closing the panel hides it. Dock/fullscreen and tab closing controls are unchanged.

## Limits and verification

B is handled in the app's DOM, not as a system-wide shortcut. Key events inside a focused native remote webview do not necessarily reach the app; use the panel tabs or return focus to the app. Hiding a webview does not suspend its CPU activity.

Regression tests use mocked surfaces and native commands. They verify shortcut dispatch, guards, cleanup, and the container's hide rule—not rendered native webview visibility. Native UI smoke remains a separate check; these tests do not prove it.
