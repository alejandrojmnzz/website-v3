---
name: Fixed-position sections must load eagerly
description: Why floating/fixed sections (contact_bubble) break under lazy section loading and how edit-mode UX is handled for them
---

Rule: any section component that renders `position: fixed` content (no in-flow height) must be excluded from the lazy `DeferredSection` strategy in SectionRenderer. Lazy sections render a 100px scroll sentinel until it intersects the viewport — a fixed bubble near the end of a long page never mounts, so it "disappears in read mode" and YML edits appear not to propagate.

**Why:** contact_bubble vanished on public pages and edits seemed ignored; root cause was the default lazy strategy for sections at index >= eager_count.

**How to apply:** force `loadStrategy = "eager"` by section type in `renderLiveSection`. For edit-mode UX, follow the modal pattern: render an inline dashed placeholder in the section slot (so hover/edit controls work) plus the real floating element; the floating element's own pencil button dispatches a window CustomEvent (`contact-bubble:edit` with `sectionIndex`) that EditableSection listens for to open the section editor. Also note: EditableSection's local re-render after a save (`wasLocallyUpdated`) must be wrapped in a SectionContextProvider or components lose `sectionIndex`.
