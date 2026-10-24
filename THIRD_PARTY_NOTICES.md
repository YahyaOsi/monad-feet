# Third-party attribution

Monad Feet is built by its solo founder/developer using the external projects
listed below. These dependencies, adapted components, and fonts are not claimed
as original Monad Feet work. Our MIT license applies to original project code;
third-party material retains its own license and copyright notices.

## Source-derived components

- **shadcn/ui**: the UI component foundation under
  `artifacts/monad-feet/src/components/ui/` and the component sandbox is adapted
  from [shadcn/ui](https://github.com/shadcn-ui/ui), copyright shadcn, MIT.
  [Upstream license](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md).
- **Replit workspace and storage integration**: the workspace scaffold,
  artifact integration, storage helpers, and development tooling originate
  from Replit-provided templates/integrations and have been adapted for this app.
  This attribution is not a claim that every Replit tool is MIT licensed.

## Direct dependencies

Versions and transitive dependencies are pinned in `pnpm-lock.yaml`; workspace
`package.json` files identify which packages use each dependency. The license
labels below come from the installed package manifests, not from a legal audit.
The linked upstream projects and their distributed LICENSE/NOTICE files are
the authoritative sources. Preserve those files when redistributing dependencies
or bundled third-party code.

| Project / packages | Use | Declared license |
| --- | --- | --- |
| [React](https://github.com/facebook/react): `react`, `react-dom` | Interface | MIT |
| [Vite](https://github.com/vitejs/vite), `@vitejs/plugin-react` | Frontend development and builds | MIT |
| [TypeScript](https://github.com/microsoft/TypeScript) | Language tooling | Apache-2.0 |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss): `tailwindcss`, `@tailwindcss/vite`, `@tailwindcss/typography` | Styling | MIT |
| [Radix UI](https://github.com/radix-ui/primitives): `@radix-ui/react-*` | Accessible UI primitives | MIT |
| [TanStack Query](https://github.com/TanStack/query): `@tanstack/react-query` | Server state | MIT |
| [Wouter](https://github.com/molefrog/wouter) | Routing | Unlicense |
| [Motion](https://github.com/motiondivision/motion): `framer-motion` | Animation | MIT |
| [RainbowKit](https://github.com/rainbow-me/rainbowkit) | Wallet interface and connectors | MIT |
| [wagmi](https://github.com/wevm/wagmi), [viem](https://github.com/wevm/viem) | Ethereum-compatible wallet and chain interactions | MIT |
| [Uppy](https://github.com/transloadit/uppy): `@uppy/core`, `@uppy/react`, `@uppy/dashboard`, `@uppy/aws-s3` | File uploads | MIT |
| [Express](https://github.com/expressjs/express), [cookie-parser](https://github.com/expressjs/cookie-parser), [cors](https://github.com/expressjs/cors) | API and HTTP middleware | MIT |
| [ws](https://github.com/websockets/ws) | WebSockets | MIT |
| [Drizzle ORM](https://github.com/drizzle-team/drizzle-orm): `drizzle-orm`, `drizzle-zod` | Database access and schemas | Apache-2.0 |
| [Drizzle Kit](https://github.com/drizzle-team/drizzle-orm): `drizzle-kit` | Database tooling | MIT |
| [node-postgres](https://github.com/brianc/node-postgres): `pg` | PostgreSQL client | MIT |
| [Zod](https://github.com/colinhacks/zod) | Validation | MIT |
| [Orval](https://github.com/orval-labs/orval) | OpenAPI client generation | MIT |
| [Google Cloud Storage client](https://github.com/googleapis/nodejs-storage): `@google-cloud/storage` | Object storage | Apache-2.0 |
| [Google Auth Library](https://github.com/googleapis/google-auth-library-nodejs): `google-auth-library` | Storage authentication | Apache-2.0 |
| [Pino](https://github.com/pinojs/pino): `pino`, `pino-http`, `pino-pretty`; [thread-stream](https://github.com/pinojs/thread-stream) | Logging | MIT |
| [esbuild](https://github.com/evanw/esbuild), [esbuild-plugin-pino](https://github.com/davipon/esbuild-plugin-pino) | API bundling | MIT |
| [React Hook Form](https://github.com/react-hook-form/react-hook-form), `@hookform/resolvers` | Forms | MIT |
| [date-fns](https://github.com/date-fns/date-fns) | Date handling | MIT |
| [Nano ID](https://github.com/ai/nanoid): `nanoid` | Identifiers | MIT |
| [Lucide](https://github.com/lucide-icons/lucide): `lucide-react` | Icons | ISC; retain applicable upstream icon notices |
| [React Icons](https://github.com/react-icons/react-icons): `react-icons` | Icon library | MIT for the library; individual icon sets retain their upstream licenses |
| [Recharts](https://github.com/recharts/recharts) | Charts | MIT |
| [Embla Carousel](https://github.com/davidjerleke/embla-carousel): `embla-carousel-react` | Carousel | MIT |
| [React DayPicker](https://github.com/gpbl/react-day-picker) | Calendar | MIT |
| [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | Resizable layout | MIT |
| [cmdk](https://github.com/pacocoursey/cmdk) | Command interface | MIT |
| [input-otp](https://github.com/guilhermerodz/input-otp) | OTP input | MIT |
| [next-themes](https://github.com/pacocoursey/next-themes) | Theme utilities | MIT |
| [Sonner](https://github.com/emilkowalski/sonner) | Toast notifications | MIT |
| [Vaul](https://github.com/emilkowalski/vaul) | Drawer | MIT |
| [class-variance-authority](https://github.com/joe-bell/cva) | Component variants | Apache-2.0 |
| [clsx](https://github.com/lukeed/clsx), [tailwind-merge](https://github.com/dcastil/tailwind-merge), [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css) | Style utilities | MIT |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped): `@types/node`, `@types/react`, `@types/react-dom`, `@types/express`, `@types/cookie-parser`, `@types/cors`, `@types/pg`, `@types/ws` | Type definitions | MIT |
| [Prettier](https://github.com/prettier/prettier), [tsx](https://github.com/privatenumber/tsx) | Developer utilities | MIT |
| Replit: [`@replit/vite-plugin-cartographer`](https://www.npmjs.com/package/@replit/vite-plugin-cartographer), [`@replit/vite-plugin-dev-banner`](https://www.npmjs.com/package/@replit/vite-plugin-dev-banner), [`@replit/vite-plugin-runtime-error-modal`](https://www.npmjs.com/package/@replit/vite-plugin-runtime-error-modal) | Development integrations | No license field declared in installed package metadata; check applicable vendor terms |

The Radix group above covers accordion, alert-dialog, aspect-ratio, avatar,
checkbox, collapsible, context-menu, dialog, dropdown-menu, hover-card, label,
menubar, navigation-menu, popover, progress, radio-group, scroll-area, select,
separator, slider, slot, switch, tabs, toast, toggle, toggle-group, and tooltip.

## Fonts and services

- [Bricolage Grotesque](https://github.com/ateliertriay/bricolage): font by Mathieu
  Triay and contributors, SIL Open Font License 1.1.
- [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono): font by JetBrains
  and contributors, SIL Open Font License 1.1.
- The app requests these fonts through Google Fonts. Google Fonts is a delivery
  service, not the author of these fonts.
- The optional analytics integration uses [PostHog](https://posthog.com).
  External services (including Monad RPC and WalletConnect infrastructure) have
  their own terms; attribution does not imply endorsement or a partnership.
- Wallet names, logos, project marks, and user-uploaded content retain their
  respective owners' rights. The source license does not grant ownership of
  third-party trademarks or user content.

## Scope and maintenance

This is an attribution inventory, not a claim that all dependencies have the
same license or that a complete transitive-license audit has been performed.
Review the locked transitive packages and their notices for the specific
distribution being made. In particular, do not label the Replit packages with
missing metadata as MIT without checking their applicable terms.
