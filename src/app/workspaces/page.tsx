import { WorkspacesTabs } from '@/components/WorkspacesTabs'

export const dynamic = 'force-dynamic'

export default function Page() {
  return (
    <div className="px-4 py-6 md:px-8">
      <WorkspacesTabs />
    </div>
  )
}
