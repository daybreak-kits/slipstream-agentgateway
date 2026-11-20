# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those roles to the actual label strings used in this repo's local markdown tracker.

| Label in mattpocock/skills | Label in our tracker | Meaning |
| --- | --- | --- |
| `needs-triage` | `needs-triage` | Maintainer needs to evaluate this issue |
| `needs-info` | `needs-info` | Waiting on reporter for more information |
| `ready-for-agent` | `ready-for-agent` | Fully specified, ready for an AFK agent |
| `ready-for-human` | `ready-for-human` | Requires human implementation |
| `wontfix` | `wontfix` | Will not be actioned |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

## Local workflow extensions

These strings are used for ticket lifecycle state in addition to the triage roles above:

- `claimed`: picked up by an implementer; branch and owner recorded in the ticket.
- `resolved`: implementation and verification complete; commit hash appended.
- `blocked`: waiting on another ticket; `Blocked by:` lists the dependencies.
