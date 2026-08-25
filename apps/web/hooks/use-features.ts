'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export const FEATURES = {
  WIDGET:                'widget',
  DOCUMENT_GENERATION:   'document_generation',
  CRM_INTEGRATION:       'crm_integration',
  EMAIL_SCANNER:         'email_scanner',
  TWILIO_COMMUNICATIONS: 'twilio_communications',
  STORM_DATA:            'storm_data',
  MARKETPLACE:           'marketplace',
  CREATE_AGENTS:         'create_agents',
  RESET_WORKFORCE:       'reset_workforce',
  FILE_UPLOADS:          'file_uploads',
  SOCIAL_MEDIA:          'social_media',
  BLOG_GENERATION:       'blog_generation',
  GOOGLE_REVIEWS:        'google_reviews',
  FOLLOW_UP_SEQUENCES:   'follow_up_sequences',
  CALENDAR_INTEGRATION:  'calendar_integration',
  SMS_TOOLS:             'sms_tools',
  AGENT_ANALYTICS:       'agent_analytics',
  CONFERENCE:            'conference',
} as const

const DEFAULT_ENABLED = ['widget', 'document_generation', 'marketplace', 'create_agents', 'reset_workforce']

export function useFeatures() {
  const { data, isLoading } = useQuery({
    queryKey: ['tenant-features'],
    queryFn: () => api.get('/tenants/features').then((r) => r.data.features as string[]),
    staleTime: 5 * 60 * 1000,
    retry: 2,
  })

  // While the first fetch is still in flight, assume the sane defaults so the UI doesn't
  // flash empty. But if the fetch has settled and genuinely failed (data still undefined,
  // not loading), fail CLOSED — showing a gated feature just because the flags endpoint
  // errored would silently bypass whatever a superadmin explicitly disabled.
  const features = data ?? (isLoading ? DEFAULT_ENABLED : [])

  return {
    features,
    isLoading,
    isEnabled: (feature: string) => features.includes(feature),
    hasAny: (...featureList: string[]) => featureList.some((f) => features.includes(f)),
  }
}
