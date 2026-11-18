# Toilet Map Design System

Shared Preact component library used by `toiletmap-client` and any future Toilet Map surfaces. All components are framework-agnostic at the token level; the Preact bindings live in `src/components/`.

## Components

| Component | Description |
|-----------|-------------|
| `Badge` | Small status label |
| `Banner` | **Deprecated**: renders a `Notice` with Banner's old roles (h2 title; `role="alert"` for error/warning only). Use `Notice` |
| `ConfirmDialog` | "Are you sure?" modal: centred on wide screens, bottom sheet on narrow/touch. Focus trap, Escape/backdrop/× dismiss, `tone="destructive"`, busy while `onConfirm`'s promise runs. `initialFocus`: `"confirm"`, `"cancel"` (the default when destructive), `"title"` (for a dialog to read first, e.g. a list of changes) or a ref. `role="dialog"` for non-interrupting sheets |
| `Button` | Primary / secondary / link button (`htmlElement` prop selects `button` or `a`) |
| `Drawer` | Slide-in side panel |
| `Footer` | Site footer with configurable links |
| `Header` / `MainMenu` | Site header and navigation menu |
| `Icon` | SVG icon renderer (see `IconName` union for available names) |
| `IconButton` | Button with an icon and optional label |
| `InputField` | Labelled text input |
| `Logo` | Toilet Map wordmark/logo |
| `Notice` | Inline message, tones `info` / `success` / `warning` / `error`, optional title, action(s) and dismiss; `role="status"` (errors `role="alert"`) unless `announce="off"` or `autoFocus` |
| `MapOverlay` | Floating overlay container for map controls |
| `OpeningHoursInput` | Controlled opening-hours editor. `value: null` means "Don't know"; otherwise a 7-day array. Includes "copy Monday" helpers. Pair with `validateOpeningTimes()` and `isTwentyFourHours()` |
| `Prose` | Long-form text (content pages, posts): headings, lists, links, quotes, tables, images and code in a ~70ch column, styling bare elements so Markdown needs no classes. Astro pages can use `<div class="prose">` directly |
| `RadioInput` | Accessible radio button group |
| `Sheet` | Bottom sheet / modal |
| `SiteLayout` | Full-page wrapper (header + main + footer) |
| `Stack` | Flexbox layout primitive with configurable spacing and direction |
| `Center` | Centering layout primitive |
| `Switch` | Toggle switch input |
| `Tag` | Removable or display tag |
| `Toast` / `ToastRegion` / `toast` | Transient confirmations. Mount one `<ToastRegion />` (a polite live region, always rendered); call `toast.show({ message })` from any island. Auto-dismisses after 6 s, paused on hover/focus |
| `TextArea` | Labelled textarea |
| `TriStateToggle` | Three-state checkbox (`true` / `false` / unknown) for nullable boolean fields |
| `VisuallyHidden` | Accessibility utility that hides content visually but keeps it in the DOM |

## Usage

```tsx
import { Button, Notice, OpeningHoursInput, TriStateToggle } from "toiletmap-design-system";
```

All exports (components and their TypeScript types) are available from the package root. See `src/index.ts` for the full export list.

## Development

The design system is a pnpm workspace package. Every component and state is on the client's kitchen-sink page, `/dev/components` (dev and preview builds only; a 404 in production).

Tokens (`src/tokens.css`) include status colours (`--color-{info,success,warning,error}-{bg,border,icon}`), text colours (`--color-text-muted`, `--color-text-error`), radius (`--radius-*`), elevation (`--shadow-1..3`) and stacking (`--z-*`). Their contrast is checked in `src/notifications.css.test.ts`. Also `--toilet-form-max-width`, the column shared by the add/edit form and the report flow.

The stylesheet gives every link without a class the brand link colour (`--color-link`) at zero specificity, so no page shows the browser's default blue. Decorative icons (no `aria-label`) render no `<title>`, so they add nothing to the text of what they sit in.

## Tests

```sh
pnpm --filter toiletmap-design-system test
```
