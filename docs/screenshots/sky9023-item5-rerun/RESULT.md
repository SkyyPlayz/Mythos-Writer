# M9 item 5 re-run — Notes-side agent panel chat input (Ivy revised gate, 2026-08-19)

Harness: `e2e/fidelity/notes-agent-m9e.mjs` (unchanged from merged SKY-9826 slice)
Build: main `351d1be` (includes SKY-10499 fix + SKY-10503 hint), run 2026-08-19 via xvfb.

```
APP ai=true  nav=true {"agentTab":true,"propsTab":true,"placeholder":"Tell me about your world — I'll file it…","propsShown":false}
APP ai=false nav=true {"agentTab":false,"propsTab":false,"placeholder":null,"propsShown":true}
PROTO on: input=true
PROTO toggle clicked=true
  proto-off notes CONTINUITY FLAGS: hidden / CHAT: hidden / Properties: hidden / Agent: hidden
M9E CAPTURE PASS
```
