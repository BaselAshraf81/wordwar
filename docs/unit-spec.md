# UnitSpec: the contract between the AI and the simulation

The AI turns a typed phrase into one `UnitSpec`. The simulation turns specs into bodies and
runs the fight. The spec is the only thing that crosses the boundary, so the AI can never pick
a winner: it can only describe what a thing *is*.

Every field is a closed choice or a described level, so a decision model (Jev) can fill it with
Choice / Score questions and the code can sample from the returned probabilities.

| Field | Type | Meaning | How the AI fills it |
|---|---|---|---|
| `label` | string | The phrase the player typed. Display only. Never read by the sim. | Copied. |
| `count` | int 1–200 | How many bodies. "100 men" → 100, "a swarm of geese" → ~12. | Choice over count buckets, code picks a value in the bucket. |
| `plan` | `biped` \| `quadruped` \| `bird` \| `wheeled` | Body plan. More plans later (snake, insect, blob, fish). | Choice. |
| `size` | metres | Standing height (length for quadrupeds). | Score over described levels ("like a mouse" … "like a house"), mapped in code. |
| `weight` | kg | Total mass. Density is derived from it, so big things are heavy because they are big. | Score over described levels, mapped in code. |
| `strength` | 0.3–3 | Motor force relative to what the body needs to hold itself up. 1 = an ordinary adult human. | Score. |
| `toughness` | 0.3–4 | Health multiplier. | Score. |
| `speed` | 0.3–3 | Gait rate and drive force. | Score. |
| `bravery` | 0–1 | Share of its own side it will watch fall before it runs. | Score. |
| `attack` | `punch` \| `kick` \| `bite` \| `peck` \| `charge` \| `slash` \| `ram` | Which segment strikes and how. | Choice. |
| `weapon` | `none` \| `sword` \| `knife` \| `club` \| `spear` | A dense part welded to the striking limb. | Choice. |
| `armor` | 0–1 | Absorbs part of every hit. | Score. |
| `canFly` | bool | Wings produce lift. | Noul, thresholded in code. |
| `colors` | `{ body, accent }` named colours | Look only. | Choice over named colours. |

Rules the simulation enforces, whatever the spec says:

- Stats are jittered ±15% per body from a seeded RNG, so "100 men" has brave ones and cowards.
- Large counts get cheaper bodies automatically. Fidelity is a performance decision, not an AI one.
- The winner is whichever side still has a standing body when the other has none, or the side
  with more standing mass at the time limit.
- A replay is `{ seed, specs }`. Same seed, same fight.
