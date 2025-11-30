import type { OpeningTimes } from "../../../../../services/loo/types";
import type { FieldErrors, TriStateValue } from "./form-helpers";

export type { TriStateValue, FieldErrors };

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
  active: TriStateValue;
  removalReason: string;
  openingTimes: OpeningTimes;
};

export type SubmissionStatus = "idle" | "saving" | "success" | "error";
