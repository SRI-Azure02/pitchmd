'use client'

import * as React from 'react'
import { GripVerticalIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

// react-resizable-panels v4 changed its export API and is not used anywhere
// in the app. Stubbed with plain div wrappers so the build passes.

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full', className)}
      {...props}
    />
  )
}

function ResizablePanel({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="resizable-panel" className={cn('flex-1', className)} {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<'div'> & { withHandle?: boolean }) {
  return (
    <div
      data-slot="resizable-handle"
      className={cn('bg-border relative flex w-px items-center justify-center', className)}
      {...props}
    >
      {withHandle && (
        <div className="bg-border z-10 flex h-4 w-3 items-center justify-center rounded-xs border">
          <GripVerticalIcon className="size-2.5" />
        </div>
      )}
    </div>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
