import { EventEmitter } from 'eventemitter3'
import { v4 as uuidv4 } from 'uuid'
import {
  WorkflowDefinition,
  WorkflowExecution,
  WorkflowStep,
  WorkflowContext,
  WorkflowExecutionStatus,
  WorkflowStepType,
  WorkflowError,
  Intent,
  Entity
} from '../types'

export class WorkflowEngine extends EventEmitter {
  private executions: Map<string, WorkflowExecution> = new Map()
  private workflows: Map<string, WorkflowDefinition> = new Map()
  
  // Agent integrations
  private atlasClient: any
  private contextClient: any

  constructor(atlasClient?: any, contextClient?: any) {
    super()
    this.atlasClient = atlasClient
    this.contextClient = contextClient
    this.loadBuiltInWorkflows()
  }

  /**
   * Execute a workflow based on intent and entities
   */
  async executeWorkflow(
    workflowId: string,
    input: any,
    context: WorkflowContext
  ): Promise<WorkflowExecution> {
    const workflow = this.workflows.get(workflowId)
    if (!workflow) {
      throw new WorkflowError(`Workflow not found: ${workflowId}`, workflowId)
    }

    const execution: WorkflowExecution = {
      id: uuidv4(),
      workflow_id: workflowId,
      conversation_id: context.user_id + '_' + Date.now(),
      status: 'pending',
      input,
      context,
      current_step_id: undefined,
      completed_steps: [],
      failed_steps: [],
      outputs: {},
      started_at: new Date().toISOString(),
      progress: {
        total_steps: workflow.steps.length,
        completed_steps: 0
      }
    }

    this.executions.set(execution.id, execution)
    this.emit('workflow.started', execution)

    // Start execution asynchronously
    this.runExecution(execution).catch(error => {
      console.error('Workflow execution failed:', error)
      execution.status = 'failed'
      execution.error_message = error.message
      execution.completed_at = new Date().toISOString()
      this.emit('workflow.failed', execution)
    })

    return execution
  }

  /**
   * Get workflow execution by ID
   */
  getExecution(id: string): WorkflowExecution | undefined {
    return this.executions.get(id)
  }

  /**
   * Cancel workflow execution
   */
  async cancelExecution(id: string): Promise<boolean> {
    const execution = this.executions.get(id)
    if (!execution) return false

    if (execution.status === 'running' || execution.status === 'waiting_input') {
      execution.status = 'cancelled'
      execution.completed_at = new Date().toISOString()
      this.emit('workflow.cancelled', execution)
      return true
    }

    return false
  }

  async startWorkflow(workflowId: string, input: any): Promise<WorkflowExecution> {
    const execution = await this.createExecution(workflowId, input)
    this.runExecution(execution).catch((error: Error) => {
      execution.status = 'failed'
      execution.error_message = error.message
      this.emit('workflow.failed', execution)
    })
    return execution
  }

  private async createExecution(workflowId: string, input: any): Promise<WorkflowExecution> {
    const execution: WorkflowExecution = {
      id: uuidv4(),
      workflow_id: workflowId,
      conversation_id: input.conversation_id,
      status: 'pending',
      input,
      context: {
        user_id: input.user_id,
        workspace_id: input.workspace_id,
        existing_infrastructure: [],
        target_infrastructure: null,
        requirements: [],
        preferences: {
          preferred_cloud_provider: 'digitalocean',
          preferred_regions: ['nyc3'],
          cost_optimization: 'balanced',
          budget_alerts: true,
          deployment_style: 'balanced',
          auto_scaling: false,
          backup_frequency: 'daily',
          notification_channels: ['email'],
          progress_updates: 'normal',
          container_orchestration: 'none',
          ci_cd_integration: false,
          monitoring_level: 'basic'
        },
        estimated_costs: 0,
        resource_limits: {
          max_monthly_cost: 1000,
          max_instances: 10,
          max_storage_gb: 1000,
          max_bandwidth_gb: 1000
        }
      },
      current_step_id: undefined,
      completed_steps: [],
      failed_steps: [],
      outputs: {},
      started_at: new Date().toISOString(),
      progress: {
        total_steps: 0,
        completed_steps: 0
      }
    }

    const workflow = this.workflows.get(workflowId)
    if (workflow) {
      execution.progress.total_steps = workflow.steps.length
    }

    this.executions.set(execution.id, execution)
    return execution
  }

  /**
   * Resume workflow execution with user input
   */
  async resumeExecution(id: string, userInput: any): Promise<boolean> {
    const execution = this.executions.get(id)
    if (!execution || execution.status !== 'waiting_input') {
      return false
    }

    // Store user input in context
    (execution.context as any).user_input = userInput
    execution.status = 'running'

    // Resume execution
    this.runExecution(execution).catch((error: Error) => {
      execution.status = 'failed'
      execution.error_message = error.message
      this.emit('workflow.failed', execution)
    })

    return true
  }

  /**
   * Run workflow execution
   */
  private async runExecution(execution: WorkflowExecution): Promise<void> {
    execution.status = 'running'
    this.emit('workflow.progress', execution)

    const workflow = this.workflows.get(execution.workflow_id)!
    
    try {
      // Find next step to execute
      let currentStep = this.findNextStep(workflow, execution)
      
      while (currentStep && execution.status === 'running') {
        execution.current_step_id = currentStep.id
        execution.progress.current_step_description = currentStep.description

        this.emit('workflow.progress', execution)

        const result = await this.executeStep(currentStep, execution)

        if (result.status === 'completed') {
          execution.completed_steps.push(currentStep.id)
          execution.progress.completed_steps++
          
          // Store step outputs
          execution.outputs[currentStep.id] = result.output

          // Find next step
          currentStep = this.findNextStep(workflow, execution)
          
        } else if (result.status === 'waiting_input') {
          execution.status = 'waiting_input'
          this.emit('workflow.waiting_input', execution)
          return
          
        } else if (result.status === 'waiting_approval') {
          execution.status = 'waiting_approval'
          this.emit('workflow.waiting_approval', execution)
          return
          
        } else {
          // Step failed
          execution.failed_steps.push(currentStep.id)
          throw new WorkflowError(
            `Step ${currentStep.id} failed: ${result.error}`,
            execution.workflow_id,
            currentStep.id
          )
        }
      }

      // Workflow completed
      execution.status = 'completed'
      execution.completed_at = new Date().toISOString()
      execution.duration_ms = Date.now() - new Date(execution.started_at).getTime()
      
      this.emit('workflow.completed', execution)
      
    } catch (error) {
      execution.status = 'failed'
      execution.error_message = error instanceof Error ? error.message : 'Unknown error'
      execution.completed_at = new Date().toISOString()
      
      this.emit('workflow.failed', execution)
    }
  }

  /**
   * Find the next step to execute
   */
  private findNextStep(workflow: WorkflowDefinition, execution: WorkflowExecution): WorkflowStep | null {
    // Simple sequential execution for now
    const completedCount = execution.completed_steps.length
    
    if (completedCount < workflow.steps.length) {
      const nextStep = workflow.steps[completedCount]
      
      // Check if all dependencies are completed
      const dependenciesMet = nextStep.depends_on.every(depId => 
        execution.completed_steps.includes(depId)
      )
      
      if (dependenciesMet && this.evaluateConditions(nextStep, execution)) {
        return nextStep
      }
    }
    
    return null
  }

  /**
   * Evaluate step conditions
   */
  private evaluateConditions(step: WorkflowStep, execution: WorkflowExecution): boolean {
    if (!step.conditions || step.conditions.length === 0) return true

    return step.conditions.every(condition => {
      const value = this.getContextValue(condition.field, execution)
      
      switch (condition.operator) {
        case 'equals': return value === condition.value
        case 'not_equals': return value !== condition.value
        case 'greater_than': return Number(value) > Number(condition.value)
        case 'less_than': return Number(value) < Number(condition.value)
        case 'contains': return String(value).includes(String(condition.value))
        default: return false
      }
    })
  }

  /**
   * Get value from execution context
   */
  private getContextValue(field: string, execution: WorkflowExecution): any {
    const parts = field.split('.')
    let value: any = execution.context
    
    for (const part of parts) {
      value = value?.[part]
    }
    
    return value
  }

  /**
   * Execute a single workflow step
   */
  private async executeStep(
    step: WorkflowStep, 
    execution: WorkflowExecution
  ): Promise<{ status: string; output?: any; error?: string }> {
    
    switch (step.type) {
      case 'parse_requirements':
        return await this.executeParseRequirements(step, execution)
      
      case 'estimate_cost':
        return await this.executeEstimateCost(step, execution)
      
      case 'request_approval':
        return await this.executeRequestApproval(step, execution)
      
      case 'create_infrastructure':
        return await this.executeCreateInfrastructure(step, execution)
      
      case 'wait_for_input':
        return { status: 'waiting_input' }
      
      case 'send_notification':
        return await this.executeSendNotification(step, execution)
      
      default:
        return { status: 'failed', error: `Unknown step type: ${step.type}` }
    }
  }

  /**
   * Execute parse requirements step
   */
  private async executeParseRequirements(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<{ status: string; output?: any }> {
    const input = execution.input
    
    // Extract requirements from user input
    const requirements = {
      technologies: input.entities?.filter((e: Entity) => e.type === 'technology').map((e: Entity) => e.value) || [],
      infrastructure: input.entities?.filter((e: Entity) => e.type === 'infrastructure').map((e: Entity) => e.value) || [],
      environment: input.entities?.filter((e: Entity) => e.type === 'environment').map((e: Entity) => e.value)[0] || 'development',
      provider: input.entities?.filter((e: Entity) => e.type === 'cloud_provider').map((e: Entity) => e.value)[0] || 'digitalocean',
      region: input.entities?.filter((e: Entity) => e.type === 'region').map((e: Entity) => e.value)[0] || 'nyc3'
    }

    // Store in execution context as DeploymentRequirement array
    execution.context.requirements = [{
      type: 'technology_stack',
      specification: requirements,
      priority: 'required',
      source: 'user_specified'
    }]

    return { status: 'completed', output: requirements }
  }

  /**
   * Execute cost estimation step
   */
  private async executeEstimateCost(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<{ status: string; output?: any }> {
    if (!this.atlasClient) {
      return { status: 'failed' }
    }

    try {
      const requirements = execution.context.requirements
      
      // Build infrastructure request for cost estimation
      const infraRequest = {
        name: 'cost-estimate',
        provider: ((requirements[0] as any).specification?.provider) || 'digitalocean',
        region: ((requirements[0] as any).specification?.region) || 'nyc3',
        resources: this.buildResourcesFromRequirements((requirements[0] as any).specification)
      }

      const costEstimate = await this.atlasClient.estimateCost(infraRequest)
      
      // Store cost in context
      execution.context.estimated_costs = costEstimate

      return { status: 'completed', output: { estimated_cost: costEstimate, breakdown: infraRequest.resources } }
      
    } catch (error) {
      return { status: 'failed' }
    }
  }

  /**
   * Execute request approval step
   */
  private async executeRequestApproval(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<{ status: string; output?: any }> {
    const cost = execution.context.estimated_costs
    const requirements = execution.context.requirements
    
    // Create approval message
    const message = step.approval_message || 
      `Ready to deploy ${((requirements[0] as any).specification?.technologies || []).join(', ')} with estimated cost of $${cost}/month. Proceed?`

    // Store approval request
    execution.outputs['approval_request'] = {
      message,
      cost,
      requirements,
      timestamp: new Date().toISOString()
    }

    return { status: 'waiting_approval' }
  }

  /**
   * Execute create infrastructure step
   */
  private async executeCreateInfrastructure(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<{ status: string; output?: any }> {
    if (!this.atlasClient) {
      return { status: 'failed' }
    }

    try {
      const requirements = execution.context.requirements
      
      const infraRequest = {
        name: `${execution.conversation_id}-infrastructure`,
        provider: ((requirements[0] as any).specification?.provider) || 'digitalocean',
        region: ((requirements[0] as any).specification?.region) || 'nyc3',
        resources: this.buildResourcesFromRequirements((requirements[0] as any).specification),
        tags: {
          created_by: 'watson',
          conversation_id: execution.conversation_id,
          environment: ((requirements[0] as any).specification?.environment) || 'development'
        }
      }

      const result = await this.atlasClient.createInfrastructure(
        execution.context.user_id,
        execution.context.workspace_id,
        infraRequest
      )

      // Store infrastructure and operation IDs
      ;(execution.context as any).infrastructure_id = result.infrastructure.id
      ;(execution.context as any).operation_id = result.operation.id

      return { 
        status: 'completed', 
        output: { 
          infrastructure: result.infrastructure,
          operation: result.operation
        } 
      }
      
    } catch (error) {
      return { status: 'failed' }
    }
  }

  /**
   * Execute send notification step
   */
  private async executeSendNotification(
    step: WorkflowStep,
    execution: WorkflowExecution
  ): Promise<{ status: string; output?: any }> {
    const notification = {
      type: step.config?.notification_type || 'completion',
      message: step.config?.message || 'Workflow completed successfully',
      timestamp: new Date().toISOString(),
      execution_id: execution.id,
      workflow_id: execution.workflow_id
    }

    // In a real implementation, this would send notifications via email, Slack, etc.
    this.emit('notification', notification)

    return { status: 'completed', output: notification }
  }

  /**
   * Build infrastructure resources from requirements
   */
  private buildResourcesFromRequirements(requirements: any): any[] {
    const resources = []

    // Add web server if web technologies detected
    const webTechs = ['react', 'vue', 'angular', 'nodejs', 'node.js', 'nginx', 'apache']
    if (requirements.technologies?.some((tech: string) => webTechs.includes(tech.toLowerCase()))) {
      resources.push({
        type: 'droplet',
        name: 'web-server',
        specifications: {
          size: 's-1vcpu-2gb',
          image: 'ubuntu-22-04-x64',
          monitoring: true,
          backups: requirements.environment === 'production'
        }
      })
    }

    // Add database if database technologies detected
    const dbTechs = ['postgresql', 'postgres', 'mysql', 'mongodb', 'redis']
    const detectedDb = requirements.technologies?.find((tech: string) => 
      dbTechs.includes(tech.toLowerCase())
    )
    
    if (detectedDb) {
      let engine = 'postgresql'
      if (detectedDb.toLowerCase().includes('mysql')) engine = 'mysql'
      if (detectedDb.toLowerCase().includes('mongo')) engine = 'mongodb'
      if (detectedDb.toLowerCase().includes('redis')) engine = 'redis'

      resources.push({
        type: 'database',
        name: `${engine}-database`,
        specifications: {
          engine,
          version: engine === 'postgresql' ? '15' : '8.0',
          size: 'db-s-1vcpu-2gb',
          num_nodes: 1
        }
      })
    }

    // Add load balancer for production environments
    if (requirements.environment === 'production' && resources.length > 1) {
      resources.push({
        type: 'load_balancer',
        name: 'app-load-balancer',
        specifications: {
          algorithm: 'round_robin',
          forwarding_rules: [{
            entry_protocol: 'https',
            entry_port: 443,
            target_protocol: 'http',
            target_port: 80
          }]
        }
      })
    }

    // Default to simple droplet if no specific requirements detected
    if (resources.length === 0) {
      resources.push({
        type: 'droplet',
        name: 'app-server',
        specifications: {
          size: 's-1vcpu-1gb',
          image: 'ubuntu-22-04-x64',
          monitoring: true
        }
      })
    }

    return resources
  }

  /**
   * Load built-in workflow definitions
   */
  private loadBuiltInWorkflows(): void {
    // Deploy Application Workflow
    const deployAppWorkflow: WorkflowDefinition = {
      id: 'deploy-application',
      name: 'Deploy Application',
      description: 'Deploy an application with infrastructure provisioning',
      version: '1.0',
      steps: [
        {
          id: 'parse-requirements',
          name: 'Parse Requirements',
          description: 'Analyzing your requirements...',
          type: 'parse_requirements',
          config: {},
          depends_on: [],
          next_steps: ['estimate-cost'],
          conditions: []
        },
        {
          id: 'estimate-cost',
          name: 'Estimate Cost',
          description: 'Calculating infrastructure costs...',
          type: 'estimate_cost',
          config: {},
          depends_on: ['parse-requirements'],
          next_steps: ['request-approval'],
          conditions: []
        },
        {
          id: 'request-approval',
          name: 'Request Approval',
          description: 'Requesting your approval...',
          type: 'request_approval',
          config: {},
          depends_on: ['estimate-cost'],
          next_steps: ['create-infrastructure'],
          conditions: [],
          requires_approval: true,
          approval_message: 'Ready to deploy your application. Proceed with infrastructure creation?'
        },
        {
          id: 'create-infrastructure',
          name: 'Create Infrastructure',
          description: 'Provisioning cloud infrastructure...',
          type: 'create_infrastructure',
          config: {},
          depends_on: ['request-approval'],
          next_steps: ['send-notification'],
          conditions: [],
          timeout_seconds: 600
        },
        {
          id: 'send-notification',
          name: 'Send Notification',
          description: 'Sending completion notification...',
          type: 'send_notification',
          config: {
            notification_type: 'deployment_complete',
            message: 'Your application infrastructure has been deployed successfully!'
          },
          depends_on: ['create-infrastructure'],
          next_steps: [],
          conditions: []
        }
      ],
      triggers: [
        {
          type: 'intent',
          config: { intent: 'deploy_application' }
        }
      ],
      input_schema: {},
      output_schema: {},
      tags: ['deployment', 'infrastructure'],
      author: 'watson',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    this.workflows.set(deployAppWorkflow.id, deployAppWorkflow)

    // Simple Infrastructure Creation Workflow
    const createInfraWorkflow: WorkflowDefinition = {
      id: 'create-infrastructure',
      name: 'Create Infrastructure',
      description: 'Create cloud infrastructure resources',
      version: '1.0',
      steps: [
        {
          id: 'parse-requirements',
          name: 'Parse Requirements',
          description: 'Understanding your infrastructure needs...',
          type: 'parse_requirements',
          config: {},
          depends_on: [],
          next_steps: ['estimate-cost'],
          conditions: []
        },
        {
          id: 'estimate-cost',
          name: 'Estimate Cost',
          description: 'Calculating costs...',
          type: 'estimate_cost',
          config: {},
          depends_on: ['parse-requirements'],
          next_steps: ['create-infrastructure'],
          conditions: []
        },
        {
          id: 'create-infrastructure',
          name: 'Create Infrastructure',
          description: 'Creating infrastructure resources...',
          type: 'create_infrastructure',
          config: {},
          depends_on: ['estimate-cost'],
          next_steps: [],
          conditions: []
        }
      ],
      triggers: [
        {
          type: 'intent',
          config: { intent: 'create_infrastructure' }
        }
      ],
      input_schema: {},
      output_schema: {},
      tags: ['infrastructure'],
      author: 'watson',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }

    this.workflows.set(createInfraWorkflow.id, createInfraWorkflow)
  }

  /**
   * Find appropriate workflow for intent
   */
  findWorkflowForIntent(intent: Intent): string | null {
    for (const workflow of this.workflows.values()) {
      const intentTrigger = workflow.triggers.find(trigger => 
        trigger.type === 'intent' && trigger.config.intent === intent.name
      )
      
      if (intentTrigger) {
        return workflow.id
      }
    }
    
    return null
  }

  /**
   * Get all available workflows
   */
  getAvailableWorkflows(): WorkflowDefinition[] {
    return Array.from(this.workflows.values())
  }
}