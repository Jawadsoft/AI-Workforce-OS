'use client'

import { useState, useRef } from 'react'
import { Upload, Loader2, FileText, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { toast } from 'sonner'

const ACCEPTED = '.pdf,.txt,.md,.docx,.csv'
const MAX_MB = 20

export function KnowledgeUpload() {
  const qc = useQueryClient()
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = (f: File) => {
    if (f.size > MAX_MB * 1024 * 1024) { toast.error(`File too large (max ${MAX_MB}MB)`); return }
    setFile(f)
    setShowModal(true)
  }

  const upload = async () => {
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const token = localStorage.getItem('access_token')
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1'}/knowledge/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) throw new Error(`Upload failed: ${res.statusText}`)
      toast.success(`"${file.name}" uploaded — processing in background`)
      setShowModal(false)
      setFile(null)
      qc.invalidateQueries({ queryKey: ['knowledge'] })
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => inputRef.current?.click()}
        className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 transition-colors"
      >
        <Upload className="w-4 h-4" /> Upload Document
      </button>

      <input ref={inputRef} type="file" accept={ACCEPTED} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }} />

      {/* Drop zone modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-card rounded-xl border border-border p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">Upload Document</h2>
              <button onClick={() => { setShowModal(false); setFile(null) }} className="p-1 hover:bg-accent rounded"><X className="w-4 h-4" /></button>
            </div>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              onClick={() => !file && inputRef.current?.click()}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground'}`}
            >
              {file ? (
                <div className="flex items-center gap-3 justify-center">
                  <FileText className="w-8 h-8 text-primary" />
                  <div className="text-left">
                    <p className="font-medium text-sm">{file.name}</p>
                    <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
                  </div>
                  <button onClick={e => { e.stopPropagation(); setFile(null) }} className="ml-auto p-1 hover:bg-accent rounded">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium">Drop file here or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">PDF, DOCX, TXT, MD, CSV · Max {MAX_MB}MB</p>
                </>
              )}
            </div>

            <p className="text-xs text-muted-foreground">
              Documents are split into chunks and embedded with OpenAI. Agents assigned this document will cite it in conversations.
            </p>

            <div className="flex justify-end gap-2">
              <button onClick={() => { setShowModal(false); setFile(null) }} className="px-4 py-2 text-sm border border-border rounded-md hover:bg-accent transition-colors">Cancel</button>
              <button onClick={upload} disabled={!file || uploading}
                className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm hover:bg-primary/90 disabled:opacity-50 transition-colors">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Uploading...' : 'Upload & Process'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
