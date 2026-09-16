# Scope Collaborator typeahead suggestions to the admin's existing collaborators, not the full user directory

Status: accepted

`CollaboratorsModal.vue`'s invite input is becoming a typeahead
(`CommandPalette`) backed by a new server search route. A naive
implementation would let any signed-in User probe the entire `users` table
by name/email substring — leaking name + avatar for people they have no
relationship with yet. Instead, the search only ever proposes Users who are
currently a Collaborator on at least one *other* Album the requesting admin
owns (i.e. "people you've already invited somewhere"), excluding anyone
already an admin/Collaborator on *this* Album. It's computed live from
current `Album.users` relations — no history/audit table for past
Collaborators who were later removed.

## Consequences

- **First-ever invite to a new person still requires typing the full
  email.** The picker has no suggestion to offer until the admin has
  collaborated with that person on some other Album at least once; this is
  a deliberate privacy/UX trade-off, not an oversight.
- The existing free-text invite-by-email flow (unknown email → pending
  `Invitation`; known-but-never-collaborated email → linked immediately) is
  preserved as a fallback item in the palette when the query matches no
  suggestion, so no capability is lost relative to the current
  textarea-based UI.
- The suggestion pool can shrink if a Collaborator is removed from every
  other Album they shared with the admin — expected, since it reflects
  *current* shared albums, not a persisted "known contacts" list.
