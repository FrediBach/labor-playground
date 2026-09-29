# LABOR Playground

A local-only circuit workbench. The implementation roadmap is in [plan.md](./plan.md).

This repository currently contains the application foundation: Vite, React,
TypeScript, Tailwind CSS, and shadcn/ui (Radix primitives). The starter screen
includes a theme toggle; workbench and simulation features are not implemented yet.

## Development

Use Node.js 24 (see `.nvmrc`) and npm:

```sh
nvm use
npm ci
npm run dev
```

Open the local URL printed by Vite.

## Checks and builds

```sh
npm run lint       # Oxlint, including React hook rules
npm run typecheck  # TypeScript checks
npm run build      # TypeScript checks and production build in dist/
npm run preview    # Serve the production build locally
```

## Project layout

- `src/App.tsx`: minimal starter screen.
- `src/components/ui/`: shadcn components, owned by this project.
- `src/lib/utils.ts`: shared class-name helper.
- `src/index.css`: Tailwind imports and theme tokens.
- `components.json`: shadcn configuration.

Use `@/` to import from `src/`. Add UI components as needed:

```sh
npx shadcn@latest add dialog
```

No environment variables or backend services are required.
