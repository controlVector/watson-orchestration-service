/**
 * Executor Service - Implements the planner-executor loop pattern
 * 
 * This service executes deployment plans by:
 * 1. Converting deployment plans into executable tool sequences
 * 2. Running planner-executor loop with real MCP tool calls
 * 3. Providing real-time execution feedback to users
 * 4. Handling execution errors and recovery
 */

import { EventEmitter } from 'events'
import { LLMService } from './LLMService'
import { MCPService } from './MCPService'

export interface ExecutionStep {
  id: string
  name: string
  description: string
  tool_name: string
  args: Record<string, any>
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  result?: any
  error?: string
  execution_time?: number
}

export interface ExecutionPlan {
  id: string
  conversation_id: string
  user_id: string
  workspace_id: string
  description: string
  steps: ExecutionStep[]
  status: 'pending' | 'executing' | 'completed' | 'failed' | 'cancelled'
  created_at: string
  started_at?: string
  completed_at?: string
  total_execution_time?: number
}

export class ExecutorService extends EventEmitter {
  private llmService: LLMService
  private mcpService: MCPService
  private activePlanExecutions: Map<string, ExecutionPlan> = new Map()

  constructor(llmService: LLMService, mcpService: MCPService) {
    super()
    this.llmService = llmService
    this.mcpService = mcpService
  }

  /**
   * Execute a deployment plan with real-time feedback
   */
  async executePlan(
    conversationId: string,
    userId: string,
    workspaceId: string,
    jwtToken: string,
    deploymentRequest: string
  ): Promise<ExecutionPlan> {
    
    // Step 1: Create execution plan from deployment request
    const plan = await this.createExecutionPlan(conversationId, userId, workspaceId, deploymentRequest)
    this.activePlanExecutions.set(plan.id, plan)

    // Step 2: Execute plan with planner-executor loop
    this.executeStepsInBackground(plan, jwtToken)

    return plan
  }

  /**
   * Create structured execution plan from deployment request
   */
  private async createExecutionPlan(
    conversationId: string,
    userId: string,
    workspaceId: string,
    deploymentRequest: string
  ): Promise<ExecutionPlan> {
    
    const planId = `exec-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    
    // Parse deployment request into executable steps
    const steps: ExecutionStep[] = []

    // For RiskGuard deployment, create structured plan
    if (deploymentRequest.toLowerCase().includes('riskguard')) {
      steps.push({
        id: 'step-1',
        name: 'Create Droplet',
        description: 'Provision DigitalOcean droplet for RiskGuard application',
        tool_name: 'atlas_create_droplet',
        args: {
          name: 'riskguard-prod',
          size: 's-2vcpu-4gb',
          region: 'nyc3',
          domain: 'riskguard.controlvector.io',
          workspace_id: workspaceId,
          user_id: userId
        },
        status: 'pending'
      })

      steps.push({
        id: 'step-2',
        name: 'Deploy Application',
        description: 'Clone and deploy RiskGuard from GitHub to droplet',
        tool_name: 'phoenix_execute_deployment_plan',
        args: {
          repository_url: 'https://github.com/hulljs/RiskGuard',
          branch: 'jason',
          workspace_id: workspaceId,
          user_id: userId
        },
        status: 'pending'
      })

      steps.push({
        id: 'step-3',
        name: 'Configure DNS',
        description: 'Set up domain and SSL certificates',
        tool_name: 'neptune_configure_domain',
        args: {
          domain: 'riskguard.controlvector.io',
          workspace_id: workspaceId,
          user_id: userId
        },
        status: 'pending'
      })
    }

    const plan: ExecutionPlan = {
      id: planId,
      conversation_id: conversationId,
      user_id: userId,
      workspace_id: workspaceId,
      description: `Deploy ${deploymentRequest}`,
      steps,
      status: 'pending',
      created_at: new Date().toISOString()
    }

    return plan
  }

  /**
   * Execute plan steps in background with planner-executor loop
   */
  private async executeStepsInBackground(plan: ExecutionPlan, jwtToken: string): Promise<void> {
    plan.status = 'executing'
    plan.started_at = new Date().toISOString()

    // Emit start event
    this.emit('plan_started', {
      conversation_id: plan.conversation_id,
      plan_id: plan.id,
      total_steps: plan.steps.length
    })

    try {
      for (const step of plan.steps) {
        await this.executeStep(plan, step, jwtToken)
        
        // If step failed, halt execution
        if (step.status === 'failed') {
          plan.status = 'failed'
          break
        }
      }

      if (plan.status === 'executing') {
        plan.status = 'completed'
        plan.completed_at = new Date().toISOString()
      }

    } catch (error) {
      plan.status = 'failed'
      console.error('[Executor] Plan execution failed:', error)
    }

    // Emit completion event
    this.emit('plan_completed', {
      conversation_id: plan.conversation_id,
      plan_id: plan.id,
      status: plan.status,
      execution_time: plan.total_execution_time
    })
  }

  /**
   * Execute individual step using MCP tools
   */
  private async executeStep(plan: ExecutionPlan, step: ExecutionStep, jwtToken: string): Promise<void> {
    step.status = 'in_progress'
    const startTime = Date.now()

    // Emit step start
    this.emit('step_started', {
      conversation_id: plan.conversation_id,
      plan_id: plan.id,
      step_id: step.id,
      step_name: step.name
    })

    try {
      // Add JWT token to step args
      step.args.jwt_token = jwtToken

      // Execute the MCP tool based on tool name
      let result: any
      
      if (step.tool_name.startsWith('atlas_')) {
        const toolName = step.tool_name.replace('atlas_', '')
        result = await this.mcpService.callAtlasTool({ name: toolName, arguments: step.args }, jwtToken)
      } else if (step.tool_name.startsWith('phoenix_')) {
        const toolName = step.tool_name.replace('phoenix_', '')
        result = await this.mcpService.callPhoenixTool({ name: toolName, arguments: step.args }, jwtToken)
      } else if (step.tool_name.startsWith('neptune_')) {
        const toolName = step.tool_name.replace('neptune_', '')
        result = await this.mcpService.callNeptuneTool({ name: toolName, arguments: step.args }, jwtToken)
      } else {
        throw new Error(`Unknown tool: ${step.tool_name}`)
      }

      step.result = result
      step.status = 'completed'
      step.execution_time = Date.now() - startTime

      // Emit step completion
      this.emit('step_completed', {
        conversation_id: plan.conversation_id,
        plan_id: plan.id,
        step_id: step.id,
        step_name: step.name,
        result: result,
        execution_time: step.execution_time
      })

    } catch (error) {
      step.status = 'failed'
      step.error = error instanceof Error ? error.message : 'Unknown error'
      step.execution_time = Date.now() - startTime

      // Emit step failure
      this.emit('step_failed', {
        conversation_id: plan.conversation_id,
        plan_id: plan.id,
        step_id: step.id,
        step_name: step.name,
        error: step.error,
        execution_time: step.execution_time
      })

      console.error(`[Executor] Step ${step.id} failed:`, error)
    }
  }

  /**
   * Get execution plan status
   */
  getExecutionPlan(planId: string): ExecutionPlan | undefined {
    return this.activePlanExecutions.get(planId)
  }

  /**
   * Cancel execution plan
   */
  cancelExecution(planId: string): boolean {
    const plan = this.activePlanExecutions.get(planId)
    if (plan && plan.status === 'executing') {
      plan.status = 'cancelled'
      this.emit('plan_cancelled', {
        conversation_id: plan.conversation_id,
        plan_id: planId
      })
      return true
    }
    return false
  }
}