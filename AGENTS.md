# Project Guidelines

## Commands

- Install dependencies: `npm install`
- Build: `npm run build`
- Type-check: `npm run typecheck`
- Test: `npm test`
- Run the Worker locally: `npm run dev`
- Build a deployment dry run: `npm run deploy:dry`
- Run all checks: `npm run check`

## Constraints

- The target production runtime is Cloudflare Workers.
- Keep the Worker stateless and free of Node/Express transports, filesystem access, and in-memory HTTP sessions.
- Keep the service read-only. Do not add Warframe Market authorization or order mutation operations.
- Run `npm run check` before completing a task.
