'use client'

import { useState } from 'react'
import { CommunicationsSettings } from './communications-settings'
import { CommunicationsLogs } from './communications-logs'
import { SendMessage } from './send-message'

type Tab = 'logs' | 'send' | 'settings'

export function CommunicationsPage() {
  const [tab, setTab] = useState<Tab>('logs')

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'logs', label: 'Message Logs', icon: '📋' },
    { id: 'send', label: 'Send Message', icon: '📤' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
  ]

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Communications</h1>
          <p className="text-sm text-gray-500 mt-1">
            SMS, WhatsApp, and Voice — powered by Twilio. AI agents respond automatically to inbound messages.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full">
            💬 SMS
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 rounded-full">
            📱 WhatsApp
          </span>
          <span className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-50 text-purple-700 rounded-full">
            📞 Voice
          </span>
        </div>
      </div>

      {/* How it works banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-xl p-4">
        <div className="flex flex-wrap gap-4 text-sm">
          <div className="flex items-start gap-2">
            <span className="text-lg">1️⃣</span>
            <div>
              <div className="font-medium text-gray-800">Customer texts/calls</div>
              <div className="text-gray-500 text-xs">Your Twilio number receives the message</div>
            </div>
          </div>
          <div className="flex items-center text-gray-300">→</div>
          <div className="flex items-start gap-2">
            <span className="text-lg">2️⃣</span>
            <div>
              <div className="font-medium text-gray-800">AI Agent responds</div>
              <div className="text-gray-500 text-xs">With CRM context + brain knowledge</div>
            </div>
          </div>
          <div className="flex items-center text-gray-300">→</div>
          <div className="flex items-start gap-2">
            <span className="text-lg">3️⃣</span>
            <div>
              <div className="font-medium text-gray-800">Saved as conversation</div>
              <div className="text-gray-500 text-xs">Full history in your dashboard</div>
            </div>
          </div>
          <div className="flex items-center text-gray-300">→</div>
          <div className="flex items-start gap-2">
            <span className="text-lg">4️⃣</span>
            <div>
              <div className="font-medium text-gray-800">Approval alerts sent</div>
              <div className="text-gray-500 text-xs">SMS/WhatsApp notify your team</div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'logs' && <CommunicationsLogs />}
      {tab === 'send' && <SendMessage />}
      {tab === 'settings' && <CommunicationsSettings />}
    </div>
  )
}
