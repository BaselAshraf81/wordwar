# wordwar (working title)

Type any army. Watch it fight.

"100 men" vs "1 gorilla". "A swarm of angry geese" vs "a medieval knight". "50 toddlers" vs
"a Roomba with a knife". Each phrase becomes a wobbly physics body assembled from a parts kit,
and the physics decides who wins. The AI never picks the winner.

## The rule that matters

The AI **assembles**, the simulation **decides**.

- A language judgment turns a phrase into a unit spec: body plan, parts, size, mass, toughness,
  bravery, attack style, colours, count. Picked from closed lists, sampled from the model's
  probabilities so "100 men" has some brave ones and some who run.
- Code builds the body from Blender-made parts, attaches joints and motors, and runs the fight.
- Same seed, same fight. Every battle has a replay link.

## Build phases

1. **2D side-view prototype (web).** ~4 body plans, ~40 parts, active ragdolls. Goal: 10 clips
   good enough to post. If they don't spread, stop here.
2. **3D + Steam.** Spore-style parts kit (~10 body plans, ~150 parts) built in Blender, exported
   as glTF.

## Layout

```
docs/      design notes and the unit-spec contract
blender/   .blend sources for body plans and parts
```

Agent skills and the Blender MCP config live in `../.kiro/` (shared by the winduo workspace,
not committed).
