/** The IRP allows IRN cancellation for 24 hours after acknowledgement. */
export const IRN_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True while the IRN can still be cancelled on the IRP. After that, cancel on the GST portal and mark it cancelled. */
export function canCancelIrn(ackDate: string | Date | undefined, now: Date = new Date()): boolean {
  if (!ackDate) return false;
  const t = ackDate instanceof Date ? ackDate.getTime() : Date.parse(ackDate.replace(' ', 'T'));
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < IRN_CANCEL_WINDOW_MS;
}
