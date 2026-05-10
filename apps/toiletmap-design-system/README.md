# Toilet Map Design System

Shared Preact component library used by `toiletmap-client` and any future Toilet Map surfaces. All components are framework-agnostic at the token level; the Preact bindings live in `src/components/`.

## Components

| Component | Description |
|-----------|-------------|
| `Badge` | Small status label |
| `Banner` | Informational or error message strip (`success`, `error`, `info` variants) |
| `Button` | Primary / secondary / link button (`htmlElement` prop selects `button` or `a`) |
| `Drawer` | Slide-in side panel |
| `Footer` | Site footer with configurable links |
| `Header` / `MainMenu` | Site header and navigation menu |
| `Icon` | SVG icon renderer (see `IconName` union for available names) |
| `IconButton` | Button with an icon and optional label |
| `InputField` | Labelled text input |
| `Logo` | Toilet Map wordmark/logo |
| `MapOverlay` | Floating overlay container for map controls |
| `OpeningHoursInput` | 7-day opening-hours editor with bulk helpers (all open, all closed, copy-down) |
| `RadioInput` | Accessible radio button group |
| `Sheet` | Bottom sheet / modal |
| `SiteLayout` | Full-page wrapper (header + main + footer) |
| `Stack` | Flexbox layout primitive with configurable spacing and direction |
| `Center` | Centering layout primitive |
| `Switch` | Toggle switch input |
| `Tag` | Removable or display tag |
| `TextArea` | Labelled textarea |
| `TriStateToggle` | Three-state checkbox (`true` / `false` / unknown) for nullable boolean fields |
| `VisuallyHidden` | Accessibility utility that hides content visually but keeps it in the DOM |

## Usage

```tsx
import { Button, Banner, OpeningHoursInput, TriStateToggle } from "toiletmap-design-system";
```

All exports (components and their TypeScript types) are available from the package root. See `src/index.ts` for the full export list.

## Development

The design system is a pnpm workspace package. Run the consumer app (`toiletmap-client`) to see components in context — there is no standalone Storybook at this time.
