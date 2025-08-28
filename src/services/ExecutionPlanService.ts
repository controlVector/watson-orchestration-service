import { EventEmitter } from 'events'

export interface ExecutionStep {
  id: string
  service: string
  action: string
  description: string
  parameters: any
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'skipped'
  result?: any
  error?: string
  estimatedTime?: string
}

export interface ExecutionPlan {
  id: string
  conversationId: string
  userId: string
  workspaceId: string
  objective: string
  steps: ExecutionStep[]
  status: 'draft' | 'awaiting_approval' | 'approved' | 'executing' | 'completed' | 'failed'
  createdAt: string
  approvedAt?: string
  completedAt?: string
  totalEstimatedTime?: string
}

export class ExecutionPlanService extends EventEmitter {
  private plans: Map<string, ExecutionPlan> = new Map()
  private activePlans: Map<string, ExecutionPlan> = new Map()

  /**
   * Create an execution plan from user intent
   */
  createExecutionPlan(
    conversationId: string,
    userId: string,
    workspaceId: string,
    objective: string,
    steps: Omit<ExecutionStep, 'id' | 'status'>[]
  ): ExecutionPlan {
    const plan: ExecutionPlan = {
      id: crypto.randomUUID(),
      conversationId,
      userId,
      workspaceId,
      objective,
      steps: steps.map(step => ({
        ...step,
        id: crypto.randomUUID(),
        status: 'pending'
      })),
      status: 'draft',
      createdAt: new Date().toISOString(),
      totalEstimatedTime: this.calculateTotalTime(steps)
    }

    this.plans.set(plan.id, plan)
    this.emit('plan:created', plan)
    
    return plan
  }

  /**
   * Present plan for user approval
   */
  formatPlanForApproval(plan: ExecutionPlan): string {
    const lines = [
      `## 📋 Execution Plan: ${plan.objective}`,
      '',
      `**Total Steps**: ${plan.steps.length}`,
      `**Estimated Time**: ${plan.totalEstimatedTime || 'Unknown'}`,
      '',
      '### Steps to Execute:',
      ''
    ]

    plan.steps.forEach((step, index) => {
      const statusIcon = this.getStatusIcon(step.status)
      lines.push(`${index + 1}. ${statusIcon} ${step.description}`)
      lines.push(`   - Service: ${step.service}`)
      lines.push(`   - Action: ${step.action}`)
      if (step.estimatedTime) {
        lines.push(`   - Estimated Time: ${step.estimatedTime}`)
      }
      if (step.parameters && Object.keys(step.parameters).length > 0) {
        lines.push(`   - Parameters:`)
        Object.entries(step.parameters).forEach(([key, value]) => {
          if (typeof value === 'object') {
            lines.push(`     - ${key}: ${JSON.stringify(value, null, 2).split('\n').join('\n       ')}`)
          } else {
            lines.push(`     - ${key}: ${value}`)
          }
        })
      }
      lines.push('')
    })

    lines.push('---')
    lines.push('🔐 **Safety Notice**: This plan will make real changes to your infrastructure.')
    lines.push('')
    lines.push('**Do you want to execute this plan?**')
    lines.push('- Reply "yes" or "execute" to proceed')
    lines.push('- Reply "no" or "cancel" to abort')
    lines.push('- Reply "modify" to adjust the plan')

    return lines.join('\n')
  }

  /**
   * Request user approval for a plan
   */
  async requestApproval(plan: ExecutionPlan): Promise<void> {
    plan.status = 'awaiting_approval'
    this.plans.set(plan.id, plan)
    this.emit('plan:awaiting_approval', plan)
  }

  /**
   * Approve a plan for execution
   */
  approvePlan(planId: string): ExecutionPlan | null {
    const plan = this.plans.get(planId)
    if (!plan || plan.status !== 'awaiting_approval') {
      return null
    }

    plan.status = 'approved'
    plan.approvedAt = new Date().toISOString()
    this.activePlans.set(plan.conversationId, plan)
    this.emit('plan:approved', plan)
    
    return plan
  }

  /**
   * Execute a single step in the plan
   */
  async executeStep(planId: string, stepId: string): Promise<ExecutionStep | null> {
    const plan = this.plans.get(planId)
    if (!plan) return null

    const step = plan.steps.find(s => s.id === stepId)
    if (!step) return null

    step.status = 'executing'
    this.emit('step:executing', { plan, step })

    // The actual execution will be handled by the LLMService
    // This just tracks the status
    return step
  }

  /**
   * Mark a step as completed
   */
  completeStep(planId: string, stepId: string, result: any): void {
    const plan = this.plans.get(planId)
    if (!plan) return

    const step = plan.steps.find(s => s.id === stepId)
    if (!step) return

    step.status = 'completed'
    step.result = result
    this.emit('step:completed', { plan, step })

    // Check if all steps are completed
    if (plan.steps.every(s => s.status === 'completed' || s.status === 'skipped')) {
      plan.status = 'completed'
      plan.completedAt = new Date().toISOString()
      this.emit('plan:completed', plan)
      this.activePlans.delete(plan.conversationId)
    }
  }

  /**
   * Mark a step as failed
   */
  failStep(planId: string, stepId: string, error: string): void {
    const plan = this.plans.get(planId)
    if (!plan) return

    const step = plan.steps.find(s => s.id === stepId)
    if (!step) return

    step.status = 'failed'
    step.error = error
    this.emit('step:failed', { plan, step })
  }

  /**
   * Get the active plan for a conversation
   */
  getActivePlan(conversationId: string): ExecutionPlan | undefined {
    return this.activePlans.get(conversationId)
  }

  /**
   * Cancel a plan
   */
  cancelPlan(planId: string): void {
    const plan = this.plans.get(planId)
    if (!plan) return

    plan.status = 'failed'
    this.activePlans.delete(plan.conversationId)
    this.emit('plan:cancelled', plan)
  }

  /**
   * Get execution progress for a plan
   */
  getProgress(planId: string): { completed: number; total: number; percentage: number } {
    const plan = this.plans.get(planId)
    if (!plan) return { completed: 0, total: 0, percentage: 0 }

    const completed = plan.steps.filter(s => 
      s.status === 'completed' || s.status === 'skipped'
    ).length

    return {
      completed,
      total: plan.steps.length,
      percentage: Math.round((completed / plan.steps.length) * 100)
    }
  }

  /**
   * Parse user response to approval request
   */
  parseApprovalResponse(message: string): 'approve' | 'reject' | 'modify' | 'unknown' {
    const normalized = message.toLowerCase().trim()
    
    if (['yes', 'y', 'execute', 'run', 'go', 'proceed', 'approve'].includes(normalized)) {
      return 'approve'
    }
    
    if (['no', 'n', 'cancel', 'abort', 'stop', 'reject'].includes(normalized)) {
      return 'reject'
    }
    
    if (['modify', 'edit', 'change', 'adjust'].includes(normalized)) {
      return 'modify'
    }
    
    return 'unknown'
  }

  private calculateTotalTime(steps: any[]): string {
    // Simple estimation based on step count and types
    const baseTime = 30 // seconds per step
    const totalSeconds = steps.length * baseTime
    
    if (totalSeconds < 60) {
      return `${totalSeconds} seconds`
    } else if (totalSeconds < 3600) {
      return `${Math.ceil(totalSeconds / 60)} minutes`
    } else {
      return `${Math.ceil(totalSeconds / 3600)} hours`
    }
  }

  private getStatusIcon(status: ExecutionStep['status']): string {
    switch (status) {
      case 'pending': return '⏳'
      case 'approved': return '✅'
      case 'executing': return '🔄'
      case 'completed': return '✅'
      case 'failed': return '❌'
      case 'skipped': return '⏭️'
      default: return '❓'
    }
  }
}