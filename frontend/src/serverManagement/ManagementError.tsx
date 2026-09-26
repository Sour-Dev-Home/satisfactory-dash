import { ErrorNotice } from "../components/ErrorNotice";
import { managementErrorText } from "./messages";

/** A failed save, test or remove: the management codes in their own words, anything else as usual. */
export function ManagementError({ error }: { error: unknown }) {
  const text = managementErrorText(error);
  return text ? <p role="alert">{text}</p> : <ErrorNotice error={error} />;
}
