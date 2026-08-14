/**
 * Browser half apply: register the NewAPI copy dictionary and, once the
 * `settings.section` declaration is on the ledger, one settings page of our
 * own. Zero dsh modifications — the section slot is `kind: 'list'`, built for
 * feature-owned pages ("adding a setting never means editing the shell").
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ctx.locale Context merge into this program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { NewApiSection } from './NewApiSection.tsx'
import type { NewApiKey } from './locale.ts'
import { en, zh } from './locale.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The NewAPI settings section copy. */
    'settings.newapi': NewApiKey
  }
}

/** Copy namespace owned by this plugin. */
const NS = 'settings.newapi'

/** Required services (cordis fiber inject): the section slot, copy, and the wire face. */
export const inject = ['slots', 'locale', 'connection']

/**
 * Register the NewAPI settings section.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-newapi: copy dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const t = ctx.locale.bind(NS) as (key: NewApiKey) => string

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'newapi',
    order: 15,
    label: () => t('nav'),
    inject: () => ({ api: connection.api, t }),
  }, NewApiSection))
}
