/// <reference types="vite/client" />

import type { ReferenceScreen } from '@/types'

declare global {
  interface Window {
    __screenManifest: ReferenceScreen[]
    __openAction: (action: string) => void
    __setModalTab: (tab: string) => void
    __prototypeReady: boolean
  }
}

export {}
