# @talos/link

Own binary RPC/event transport over any ordered message carrier; WebSocket adapters are the
subpaths `@talos/link/ws-browser` and `@talos/link/ws-node`. Design, frame format, client and
server behaviour: `docs/impl/link.md`. For chunk transfers pass a bound call:
`uploadChunks(client.call.bind(client), options)`.
