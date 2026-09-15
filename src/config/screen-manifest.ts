import reference from './reference-screens.json'
import type { ReferenceScreen } from '@/types'

export const screenManifest = (reference.screens as ReferenceScreen[])
  .map(({ id, hash, action, modalTab, label }) => ({ id, hash, action, modalTab, label }))

export const referenceQuality = {
  total: screenManifest.length,
  errors: reference.errors.length,
  narrowChecks: reference.narrowChecks,
}
