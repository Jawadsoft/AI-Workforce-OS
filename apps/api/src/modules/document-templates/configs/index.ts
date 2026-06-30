import { baseDocumentTemplateConfig } from './base.config'
import { insuranceDocumentTemplateConfig } from './insurance.config'
import { automotiveDocumentTemplateConfig } from './automotive.config'
import { realEstateDocumentTemplateConfig } from './real-estate.config'
import { legalDocumentTemplateConfig } from './legal.config'
import { medicalDocumentTemplateConfig } from './medical.config'
import { homeServicesDocumentTemplateConfig } from './home-services.config'
import { financeDocumentTemplateConfig } from './finance.config'
import type { DocumentTemplateConfig } from './types'

// ─── Industry keyword map ──────────────────────────────────────────────────────
// Each entry: list of keywords that identify the industry (case-insensitive).
// First match wins. Order from most specific to most general.

const INDUSTRY_MAP: Array<{
  keywords: string[]
  config: Partial<DocumentTemplateConfig>
}> = [
  {
    keywords: ['insurance', 'roof', 'roofing', 'restoration', 'storm', 'claim', 'supplement'],
    config: insuranceDocumentTemplateConfig,
  },
  {
    keywords: ['auto', 'automotive', 'car', 'vehicle', 'dealership', 'mechanic', 'repair shop'],
    config: automotiveDocumentTemplateConfig,
  },
  {
    keywords: ['real estate', 'realty', 'realtor', 'property', 'mortgage', 'broker', 'listing', 'mls'],
    config: realEstateDocumentTemplateConfig,
  },
  {
    keywords: ['legal', 'law', 'attorney', 'lawyer', 'firm', 'counsel', 'litigation', 'paralegal'],
    config: legalDocumentTemplateConfig,
  },
  {
    keywords: ['medical', 'health', 'clinic', 'hospital', 'dental', 'physician', 'therapy', 'healthcare', 'chiropractic'],
    config: medicalDocumentTemplateConfig,
  },
  {
    keywords: ['home service', 'plumb', 'electric', 'hvac', 'landscap', 'pest', 'clean', 'paint', 'handyman', 'contractor', 'construction'],
    config: homeServicesDocumentTemplateConfig,
  },
  {
    keywords: ['finance', 'financial', 'accounting', 'tax', 'bookkeep', 'invest', 'wealth', 'banking', 'lending', 'credit'],
    config: financeDocumentTemplateConfig,
  },
]

// ─── Merge helper ─────────────────────────────────────────────────────────────

const mergeConfig = (override?: Partial<DocumentTemplateConfig>): DocumentTemplateConfig => ({
  placeholders: {
    ...baseDocumentTemplateConfig.placeholders,
    ...(override?.placeholders ?? {}),
  },
  designSystems: {
    ...baseDocumentTemplateConfig.designSystems,
    ...(override?.designSystems ?? {}),
  },
  sectionSpecs: {
    ...baseDocumentTemplateConfig.sectionSpecs,
    ...(override?.sectionSpecs ?? {}),
  },
})

// ─── Resolver ─────────────────────────────────────────────────────────────────

export function getDocumentTemplateConfig(industry?: string | null): DocumentTemplateConfig {
  if (!industry) return mergeConfig()

  const normalized = industry.toLowerCase()

  for (const entry of INDUSTRY_MAP) {
    if (entry.keywords.some(kw => normalized.includes(kw))) {
      return mergeConfig(entry.config)
    }
  }

  return mergeConfig()
}

export type { DocumentTemplateConfig }
