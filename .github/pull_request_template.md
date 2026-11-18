## What changed

<!-- What this PR does and why, in a sentence or two. Link the issue or plan item. -->

## How it was tested

<!-- Unit / component tests, e2e specs, manual checks (devices, browsers). -->

## Checklist

- [ ] `pnpm ci:check` (Biome), type checks and tests pass locally
- [ ] Uses design-system components for notices, dialogs and buttons (`Notice`, `Toast`,
      `ConfirmDialog`, `Button`), not one-off styles; any new pattern is added to the design
      system first
- [ ] Screenshots attached for UI changes (before and after, desktop and phone). The e2e job's
      `ui-screenshots` artifact has the key states (`e2e/screenshots.spec.ts`)
- [ ] Accessible names that e2e locators rely on are unchanged, or the specs are updated
- [ ] No secrets, tokens or personal data in the code, logs or screenshots
