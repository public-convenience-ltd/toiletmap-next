import { DAYS, formatRange, SHORT_DAYS, summariseOpeningTimes } from "@toiletmap/opening-hours";
import { Button, Icon, Notice } from "toiletmap-design-system";
import type { LooDetail } from "../../api/loos";
import { freshnessLine, isUniformWeek, paymentText, splitFacilities } from "./format";
import styles from "./ToiletDetailsPanel.module.css";

export const VERIFIED_MESSAGE = "Thanks!";
/** The verify button's accessible name; it reads "Yes" next to the "Still here?" prompt. */
export const VERIFY_LABEL = "Yes, it's still here";

export type VerifyState =
  | { status: "idle" | "sending" }
  | { status: "done"; verifiedAt: string }
  | { status: "error"; message: string };

export interface ToiletDetailsProps {
  id: string;
  toilet: LooDetail;
  isRemoved: boolean;
  /** Today's index (Mon = 0) in Europe/London. */
  today: number;
  verify: VerifyState;
  onVerify: () => void;
  /** The verified date to show (a fresh verification in this panel wins). */
  verifiedAt: string | null | undefined;
}

function OpeningHours({
  hours,
  today,
}: {
  hours: LooDetail["openingTimes"] | undefined;
  today: number;
}) {
  if (hours === null || hours === undefined) {
    return <p className={styles.muted}>Opening hours not known</p>;
  }
  // The same hours every day: one sentence says it all.
  if (isUniformWeek(hours)) {
    return <p className={styles.hoursSummary}>{summariseOpeningTimes(hours)}</p>;
  }
  return (
    <table className={styles.hoursTable}>
      <tbody>
        {DAYS.map((day, i) => (
          <tr
            key={day}
            className={i === today ? styles.today : undefined}
            aria-current={i === today ? "date" : undefined}
          >
            <th scope="row">
              <span aria-hidden="true">{SHORT_DAYS[i]}</span>
              <span className={styles.visuallyHidden}>
                {day}
                {i === today ? " (today)" : ""}
              </span>
            </th>
            <td>{hours[i] === undefined ? "Not known" : formatRange(hours[i])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Facilities({ toilet, editHref }: { toilet: LooDetail; editHref: string | null }) {
  const { known, unknown } = splitFacilities(toilet);
  const payment = paymentText(toilet);
  const addLink = editHref && (
    <a href={editHref} className={styles.inlineLink}>
      Add what you know
    </a>
  );

  if (known.length === 0 && payment === null) {
    return <p className={styles.unknownFacilities}>Facilities not known yet. {addLink}</p>;
  }

  return (
    <>
      <dl className={styles.facilities}>
        {known.map(({ key, label, icon, value }) => (
          <div key={key} className={styles.facility} data-answer={value ? "yes" : "no"}>
            <dt>
              <Icon icon={icon} size="small" />
              <span className={styles.facilityLabel}>{label}</span>
            </dt>
            <dd className={styles.answer}>
              <Icon icon={value ? "check" : "xmark"} size="small" />
              <span className={styles.visuallyHidden}>{value ? "Yes" : "No"}</span>
            </dd>
          </div>
        ))}
        {payment !== null && (
          <div className={`${styles.facility} ${styles.facilityWide}`}>
            <dt>
              <Icon icon="sterling-sign" size="small" />
              <span className={styles.facilityLabel}>Payment</span>
            </dt>
            <dd className={styles.payment}>{payment}</dd>
          </div>
        )}
      </dl>
      {unknown.length > 0 && (
        <p className={styles.unknownFacilities}>
          Not known: {unknown.join(", ")}. {addLink}
        </p>
      )}
    </>
  );
}

/**
 * Everything below the summary: hours, facilities, payment, notes, freshness and actions. A
 * removed toilet shows only its notes and when it was last updated: its hours and facilities
 * (often "not known") no longer help anyone find a toilet.
 */
export default function ToiletDetails({
  id,
  toilet,
  isRemoved,
  today,
  verify,
  onVerify,
  verifiedAt,
}: ToiletDetailsProps) {
  const looHref = `/loos/${encodeURIComponent(toilet.id)}`;
  const hours = toilet.openingTimes;
  const notes = typeof toilet.notes === "string" ? toilet.notes.trim() : "";

  return (
    <div id={id} className={styles.details}>
      {!isRemoved && (
        <section className={styles.section} aria-labelledby={`${id}-hours`}>
          <h3 id={`${id}-hours`} className={styles.sectionHeading}>
            Opening hours
          </h3>
          <OpeningHours hours={hours} today={today} />
          {hours !== null && hours !== undefined && (
            <p className={styles.smallNote}>Hours may vary on bank holidays.</p>
          )}
        </section>
      )}

      {!isRemoved && (
        <section className={styles.section} aria-labelledby={`${id}-facilities`}>
          <h3 id={`${id}-facilities`} className={styles.sectionHeading}>
            Facilities
          </h3>
          <Facilities toilet={toilet} editHref={`${looHref}/edit`} />
        </section>
      )}

      {notes && (
        <section className={styles.section} aria-labelledby={`${id}-notes`}>
          <h3 id={`${id}-notes`} className={styles.sectionHeading}>
            Notes
          </h3>
          <p className={styles.notes}>{notes}</p>
        </section>
      )}

      <section className={styles.section}>
        <p className={styles.freshness}>{freshnessLine(verifiedAt, toilet.updatedAt)}</p>
        {!isRemoved && (
          <>
            <div className={styles.verifyRow}>
              {verify.status !== "done" && (
                <>
                  <span className={styles.verifyPrompt}>Still here?</span>
                  <Button
                    htmlElement="button"
                    type="button"
                    variant="secondary"
                    class={styles.compactButton}
                    aria-label={VERIFY_LABEL}
                    onClick={onVerify}
                    disabled={verify.status === "sending"}
                    aria-busy={verify.status === "sending"}
                  >
                    Yes
                  </Button>
                </>
              )}
              {/* The live region stays on the page; the result is a compact DS Notice in it. */}
              <div role="status" className={styles.verifyStatus}>
                {verify.status === "done" && (
                  <Notice tone="success" size="compact" announce="off">
                    {VERIFIED_MESSAGE}
                  </Notice>
                )}
                {verify.status === "error" && (
                  <Notice tone="error" size="compact" announce="off">
                    {verify.message}
                  </Notice>
                )}
              </div>
            </div>
            <div className={styles.secondaryActions}>
              <a className={styles.textAction} href={`${looHref}/edit`}>
                <Icon icon="pen-to-square" size="small" />
                Suggest an edit
              </a>
              <a className={styles.textAction} href={`${looHref}/remove`}>
                <Icon icon="warning" size="small" />
                Report a problem
              </a>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
