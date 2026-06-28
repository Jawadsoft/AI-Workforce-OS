import { Spinner } from '@/components/shared/spinner'

export default function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <Spinner size="md" label="Loading" />
    </div>
  )
}
