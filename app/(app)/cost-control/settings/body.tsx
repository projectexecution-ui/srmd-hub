import { getCcSettings } from '@/lib/cost-control/settings'
import { CcSettingsForm } from './settings-form'

/**
 * Internal Estimate settings (G4: one name everywhere). Rendered by
 * /cost-control/settings and by Admin › Hub › Internal Estimate settings;
 * both gate it to cost-control admins before calling this.
 *
 * Since 23 Sep 2026 (S1) the form holds only the module's own switches and
 * names. The people lists live on People › Powers and the Telegram switches on
 * Messages › Instant alerts, so this body no longer loads users.
 */
export async function InternalEstimateSettingsBody() {
  const settings = await getCcSettings()
  return <CcSettingsForm initial={settings} />
}
