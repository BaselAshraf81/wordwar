# wordwar

Type any two armies. Watch physics decide.

**Play: https://baselashraf.com/wordwar/**

"100 men" vs "1 gorilla". "50 geese with knives" vs "a medieval knight". "A haunted vending
machine" vs "a sumo wrestler". Each phrase becomes a wobbly ragdoll army, and a physics
simulation decides who wins.

## The rule that matters

The AI **assembles**, the simulation **decides**.

- [Jev](https://typesafe.ai) (TypeSafe's typed-decision model) answers about 90 closed-list
  questions per phrase: body frame, legs, arms, heads, wings, tail, material, attacks, ranged
  attacks, elements, weaknesses, size, weight, bravery. It never sees the opponent, so it cannot
  pick a winner.
- Code turns those answers into a genome, builds jointed bodies with motors, and runs the fight
  in [Rapier](https://rapier.rs) 2D (the deterministic build).
- Same seed, same fight on every device. Share links carry the designed armies themselves, so a
  replay never asks the AI again.

## Run it

```
cd proto2d
npm install
npm run dev        # http://127.0.0.1:5188
npm test
```

Designing new phrases needs a TypeSafe key in `../../.env` (`TYPESAFE_API_KEY`; any
`TYPESAFE_API_KEY_*` extras join a rotation). The showcase fights are pre-baked and run
without one.

- `src/sim/`: genome, body builder, combat rules, battle loop
- `src/ai/jev.ts`: the question set and how answers become a genome
- `src/server/api.ts`: the production endpoint (`npm run build:api` bundles it for a Vercel function)
- `test/bake.test.ts`: re-designs the showcase fights through Jev (`BAKE=1`)

## Credits

- Animal and dinosaur models: [Quaternius](https://quaternius.com), CC0.
- Physics: Rapier by Dimforge. Rendering: Canvas 2D and three.js.
