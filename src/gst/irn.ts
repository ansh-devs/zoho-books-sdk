/** IRN cancellation window enforced by the IRP (India): 24 hours after ack. */
export const IRN_CANCEL_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an IRN acknowledged at `ackDate` can still be cancelled through the
 * IRP. After 24 h it must be "marked as cancelled" and cancelled on the GST
 * portal manually.
 */
export function canCancelIrn(ackDate: string | Date | undefined, now: Date = new Date()): boolean {
  if (!ackDate) return false;
  const t = ackDate instanceof Date ? ackDate.getTime() : Date.parse(ackDate.replace(' ', 'T'));
  if (Number.isNaN(t)) return false;
  return now.getTime() - t < IRN_CANCEL_WINDOW_MS;
}
