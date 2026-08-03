import { Suspense } from 'react'
import { ChatPage } from '@/components/chat/chat-page'

// Remove layout padding and set exact height so chat fills the screen
// Mobile: subtract header (56px) + bottom nav (60px)
// Desktop: subtract header (56px) minus overlap adjustment (40px)
export default function Page() {
  return (
    <div className="-m-3 sm:-m-6 md:-m-8 h-[calc(100dvh-124px)] sm:h-[calc(100dvh-40px)] overflow-hidden flex flex-col">
      <Suspense>
        <ChatPage />
      </Suspense>
    </div>
  )
}
