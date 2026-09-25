export const DEFAULT_FREE_DIALOG_MESSAGES = 50;
export const DEFAULT_SUBSCRIBER_DIALOG_MESSAGES = 100;
export const DEFAULT_TWO_YEAR_DIALOG_MESSAGES = 200;
export const DEFAULT_USER_MESSAGE_MAX_CHARS = 4096;

export function dialogMessageLimitForPlan(
  planKey: string | null | undefined,
  free = DEFAULT_FREE_DIALOG_MESSAGES,
  subscriber = DEFAULT_SUBSCRIBER_DIALOG_MESSAGES,
  twoYear = DEFAULT_TWO_YEAR_DIALOG_MESSAGES
): number {
  if (planKey === 'sub-2y') return Math.max(1, Math.floor(twoYear));
  if (planKey) return Math.max(1, Math.floor(subscriber));
  return Math.max(1, Math.floor(free));
}
