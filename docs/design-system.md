# Daylark design system

Monochrome with occasional colour. Ink on cool off-white (and the reverse in dark mode), Geist for everything, small type, hairline borders, light shadows. Colour is reserved for meaning: category tags, focus, and status.

- **Tokens**: `src/styles/tokens.css`. Colour, type, space, radii, shadows, motion. Light values on `:root`, dark on `:root[data-theme="dark"]`. Never hard-code a colour or size in a component. The accent is the ink itself; `--blue --green --amber --violet` are the occasional colours; `--ok --warn --danger` are status. Contrast for the main text pairs is checked against WCAG AA, and `npm run ui:check` re-checks the rendered pages.
- **Base**: `src/styles/base.css` (reset, focus ring, skip link, reduced motion).
- **Fonts**: Geist and Geist Mono, loaded once in `src/app/layout.tsx`. Headings use `--font-display` (Geist, semibold, tight tracking).
- **Primitives** (`src/components/ui/`): `Button`, `IconButton` (needs a `label`), `Menu` (accessible action menu), `ConfirmDialog` (focus trap, safe default, restores focus), `Toast` (`useToast`; the one notification system), `Avatar`, `Skeleton`, icons, `Logo`.
- **Layout** (`src/components/layout/`): `AppShell` (sidebar collapsible on desktop with ⌘B, drawer below 56rem), `Sidebar`, `ConversationMenu` (pin, rename, delete), `ConversationDeletion` (delete with undo, rename and pin state), `AccountMenu`, `ThemeToggle`.
- **Chat** (`src/components/chat/`): `useChat` owns state and network (NDJSON progress, Stop, drafts, ratings); everything else is presentational. Composer accepts drag-and-drop, paste and file picker with validation (`src/lib/ui/attachments.ts`). Long chats render the newest 120 messages.
- **History, Settings, Legal**: `components/history`, `components/settings`, `components/legal` (the privacy policy and terms open in a dialog and also exist as pages).
- **Style guide**: `/design` (interactive samples). Mock signed-in views: `/design/app`, `/design/history`. All development only; they 404 in production.
- **Checks**: `npm run ui:check` (dev server running) screenshots the mock views in light and dark at desktop, tablet and phone widths, runs axe-core, and reports console errors. Screenshots go to `ui-shots/` (git-ignored).
- **Rules**: one CSS Module per component; interactive targets at least `--tap`; every icon-only control has an accessible name; new motion respects `prefers-reduced-motion`; a dialog traps focus and restores it; every timed action can be reached by keyboard.
