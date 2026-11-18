import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  Badge,
  Banner,
  BottomSheet,
  type BottomSheetState,
  Button,
  Center,
  ConfirmDialog,
  createDefaultOpeningTimes,
  Drawer,
  Icon,
  IconButton,
  type IconName,
  InputField,
  Logo,
  MapOverlay,
  Notice,
  type NoticeTone,
  OpeningHoursInput,
  type OpeningTimes,
  RadioInput,
  Sheet,
  Stack,
  Switch,
  Tag,
  TextArea,
  Toast,
  ToastRegion,
  TriStateToggle,
  type TriStateValue,
  toast,
  VisuallyHidden,
} from "toiletmap-design-system";
import styles from "./KitchenSink.module.css";

/**
 * Every design-system component in its states, on one page (/dev/components, dev and preview
 * builds only). Use it to check a change to the design system across components, and as the
 * reference when building a new screen.
 */

const TONES: NoticeTone[] = ["info", "success", "warning", "error"];

/** "An info …", "An error …", "A success …", "A warning …": the article for a tone's name. */
export const withArticle = (tone: string) => `${/^[aeiou]/i.test(tone) ? "An" : "A"} ${tone}`;

const ICONS: IconName[] = [
  "asterisk",
  "comments",
  "bars",
  "filter",
  "angle-right",
  "circle-plus",
  "map-location-dot",
  "spinner",
  "diamond-turn-right",
  "xmark",
  "note-sticky",
  "plus",
  "minus",
  "pen-to-square",
  "chevron-down",
  "circle-xmark",
  "clock",
  "list",
  "question",
  "check",
  "person-dress",
  "person",
  "wheelchair-move",
  "key",
  "toilet",
  "sterling-sign",
  "child",
  "baby",
  "gear",
  "bluesky",
  "share",
  "magnifying-glass",
  "patreon",
  "info",
  "warning",
  "success",
];

const COLOUR_TOKENS = [
  "--color-primary-navy",
  "--color-accent-turquoise",
  "--color-accent-pink",
  "--color-frost-ice",
  "--color-light-grey",
  "--color-neutral-grey",
  "--color-text-muted",
  "--color-text-error",
  "--color-success",
  "--color-destructive",
  ...TONES.flatMap((tone) => [
    `--color-${tone}-bg`,
    `--color-${tone}-border`,
    `--color-${tone}-icon`,
  ]),
];

const SPACES = ["3xs", "2xs", "xs", "s", "m", "l", "xl", "2xl", "3xl"];
const TEXT_STEPS = ["-2", "-1", "0", "1", "2", "3", "4", "5"];
const RADII = ["sm", "md", "lg", "pill"];
const SHADOWS = ["1", "2", "3"];

/** RadioInput's props type leaves out name and value, which it passes through to the input. */
const radio = (value: string, defaultChecked = false) => ({
  name: "ks-pay",
  value,
  defaultChecked,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ComponentChildren;
}) {
  return (
    <section class={styles.section} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} class={styles.sectionTitle}>
        <a href={`#${id}-title`}>{title}</a>
      </h2>
      {children}
    </section>
  );
}

function Example({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class={styles.example}>
      <p class={styles.exampleLabel}>{label}</p>
      <div class={styles.exampleBody}>{children}</div>
    </div>
  );
}

type DialogDemo = "default" | "destructive" | "busy" | "locked" | null;

export default function KitchenSink({ logoSrc }: { logoSrc: string }) {
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogDemo>(null);
  const [dialogResult, setDialogResult] = useState("");
  const [toastPlacement, setToastPlacement] = useState<"bottom" | "top">("bottom");
  const [toggle, setToggle] = useState<TriStateValue>("");
  const [switchOn, setSwitchOn] = useState(false);
  const [activeTag, setActiveTag] = useState(true);
  const [hours, setHours] = useState<OpeningTimes | null>(createDefaultOpeningTimes());
  const [sheet, setSheet] = useState<"bottom" | "left" | "right" | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sheetState, setSheetState] = useState<BottomSheetState>("peek");
  const [sheetGone, setSheetGone] = useState(false);

  const closeDialog = (result: string) => {
    setDialog(null);
    setDialogResult(result);
  };

  const dismiss = (key: string) => setDismissed((keys) => [...keys, key]);

  return (
    <div class={styles.page}>
      <Center gutter>
        <header class={styles.intro}>
          <h1>Design system</h1>
          <p>
            Every component in <code>toiletmap-design-system</code> and its states. This page only
            exists in dev and preview builds.
          </p>
          <nav aria-label="Sections">
            <ul class={styles.toc}>
              {[
                ["tokens", "Tokens"],
                ["notice", "Notice"],
                ["toast", "Toast"],
                ["confirm", "ConfirmDialog"],
                ["buttons", "Buttons"],
                ["chips", "Badge and Tag"],
                ["inputs", "Form inputs"],
                ["hours", "Opening hours"],
                ["sheets", "Sheets and drawers"],
                ["icons", "Icons"],
                ["layout", "Layout and utilities"],
              ].map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}-title`}>{label}</a>
                </li>
              ))}
            </ul>
          </nav>
        </header>

        <Section id="tokens" title="Tokens">
          <h3>Colour</h3>
          <ul class={styles.swatches}>
            {COLOUR_TOKENS.map((name) => (
              <li key={name} class={styles.swatch}>
                <span class={styles.swatchColour} style={{ background: `var(${name})` }} />
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <h3>Text</h3>
          <p style={{ color: "var(--color-text-muted)" }}>
            Muted text (--color-text-muted), for hints and secondary copy.
          </p>
          <p style={{ color: "var(--color-text-error)" }}>
            Error text (--color-text-error), for field errors.
          </p>
          <h3>Type scale</h3>
          <Stack space="2xs">
            {TEXT_STEPS.map((step) => (
              <p key={step} style={{ fontSize: `var(--text-${step})`, margin: 0 }}>
                --text-{step}: Find a toilet near you
              </p>
            ))}
          </Stack>
          <h3>Spacing</h3>
          <ul class={styles.scale}>
            {SPACES.map((space) => (
              <li key={space}>
                <span class={styles.bar} style={{ width: `var(--space-${space})` }} />
                <code>--space-{space}</code>
              </li>
            ))}
          </ul>
          <h3>Radius and elevation</h3>
          <div class={styles.row}>
            {RADII.map((radius) => (
              <div
                key={radius}
                class={styles.tile}
                style={{ borderRadius: `var(--radius-${radius})` }}
              >
                --radius-{radius}
              </div>
            ))}
            {SHADOWS.map((shadow) => (
              <div
                key={shadow}
                class={styles.tile}
                style={{ boxShadow: `var(--shadow-${shadow})` }}
              >
                --shadow-{shadow}
              </div>
            ))}
          </div>
        </Section>

        <Section id="notice" title="Notice">
          {TONES.map((tone) => (
            <Example key={tone} label={`${tone}: title, body, action, dismiss`}>
              {dismissed.includes(tone) ? (
                <Button
                  htmlElement="button"
                  type="button"
                  variant="secondary"
                  onClick={() => setDismissed((keys) => keys.filter((k) => k !== tone))}
                >
                  Show the {tone} notice again
                </Button>
              ) : (
                <Notice
                  tone={tone}
                  title={`${withArticle(tone)} notice`}
                  action={{ label: "Do something", onClick: () => toast.show({ message: "Done" }) }}
                  onDismiss={() => dismiss(tone)}
                  dismissLabel={`Dismiss the ${tone} notice`}
                >
                  <p>
                    The body explains what happened and what to do next.{" "}
                    <a href="#notice-title">Links read as links</a>.
                  </p>
                </Notice>
              )}
            </Example>
          ))}
          <Example label="Body only, every tone">
            <Stack space="2xs">
              {TONES.map((tone) => (
                <Notice key={tone} tone={tone} announce="off">
                  A one-line {tone} notice.
                </Notice>
              ))}
            </Stack>
          </Example>
          <Example label="Compact, every tone (for panels and cards)">
            <Stack space="2xs">
              {TONES.map((tone) => (
                <Notice
                  key={tone}
                  tone={tone}
                  size="compact"
                  announce="off"
                  onDismiss={() => undefined}
                >
                  A compact {tone} notice.
                </Notice>
              ))}
            </Stack>
          </Example>
          <Example label="With a link action and a list">
            <Notice
              tone="warning"
              title="This toilet was changed by someone else"
              announce="off"
              action={{ label: "View the toilet", href: "#notice-title" }}
            >
              <p>You'd also changed these:</p>
              <ul>
                <li>Name</li>
                <li>Opening hours</li>
              </ul>
            </Notice>
          </Example>
          <Example label="Banner (deprecated: renders a Notice)">
            <Banner variant="success" title="Thanks — a moderator will review your suggestion">
              Banner keeps its old API while callers move to Notice.
            </Banner>
          </Example>
        </Section>

        <Section id="toast" title="Toast">
          <Example label="Show a toast (live region, auto-dismisses after 6 s; hover or focus pauses)">
            <div class={styles.row}>
              <Button
                htmlElement="button"
                type="button"
                variant="primary"
                onClick={() =>
                  toast.show({ id: "saved", message: "Thanks — your changes are live" })
                }
              >
                Success toast
              </Button>
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={() =>
                  toast.show({
                    tone: "info",
                    message: "Toilet reported as removed",
                    action: { label: "Undo", onClick: () => toast.show({ message: "Restored" }) },
                  })
                }
              >
                Toast with an action
              </Button>
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={() =>
                  toast.show({
                    id: "offline",
                    tone: "warning",
                    title: "You're offline",
                    message: "Showing toilets saved on this device.",
                    duration: null,
                  })
                }
              >
                Sticky warning toast
              </Button>
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={() => toast.show({ tone: "error", message: "Couldn't save. Try again." })}
              >
                Error toast
              </Button>
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={() => setToastPlacement((p) => (p === "bottom" ? "top" : "bottom"))}
              >
                Move toasts to the {toastPlacement === "bottom" ? "top" : "bottom"}
              </Button>
            </div>
          </Example>
          <Example label="Static, every tone (not live; duration null)">
            <Stack space="2xs">
              {TONES.map((tone) => (
                <Toast
                  key={tone}
                  tone={tone}
                  duration={null}
                  message={`${withArticle(tone)} toast`}
                  onDismiss={() => undefined}
                />
              ))}
            </Stack>
          </Example>
        </Section>

        <Section id="confirm" title="ConfirmDialog">
          <Example label="Open a dialog (a bottom sheet on narrow or touch screens)">
            <div class={styles.row}>
              <Button
                htmlElement="button"
                type="button"
                variant="primary"
                onClick={() => setDialog("default")}
              >
                Default
              </Button>
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={() => setDialog("destructive")}
              >
                Destructive
              </Button>
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={() => setDialog("busy")}
              >
                Busy while saving
              </Button>
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={() => setDialog("locked")}
              >
                No Escape or backdrop
              </Button>
            </div>
            <p class={styles.result} aria-live="polite">
              {dialogResult && `Last choice: ${dialogResult}`}
            </p>
          </Example>
          <ConfirmDialog
            open={dialog === "default"}
            title="Save the new location?"
            confirmLabel="Yes, save the new location"
            cancelLabel="No, keep the old location"
            onConfirm={() => closeDialog("saved")}
            onCancel={() => closeDialog("kept the old location")}
            onDismiss={() => closeDialog("dismissed")}
          >
            <p>You moved the pin 120 m.</p>
          </ConfirmDialog>
          <ConfirmDialog
            open={dialog === "destructive"}
            tone="destructive"
            title="Discard your changes?"
            confirmLabel="Discard changes"
            cancelLabel="Keep editing"
            onConfirm={() => closeDialog("discarded")}
            onCancel={() => closeDialog("kept editing")}
          >
            <p>You've made 2 changes that haven't been saved.</p>
          </ConfirmDialog>
          <ConfirmDialog
            open={dialog === "busy"}
            title="Is it still here?"
            confirmLabel="Restore it"
            busyLabel="Restoring…"
            onConfirm={async () => {
              await wait(1500);
              closeDialog("restored");
              toast.show({ message: "Thanks — the toilet is back on the map" });
            }}
            onCancel={() => closeDialog("cancelled")}
          >
            <p>Restoring puts it back on the map for everyone.</p>
          </ConfirmDialog>
          <ConfirmDialog
            open={dialog === "locked"}
            title="Is the pin on the toilet?"
            confirmLabel="Yes, it's on the toilet"
            cancelLabel="Move the map"
            closeOnEscape={false}
            closeOnBackdrop={false}
            showCloseButton={false}
            onConfirm={() => closeDialog("confirmed the pin")}
            onCancel={() => closeDialog("moving the map")}
          >
            <p>You haven't moved the map, so the pin is where the map opened.</p>
          </ConfirmDialog>
        </Section>

        <Section id="buttons" title="Buttons">
          <Example label="Button: primary, secondary, destructive, disabled, link">
            <div class={styles.row}>
              <Button htmlElement="button" type="button" variant="primary">
                Primary
              </Button>
              <Button htmlElement="button" type="button" variant="secondary">
                Secondary
              </Button>
              <Button htmlElement="button" type="button" variant="destructive">
                Destructive
              </Button>
              <Button htmlElement="button" type="button" variant="primary" disabled>
                Disabled
              </Button>
              <Button htmlElement="a" variant="secondary" href="#buttons-title">
                Link as a button
              </Button>
              <Button htmlElement="button" type="button" variant="primary">
                <Icon icon="plus" /> With an icon
              </Button>
            </div>
          </Example>
          <Example label="IconButton: ghost and filled, every size">
            <div class={styles.row}>
              {(["small", "medium", "large", "x-large"] as const).map((size) => (
                <IconButton
                  key={`g-${size}`}
                  icon="gear"
                  size={size}
                  aria-label={`Ghost ${size}`}
                />
              ))}
              {(["small", "medium", "large", "x-large"] as const).map((size) => (
                <IconButton
                  key={`f-${size}`}
                  icon="plus"
                  size={size}
                  variant="filled"
                  aria-label={`Filled ${size}`}
                />
              ))}
            </div>
          </Example>
        </Section>

        <Section id="chips" title="Badge and Tag">
          <Example label="Badge: neutral and every tone">
            <div class={styles.row}>
              <Badge>Neutral</Badge>
              {TONES.map((tone) => (
                <Badge key={tone} tone={tone}>
                  {tone[0].toUpperCase() + tone.slice(1)}
                </Badge>
              ))}
            </div>
          </Example>
          <Example label="Tag: inactive, active (toggles)">
            <div class={styles.row}>
              <Tag>Inactive</Tag>
              <Tag active={activeTag} onClick={() => setActiveTag((a) => !a)}>
                Toggle me
              </Tag>
            </div>
          </Example>
        </Section>

        <Section id="inputs" title="Form inputs">
          <Example label="InputField: empty, filled, disabled">
            <Stack space="2xs">
              <label for="ks-name">Name</label>
              <InputField id="ks-name" placeholder="e.g. High Street toilets" />
              <label for="ks-filled">Filled</label>
              <InputField id="ks-filled" value="Market Square" />
              <label for="ks-disabled">Disabled</label>
              <InputField id="ks-disabled" value="Can't change this" disabled />
            </Stack>
          </Example>
          <Example label="TextArea">
            <Stack space="2xs">
              <label for="ks-notes">Notes</label>
              <TextArea id="ks-notes" rows={3} placeholder="Anything else people should know" />
            </Stack>
          </Example>
          <Example label="RadioInput">
            <fieldset class={styles.fieldset}>
              <legend>Payment</legend>
              <span class={styles.inline}>
                <RadioInput id="ks-free" {...radio("free", true)} />
                <label for="ks-free">Free</label>
              </span>
              <span class={styles.inline}>
                <RadioInput id="ks-paid" {...radio("paid")} />
                <label for="ks-paid">Paid</label>
              </span>
            </fieldset>
          </Example>
          <Example label="Switch">
            <span class={styles.inline}>
              <Switch checked={switchOn} onChange={setSwitchOn} aria-labelledby="ks-switch-label" />
              <span id="ks-switch-label">Show closed toilets</span> ({switchOn ? "on" : "off"})
            </span>
          </Example>
          <Example label="TriStateToggle: interactive, with a hint, with an error">
            <Stack space="s">
              <TriStateToggle
                name="ks-accessible"
                label="Accessible"
                value={toggle}
                onChange={setToggle}
              />
              <TriStateToggle
                name="ks-baby"
                label="Baby changing"
                value="true"
                onChange={() => undefined}
                hint="A changing table or a fold-down shelf"
              />
              <TriStateToggle
                name="ks-radar"
                label="RADAR key"
                value="false"
                onChange={() => undefined}
                error="Choose an answer"
              />
            </Stack>
          </Example>
        </Section>

        <Section id="hours" title="Opening hours">
          <Example label="OpeningHoursInput">
            <OpeningHoursInput value={hours} onChange={setHours} label="Opening hours" />
          </Example>
          <Example label="OpeningHoursInput with an error">
            <OpeningHoursInput
              value={null}
              onChange={() => undefined}
              label="Opening hours with an error"
              error="Choose whether you know the opening hours"
            />
          </Example>
        </Section>

        <Section id="sheets" title="Sheets and drawers">
          <Example label="Sheet (modal side or bottom panel)">
            <div class={styles.row}>
              {(["bottom", "left", "right"] as const).map((side) => (
                <Button
                  key={side}
                  htmlElement="button"
                  type="button"
                  variant="secondary"
                  onClick={() => setSheet(side)}
                >
                  Open {side} sheet
                </Button>
              ))}
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={() => setDrawerOpen((open) => !open)}
              >
                {drawerOpen ? "Close" : "Open"} drawer
              </Button>
            </div>
          </Example>
          <Example label="BottomSheet (non-modal, peek and expanded) over a MapOverlay">
            <div class={styles.mapStage}>
              <MapOverlay>
                <IconButton icon="plus" variant="filled" aria-label="Zoom in" />
              </MapOverlay>
              {sheetGone ? (
                <Button
                  htmlElement="button"
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setSheetGone(false);
                    setSheetState("peek");
                  }}
                >
                  Show the bottom sheet
                </Button>
              ) : (
                <BottomSheet
                  state={sheetState}
                  onStateChange={setSheetState}
                  onDismiss={() => setSheetGone(true)}
                  aria-labelledby="ks-sheet-title"
                  handleLabel="Toilet details"
                >
                  <h3 id="ks-sheet-title" class={styles.sheetTitle}>
                    High Street toilets
                  </h3>
                  <p>State: {sheetState}. Drag or tap the handle; Escape collapses then closes.</p>
                  {sheetState === "expanded" && (
                    <p>Expanded content scrolls inside the sheet when it is taller than the cap.</p>
                  )}
                </BottomSheet>
              )}
            </div>
          </Example>
          <Sheet visible={sheet !== null} side={sheet ?? "bottom"} onClose={() => setSheet(null)}>
            <div class={styles.sheetBody}>
              <h3 class={styles.sheetTitle}>A {sheet} sheet</h3>
              <Button
                htmlElement="button"
                type="button"
                variant="primary"
                onClick={() => setSheet(null)}
              >
                Close
              </Button>
            </div>
          </Sheet>
          <Drawer visible={drawerOpen} animateFrom="right">
            <div class={styles.sheetBody}>
              <p>A drawer under the header.</p>
              <Button
                htmlElement="button"
                type="button"
                variant="secondary"
                onClick={() => setDrawerOpen(false)}
              >
                Close drawer
              </Button>
            </div>
          </Drawer>
        </Section>

        <Section id="icons" title="Icons">
          <ul class={styles.icons}>
            {ICONS.map((icon) => (
              <li key={icon}>
                <Icon icon={icon} size="large" />
                <code>{icon}</code>
              </li>
            ))}
          </ul>
          <Example label="Spinning">
            <Icon icon="spinner" size="large" spin aria-label="Loading" />
          </Example>
        </Section>

        <Section id="layout" title="Layout and utilities">
          <Example label="Logo">
            <div class={styles.logo}>
              <Logo src={logoSrc} />
            </div>
          </Example>
          <Example label="Stack (row, space xs)">
            <Stack direction="row" space="xs">
              <span class={styles.tile}>One</span>
              <span class={styles.tile}>Two</span>
              <span class={styles.tile}>Three</span>
            </Stack>
          </Example>
          <Example label="Center (text)">
            <Center text>
              <p>Centred text in a measure.</p>
            </Center>
          </Example>
          <Example label="VisuallyHidden (there is hidden text after this sentence)">
            <p>
              Visible text.
              <VisuallyHidden as="span"> Only screen readers read this.</VisuallyHidden>
            </p>
          </Example>
        </Section>
      </Center>

      <ToastRegion placement={toastPlacement} />
    </div>
  );
}
