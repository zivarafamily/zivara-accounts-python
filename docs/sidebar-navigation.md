# Compact sidebar navigation

The sidebar starts with only five top-level entries for administrators:
Dashboard (direct link), Accounting, Revenue, Reports, and Setup. The latter four
are click/tap disclosures. All start collapsed; opening one closes the others.
The group containing the current page stays highlighted even while collapsed.

Native buttons support keyboard activation, expose aria-expanded/aria-controls,
and retain the browser focus indicator. Escape from a submenu collapses it and
returns focus to its heading. Hidden submenus are not keyboard-focusable.

Grouping is presentation-only. Every destination, role/module predicate, LLP
module precedence rule, and route guard remains unchanged. Users see only groups
containing authorized links, so restricted users may see fewer than five entries.
The existing mobile drawer, overlay, close button, and close-on-navigation behavior
are retained. No backend, authentication, or deployment configuration changes.

Checks:
- `npm run build --prefix frontend`
- `node frontend/tests/sidebar.interaction.mjs` after making the optional jsdom
  test dependency available. Alternatively set JSDOM_PATH to an existing jsdom
  module entry. The test isolates the sidebar with a memory router and synthetic
  context; it does not connect to a live account or backend.

The interaction test covers all 20 destinations, role/module visibility,
collapsed and one-open behavior, active-section indication, Escape/focus, and
mobile route/overlay close callbacks. Mobile layout itself uses the unchanged
existing responsive stylesheet; the jsdom test does not render screenshots.
