import { MESSAGE_LIFETIMES } from '../../src/client/lib/message-lifetime'

/** Every supported lifetime, as one comma-separated line of labels. */
export const LIFETIME_CHOICES_TEXT = MESSAGE_LIFETIMES.map(lifetime => lifetime.label).join(', ')

export function lifetimeLabel(seconds: number): string {
  return MESSAGE_LIFETIMES.find(lifetime => lifetime.seconds === seconds)?.label ?? `${seconds}s`
}

/** Seconds for "300" or a label such as "5m"; null for anything that is not a supported lifetime. */
export function parseLifetime(value: string): number | null {
  const trimmed = value.trim().toLowerCase()
  const numeric = /^\d+$/.test(trimmed)
  const lifetime = MESSAGE_LIFETIMES.find(({ seconds, label }) => numeric ? seconds === Number(trimmed) : label === trimmed)
  return lifetime?.seconds ?? null
}

/** What a change of lifetime means, for a toast. */
export function lifetimeNotice(seconds: number): string {
  return `New messages disappear ${lifetimeLabel(seconds)} after they are opened`
}
