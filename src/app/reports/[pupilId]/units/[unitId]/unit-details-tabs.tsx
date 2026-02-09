'use client'

import { useState } from "react"

type TabProps = {
  loScView: React.ReactNode
  lessonActivityView: React.ReactNode
}

export function UnitDetailsTabs({ loScView, lessonActivityView }: TabProps) {
  const [activeTab, setActiveTab] = useState<'lo-sc' | 'lesson-activity'>('lo-sc')

  return (
    <div className="space-y-4">
      {/* Tab buttons */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab('lo-sc')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'lo-sc'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Learning Objectives & Success Criteria
        </button>
        <button
          onClick={() => setActiveTab('lesson-activity')}
          className={`px-4 py-2 font-medium transition-colors ${
            activeTab === 'lesson-activity'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Lessons & Activities
        </button>
      </div>

      {/* Tab content */}
      <div className="mt-4">
        {activeTab === 'lo-sc' && loScView}
        {activeTab === 'lesson-activity' && lessonActivityView}
      </div>
    </div>
  )
}
