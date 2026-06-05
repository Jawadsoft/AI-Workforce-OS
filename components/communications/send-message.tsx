'use client'

import { useState } from 'react'
import { api } from '@/lib/api'
import { toast } from 'sonner'

export function SendMessage() {
  const [channel, setChannel] = useState<'SMS' | 'WHATSAPP'>('SMS')
  const [to, setTo] = useState('')
  const [message, setMessage] = useState('')
  const [mediaUrl, setMediaUrl] = useState('')
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (!to || !message) {
      toast.error('Phone number and message are required')
      return
    }
    setSending(true)
    try {
      await api.post('/communications/send', {
        to,
        message,
        channel,
        ...(mediaUrl ? { mediaUrls: [mediaUrl] } : {}),
      })
      toast.success(`${channel} sent to ${to}`)
      setTo('')
      setMessage('')
      setMediaUrl('')
    } catch {
      toast.error('Failed to send message')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden max-w-lg">
      <div className="px-6 py-4 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900">Send a Message</h3>
        <p className="text-sm text-gray-500">Manually send SMS or WhatsApp from your Twilio number</p>
      </div>
      <div className="p-6 space-y-4">
        {/* Channel toggle */}
        <div className="flex gap-2">
          {(['SMS', 'WHATSAPP'] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => setChannel(ch)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                channel === ch
                  ? ch === 'SMS'
                    ? 'bg-blue-50 border-blue-300 text-blue-700'
                    : 'bg-green-50 border-green-300 text-green-700'
                  : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'
              }`}
            >
              {ch === 'SMS' ? '💬 SMS' : '📱 WhatsApp'}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To (phone number)</label>
          <input
            type="text"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="+15551234567"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message..."
            rows={3}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {channel === 'SMS' && (
            <p className="text-xs text-gray-400 mt-1">{message.length}/160 chars (SMS)</p>
          )}
        </div>

        {channel === 'WHATSAPP' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Media URL (optional)</label>
            <input
              type="url"
              value={mediaUrl}
              onChange={(e) => setMediaUrl(e.target.value)}
              placeholder="https://example.com/image.jpg"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">WhatsApp supports images, PDFs, and documents</p>
          </div>
        )}

        <button
          onClick={handleSend}
          disabled={sending || !to || !message}
          className={`w-full py-2.5 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 ${
            channel === 'SMS' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {sending ? 'Sending...' : `Send ${channel}`}
        </button>
      </div>
    </div>
  )
}
