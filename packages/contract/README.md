# @talos/contract

Typed method/event/entity registry shared by server and client. Design and the rules for
adding a module contract: `docs/impl/link.md` (section "API contract"). New methods also need
a fixture in `compat.mjs`, which runs every schema in a VM with newer globals removed.
