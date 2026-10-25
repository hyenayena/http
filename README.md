# http

Safe internet access for the assistant. Kind: io (planned manifest field). For now this is an empty skeleton: the `http` command only prints its help.

## Commands
| Command | What it does |
|---|---|
| `http help` | Shows the subcommands (safe for the assistant) |

## Environment
None.

## Data
None yet.

## Events
None.

## Dependencies
None.

## Limits and known risks
No network access is implemented yet.

## Development
`npm run typecheck`, `npm run test` (run inside the yena tree; `tsc` and `tsx` come from `/app/node_modules`).
