# Preserve closed completion packets in the supplemental owner replay

Actual #8476 source `47e3f2a4` run38125402668 completed the supplemental
baseline's original 79 rows and 16 resolve/refusal requests. The original
closed-document oracle requires exactly four `null` results. Its whole wire
retains those four results, but the supplemental completion wrapper called
`object(null)` before returning the original packet, recording a fixture error.
The after side never launched. The failed whole artifact remains preserved:
11696808484, ZIP SHA256
`dab665f782e74332e8381fbde3ebaac41bde7f754a956d53bc271a1d71475d26`.

Return only an explicit null completion packet unchanged before supplemental
item selection. Undefined and malformed values still fail the existing parser.
The original 79 packets, 8 resolves, 8 refusal controls, primary 20-field
comparison, notifications, child ceilings and deadlines remain required.
The baseline's three recorded foreign-position/authored-owner failures are
retained; the actual after side must still pass every original refusal.

Keep the original `433e2847` whole90/51/3 manifest and strict qualifier unchanged.
A separate finite successor seals only the complete reviewed wrapper body
`61921cd7` → `d200def1`, with all 90 production bodies, 51 custody pairs and
the other two extension bodies exact. The loader still needs its independent
complete two-body context. Unknown, omitted, duplicate, partial or drifted
bodies refuse. No hash projection converts a successor into the old authority.

Current composed-source Actions and actual Linux owner facts remain required;
this source correction does not qualify the old red comparison or released use.
