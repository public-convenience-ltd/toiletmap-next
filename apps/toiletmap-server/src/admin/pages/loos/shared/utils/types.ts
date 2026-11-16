import type { OpeningTimes } from "../../../../../services/loo/types";
import type { BooleanValue, FieldErrors, TriStateValue } from "./form-helpers";

export type { BooleanValue, FieldErrors, TriStateValue };

export type LooFormState = {
  name: string;
  notes: string;
  lat: string;
  lng: string;
  accessible: TriStateValue;
  radar: TriStateValue;
  attended: TriStateValue;
  automatic: TriStateValue;
  noPayment: TriStateValue;
  paymentDetails: string;
  babyChange: TriStateValue;
  men: TriStateValue;
  women: TriStateValue;
  allGender: TriStateValue;
  children: TriStateValue;
  urinalOnly: TriStateValue;
  /** Two-state only: the public API never accepts `active: null`. */
  active: BooleanValue;
  removalReason: string;
  openingTimes: OpeningTimes;
};

export type SubmissionStatus = "idle" | "saving" | "success" | "error";
