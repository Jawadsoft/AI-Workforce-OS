export const FEATURES = {
  // Core platform features
  WIDGET:               'widget',
  DOCUMENT_GENERATION:  'document_generation',
  CRM_INTEGRATION:      'crm_integration',
  EMAIL_SCANNER:        'email_scanner',
  TWILIO_COMMUNICATIONS:'twilio_communications',
  STORM_DATA:           'storm_data',
  MARKETPLACE:          'marketplace',
  CREATE_AGENTS:        'create_agents',
  RESET_WORKFORCE:      'reset_workforce',

  // New modules
  FILE_UPLOADS:         'file_uploads',
  SOCIAL_MEDIA:         'social_media',
  BLOG_GENERATION:      'blog_generation',
  GOOGLE_REVIEWS:       'google_reviews',
  FOLLOW_UP_SEQUENCES:  'follow_up_sequences',
  CALENDAR_INTEGRATION: 'calendar_integration',
  SMS_TOOLS:            'sms_tools',
  AGENT_ANALYTICS:      'agent_analytics',
  CONFERENCE:           'conference',
} as const

export type FeatureKey = typeof FEATURES[keyof typeof FEATURES]

export const ALL_FEATURES: FeatureKey[] = Object.values(FEATURES)

export const DEFAULT_ENABLED_FEATURES: FeatureKey[] = [
  FEATURES.WIDGET,
  FEATURES.DOCUMENT_GENERATION,
  FEATURES.MARKETPLACE,
  FEATURES.CREATE_AGENTS,
  FEATURES.RESET_WORKFORCE,
]
