# Concepts

Shared domain vocabulary for this project — entities, named processes, and status concepts with project-specific meaning. Seeded with core domain vocabulary, then accretes as ce-compound and ce-compound-refresh process learnings; direct edits are fine. Glossary only, not a spec or catch-all.

## The game

**Quotebook** — the collection of quotes a host brings to a game, supplied as plain text with one quote per line. Parsing happens entirely in the browser and the text itself never reaches the server; only the resulting quotes do. A line may carry an attribution in several shapes, and a line that matches none of them still becomes a quote with an unknown author rather than being discarded.

**Quote** — one line of a quotebook, as text plus the author the parser attributed it to. A quote whose line held several speakers keeps all of their names for display, and separately keeps the single name it should be grouped by, so that a multi-speaker exchange is treated as belonging to one author when the bracket is built.

**Room** — one running game, addressed by a short code that players type or reach by scanning a code. It holds the whole game state, which is stored encrypted, and it is the unit of cleanup: a room is removed when the host ends the game, and otherwise swept automatically after a period of inactivity. Room creation is rate-limited per client.

**Host** — the one participant who owns a room: they supply the quotebook, advance the phases, and may remove a player. Their authority is a token held by the browser that created the room, so any tab of that browser can act as host but another browser or device cannot. It is deliberately not per-tab: a host who opened the room in a second tab, or restored one after a crash, would otherwise be locked out with no token and no way back while the players waited.

**Player** — a participant who joins a room by name to vote. Identity is a token issued at join, not the name, so two people cannot be confused by an unusual or duplicated display name. A player who stops responding for long enough stops counting toward the gate that waits for everyone to vote.

**Bracket** — the single-elimination pairing of every quote in a game, built once when the game is created and consumed one round at a time until a single quote remains.

**BYE** — the empty side of a pairing, present only when an odd number of quotes remain in a round. Whatever it is paired against advances without a vote. Which quote receives it is chosen at random rather than always falling to the same position, and no quote may receive it in two consecutive rounds. From the second round on it is also restricted to an even position, because the diagram places each box at the mean of the boxes feeding it and an unrestricted BYE there makes boxes overlap; the opening round has no feeders, so it carries no such restriction.

**Author spread** — the deliberate ordering applied when the bracket is built: quotes are grouped by author, largest group first, and dealt alternately from each end of the field. Because pairs are adjacent positions, the effect is to *cluster* one author's quotes into early meetings rather than separate them. That is intentional: it stops a prolific author occupying half the later rounds. Raising or lowering the rate is a product decision, never a correctness fix.

**Champion** — the single quote left when the bracket is exhausted, and the screen that celebrates it.

## Verification

**Standing guard** — a check that applies to every browser test automatically, without the test opting in or knowing it exists. Standing guards exist for defect classes that are silent in the page, where an ordinary assertion would pass while the feature is dead; a guard that only covers tests which asked for it is absent from exactly the ad-hoc test most likely to need it.

A standing guard has two properties that must be established separately: that it *fires* for the defect it names, and that it cannot be *bypassed* — by a file the runner collects but the guard does not scan, by a wrapper that inverts its verdict, or by an escape hatch restricted only by a comment. Proving the first says nothing about the second.
