import { ConferencePage } from '@/components/conference/conference-page'

export default function Page() {
  return (
    <div className="-m-3 sm:-m-6 md:-m-8 h-[calc(100dvh-124px)] sm:h-[calc(100dvh-40px)] overflow-hidden flex flex-col p-3 sm:p-4">
      <ConferencePage />
    </div>
  )
}
