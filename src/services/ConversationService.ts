import { ConversationMessage, Conversation, ConversationStatus, WatsonResponse, ResponseType, WorkflowExecution, WatsonConfig, InfrastructureContext, ConversationContext } from '../types'
import { WorkflowEngine } from '../workflows/WorkflowEngine'
import { NotificationService } from './NotificationService'
import { MCPService } from './MCPService'
import { LLMService, LLMMessage } from './LLMService'
import { ExecutionPlanService, ExecutionPlan, ExecutionStep } from './ExecutionPlanService'
import { ExecutorService } from './ExecutorService'
import { ErrorRecoveryService } from './ErrorRecoveryService'
import { v4 as uuidv4 } from 'uuid'
import axios from 'axios'
import EventEmitter from 'eventemitter3'

export class ConversationService extends EventEmitter {
  private conversations: Map<string, Conversation> = new Map()
  private workflowEngine: WorkflowEngine
  private notificationService: NotificationService
  private mcpService: MCPService
  private llmService: LLMService
  private executionPlanService: ExecutionPlanService
  private executorService: ExecutorService
  private errorRecoveryService: ErrorRecoveryService
  private config: WatsonConfig

  constructor(config: WatsonConfig) {
    super()
    this.config = config
    this.workflowEngine = new WorkflowEngine(config)
    this.notificationService = new NotificationService()
    this.mcpService = new MCPService(config)
    this.llmService = new LLMService(config, this.mcpService)
    this.executionPlanService = new ExecutionPlanService()
    this.executorService = new ExecutorService(this.llmService, this.mcpService)
    this.errorRecoveryService = new ErrorRecoveryService(this.llmService, this.mcpService)
    
    this.workflowEngine.on('workflow_progress', (execution: WorkflowExecution) => {
      this.handleWorkflowProgress(execution)
    })

    // Connect notification service to workflow events
    this.workflowEngine.on('workflow_progress', (execution: WorkflowExecution) => {
      this.notificationService.sendWorkflowProgress(execution)
    })

    // Connect LLM service tool error events to emit for WebSocket
    this.llmService.on('tool_error', (errorData: any) => {
      this.emit('tool_error', errorData)
    })

    // Connect LLM service tool progress events to emit for WebSocket  
    this.llmService.on('tool_progress', (progressData: any) => {
      this.emit('tool_progress', progressData)
    })

    // Connect LLM service thinking update events to emit for WebSocket
    this.llmService.on('thinking_update', (thinkingData: any) => {
      this.emit('thinking_update', thinkingData)
    })

    // Connect ExecutorService events for real-time execution feedback
    this.executorService.on('plan_started', (data: any) => {
      this.emit('execution_started', data)
    })
    this.executorService.on('step_started', (data: any) => {
      this.emit('execution_step_started', data)
    })
    this.executorService.on('step_completed', (data: any) => {
      this.emit('execution_step_completed', data)
    })
    this.executorService.on('step_failed', (data: any) => {
      this.emit('execution_step_failed', data)
    })
    this.executorService.on('plan_completed', (data: any) => {
      this.emit('execution_completed', data)
    })

    // Connect LLM service agent status events to emit for WebSocket
    this.llmService.on('agent_status', (statusData: any) => {
      console.log(`[ConversationService] Received agent_status event:`, statusData)
      this.emit('agent_status', statusData)
    })

    // Connect ErrorRecoveryService events to emit for WebSocket
    this.errorRecoveryService.on('recovery_started', (data: any) => {
      console.log(`[ConversationService] Recovery started:`, data.recovery_id)
      this.emit('recovery_started', data)
    })

    this.errorRecoveryService.on('recovery_progress', (data: any) => {
      console.log(`[ConversationService] Recovery progress:`, data.message)
      this.emit('recovery_progress', data)
    })

    this.errorRecoveryService.on('recovery_success', (data: any) => {
      console.log(`[ConversationService] Recovery successful:`, data.recovery_id)
      this.emit('recovery_success', data)
    })

    this.errorRecoveryService.on('recovery_escalated', (data: any) => {
      console.log(`[ConversationService] Recovery escalated:`, data.recovery_id)
      this.emit('recovery_escalated', data)
    })
  }

  async createConversation(workspaceId: string, userId: string): Promise<Conversation> {
    const conversationId = uuidv4()
    const now = new Date().toISOString()

    const conversation: Conversation = {
      id: conversationId,
      workspace_id: workspaceId,
      user_id: userId,
      status: 'active',
      messages: [],
      active_workflows: [],
      context: {
        active_infrastructure: [],
        pending_operations: [],
        preferred_provider: 'digitalocean',
        preferred_regions: ['nyc3'],
        cost_limits: {
          daily_limit: 100,
          monthly_limit: 1000,
          alert_threshold: 80
        },
        mentioned_technologies: [],
        deployment_requirements: [],
        agent_states: {}
      },
      created_at: now,
      updated_at: now,
      last_activity_at: now
    }

    this.conversations.set(conversationId, conversation)
    return conversation
  }

  async processMessage(conversationId: string, userInput: string, jwtToken?: string): Promise<WatsonResponse> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    const messageId = uuidv4()
    const timestamp = new Date().toISOString()

    const userMessage: ConversationMessage = {
      id: messageId,
      conversation_id: conversationId,
      role: 'user',
      content: userInput,
      timestamp,
      jwt_token: jwtToken
    }

    conversation.messages.push(userMessage)
    conversation.last_activity_at = timestamp
    this.conversations.set(conversationId, conversation)

    // Check if there's an active plan waiting for approval
    const activePlan = this.executionPlanService.getActivePlan(conversationId)
    if (activePlan && activePlan.status === 'awaiting_approval') {
      return await this.handlePlanApproval(conversationId, userInput, activePlan, jwtToken)
    }

    // Check if this is an execute command
    if (this.isExecuteCommand(userInput)) {
      return await this.handleExecuteCommand(conversationId, userInput, conversation, jwtToken)
    }

    // Check if this is a deployment or infrastructure request
    const isDeploymentRequest = this.isDeploymentRequest(userInput)
    if (isDeploymentRequest) {
      // Use autonomous execution loop for deployment requests
      return await this.processMessageWithAutonomousLoop(conversationId, userInput, conversation, jwtToken)
    }

    try {
      console.log(`[Watson] Processing message with LLM-powered inference: "${userInput}"`)
      
      // Convert conversation history to LLM message format
      const llmMessages: LLMMessage[] = [
        {
          role: 'system',
          content: this.llmService.createSystemMessage(conversation.workspace_id)
        }
      ]

      // Add conversation history (last 10 messages to avoid token limits)
      const recentMessages = conversation.messages.slice(-10)
      for (const msg of recentMessages) {
        if (msg.role === 'user' || msg.role === 'assistant') {
          llmMessages.push({
            role: msg.role,
            content: msg.content
          })
        }
      }

      // Get LLM response using user's credentials and MCP tools
      const llmResponse = await this.llmService.chat(
        llmMessages,
        jwtToken,
        conversation.workspace_id,
        conversationId
      )

      console.log(`[Watson] LLM response received. Used ${llmResponse.usage?.total_tokens || 0} tokens.`)
      if (llmResponse.tool_calls) {
        console.log(`[Watson] LLM executed ${llmResponse.tool_calls.length} tool calls`)
      }
      
      const assistantMessage: ConversationMessage = {
        id: uuidv4(),
        conversation_id: conversationId,
        role: 'assistant',
        content: llmResponse.message,
        timestamp: new Date().toISOString()
      }

      conversation.messages.push(assistantMessage)
      conversation.updated_at = new Date().toISOString()
      this.conversations.set(conversationId, conversation)

      // Send notifications
      this.notificationService.sendConversationMessage(conversationId, assistantMessage)
      
      this.emit('conversation_message', {
        conversation_id: conversationId,
        message: assistantMessage
      })

      return {
        message: llmResponse.message,
        response_type: 'text',
        attachments: [],
        usage: llmResponse.usage
      }

    } catch (error) {
      console.error('[Watson] LLM processing error:', error)
      
      // Check if this is a DigitalOcean provisioning failure that should trigger error recovery
      if (error instanceof Error && this.shouldTriggerErrorRecovery(error, userInput)) {
        console.log('[Watson] Detected provisioning failure - starting error recovery')
        
        // Extract operation details from the error context
        const provider = this.extractProviderFromError(error, userInput)
        const operation = this.extractOperationFromError(error, userInput)
        const originalParams = this.extractParametersFromError(error)
        
        // Start error recovery asynchronously
        const recoveryId = await this.errorRecoveryService.startRecovery(
          conversationId,
          error,
          provider,
          operation, 
          originalParams,
          jwtToken
        )
        
        // Send immediate response letting user know we're working on it
        const recoveryMessage: ConversationMessage = {
          id: uuidv4(),
          conversation_id: conversationId,
          role: 'assistant',
          content: `🔧 **Infrastructure Provisioning Failed - Starting Intelligent Recovery**\n\n` +
                  `I detected an issue with the ${provider} provisioning operation. I'm now analyzing the error ` +
                  `against the API documentation to find a solution.\n\n` +
                  `**Recovery Process:**\n` +
                  `• 🔍 AI-powered error analysis\n` +
                  `• 🔧 Automated fix attempts (up to 3 tries)\n` +
                  `• 📊 Real-time progress updates\n\n` +
                  `I'll keep you updated on the progress. If I can't resolve it after a few attempts, ` +
                  `I'll provide you with specific guidance on next steps.\n\n` +
                  `*Recovery ID: ${recoveryId}*`,
          timestamp: new Date().toISOString()
        }
        
        conversation.messages.push(recoveryMessage)
        conversation.updated_at = new Date().toISOString()
        this.conversations.set(conversationId, conversation)
        
        return {
          message: recoveryMessage.content,
          response_type: 'recovery_started',
          attachments: [],
          recovery_id: recoveryId
        }
      }
      
      conversation.status = 'error'
      this.conversations.set(conversationId, conversation)
      
      let errorContent = "I encountered an error processing your request."
      const suggestedActions = []
      
      // Handle specific error types with actionable guidance
      if (error instanceof Error) {
        if (error.message.includes('credit balance is too low') || error.message.includes('insufficient credits')) {
          // Insufficient credits error
          errorContent = "⚠️ **Insufficient LLM Credits**\n\n"
          errorContent += "Your LLM provider account has insufficient credits to process this request.\n\n"
          errorContent += "**Option 1: Add Credits**\n"
          
          // Determine which provider and provide appropriate link
          if (error.message.includes('Anthropic')) {
            errorContent += "Add credits to your Anthropic account at:\n"
            errorContent += "https://console.anthropic.com/settings/billing\n\n"
          } else if (error.message.includes('OpenAI')) {
            errorContent += "Add credits to your OpenAI account at:\n"
            errorContent += "https://platform.openai.com/account/billing\n\n"
          }
          
          errorContent += "**Option 2: Switch Providers**\n"
          errorContent += "Configure a different LLM provider in your settings.\n\n"
          errorContent += "**Future Option: ControlVector LLM**\n"
          errorContent += "Soon you'll be able to fall back to the ControlVector LLM service."
          
          suggestedActions.push({
            id: 'add_credits',
            text: 'Add Credits to Current Provider',
            action_type: 'link',
            action_data: { 
              url: error.message.includes('Anthropic') 
                ? 'https://console.anthropic.com/settings/billing'
                : 'https://platform.openai.com/account/billing'
            }
          })
          
          suggestedActions.push({
            id: 'switch_provider',
            text: 'Configure Different Provider',
            action_type: 'settings',
            action_data: { section: 'llm_credentials' }
          })
          
        } else if (error.message.includes('No LLM credentials')) {
          errorContent = "⚠️ **No LLM Credentials Configured**\n\n"
          errorContent += "You need to configure LLM API credentials to use Watson.\n\n"
          errorContent += "**Supported Providers:**\n"
          errorContent += "• OpenAI (GPT-4)\n"
          errorContent += "• Anthropic (Claude)\n"
          errorContent += "• Google (Gemini) - coming soon\n"
          errorContent += "• ControlVector LLM - coming soon\n\n"
          errorContent += "Please add your API keys in the settings."
          
          suggestedActions.push({
            id: 'configure_llm',
            text: 'Configure LLM Credentials',
            action_type: 'settings',
            action_data: { section: 'llm_credentials' }
          })
          
        } else if (error.message.includes('rate limit')) {
          errorContent = "⚠️ **Rate Limit Exceeded**\n\n"
          errorContent += "You've exceeded the rate limit for your LLM provider.\n"
          errorContent += "Please wait a moment before trying again, or consider upgrading your plan."
          
        } else if (error.message.includes('API key')) {
          errorContent = "⚠️ **Invalid API Key**\n\n"
          errorContent += "Your LLM API key appears to be invalid or expired.\n"
          errorContent += "Please update your credentials in the settings."
          
          suggestedActions.push({
            id: 'update_credentials',
            text: 'Update API Credentials',
            action_type: 'settings',
            action_data: { section: 'llm_credentials' }
          })
        }
      }
      
      // Fallback error message
      const errorMessage: ConversationMessage = {
        id: uuidv4(),
        conversation_id: conversationId,
        role: 'assistant',
        content: errorContent,
        timestamp: new Date().toISOString()
      }

      conversation.messages.push(errorMessage)
      this.conversations.set(conversationId, conversation)

      return {
        message: errorContent,
        response_type: 'error',
        suggested_actions: suggestedActions as any
      }
    }
  }



  private handleWorkflowProgress(execution: WorkflowExecution): void {
    const conversation = this.conversations.get(execution.conversation_id)
    if (!conversation) return

    const workflowIndex = conversation.active_workflows.findIndex(w => w.id === execution.id)
    if (workflowIndex !== -1) {
      conversation.active_workflows[workflowIndex] = execution
    }

    if (execution.status === 'completed' || execution.status === 'failed') {
      conversation.active_workflows = conversation.active_workflows.filter(w => w.id !== execution.id)
    }

    this.emit('workflow_progress', {
      conversation_id: execution.conversation_id,
      workflow_execution: execution
    })
  }

  private async handlePlanApproval(conversationId: string, userInput: string, activePlan: ExecutionPlan, jwtToken?: string): Promise<WatsonResponse> {
    const response = this.executionPlanService.parseApprovalResponse(userInput)
    
    switch (response) {
      case 'approve':
        const approvedPlan = this.executionPlanService.approvePlan(activePlan.id)
        if (approvedPlan) {
          // Start execution asynchronously - don't await it
          this.executeAsyncPlan(approvedPlan, jwtToken, conversationId).catch((error: any) => {
            console.error(`[Watson] Async plan execution failed:`, error)
          })
          
          return {
            message: `✅ **Execution Plan Approved & Started**\n\nI'm now executing the approved plan for: ${approvedPlan.objective}\n\nYou'll receive real-time updates as each step completes.`,
            response_type: 'text',
            attachments: []
          }
        } else {
          return {
            message: "❌ Unable to approve the execution plan. Please try again.",
            response_type: 'error',
            attachments: []
          }
        }
        
      case 'reject':
        this.executionPlanService.cancelPlan(activePlan.id)
        return {
          message: `❌ **Execution Plan Cancelled**\n\nThe execution plan for "${activePlan.objective}" has been cancelled. No changes will be made to your infrastructure.`,
          response_type: 'text',
          attachments: []
        }
        
      case 'modify':
        return {
          message: `🔧 **Plan Modification Requested**\n\nPlease describe what you'd like to change about the execution plan for: ${activePlan.objective}\n\nI'll create an updated plan based on your modifications.`,
          response_type: 'text',
          attachments: []
        }
        
      default:
        return {
          message: `❓ **Please Confirm Your Decision**\n\n${this.executionPlanService.formatPlanForApproval(activePlan)}`,
          response_type: 'text',
          attachments: []
        }
    }
  }

  private async handleDeploymentRequest(conversationId: string, userInput: string, conversation: Conversation, jwtToken?: string): Promise<WatsonResponse> {
    try {
      // Use LLM to analyze the deployment request and create execution steps
      const llmMessages: LLMMessage[] = [
        {
          role: 'system',
          content: `You are an infrastructure deployment planner. Analyze user requests and create structured execution plans.

Your task is to parse the user's deployment request and return a JSON object with this structure:
{
  "objective": "Brief description of what the user wants to deploy",
  "steps": [
    {
      "service": "atlas|phoenix|sherlock",
      "action": "provision_server|deploy_application|configure_ssl|etc",
      "description": "Human-readable description of this step",
      "parameters": {
        "key": "value parameters for this step"
      },
      "estimatedTime": "30 seconds|2 minutes|etc"
    }
  ]
}

Focus on infrastructure and deployment operations. Break down complex requests into specific, executable steps.`
        },
        {
          role: 'user', 
          content: `Analyze this deployment request and create an execution plan: "${userInput}"`
        }
      ]

      const llmResponse = await this.llmService.chat(
        llmMessages,
        jwtToken,
        conversation.workspace_id,
        conversationId
      )

      // Parse the LLM response to extract execution plan
      let planData
      try {
        planData = JSON.parse(llmResponse.message)
      } catch (error) {
        // Fallback if LLM doesn't return valid JSON
        planData = {
          objective: "Deploy user application",
          steps: [
            {
              service: "atlas",
              action: "analyze_deployment_request", 
              description: "Analyze the deployment requirements",
              parameters: { request: userInput },
              estimatedTime: "30 seconds"
            }
          ]
        }
      }

      // Create the execution plan
      const executionPlan = this.executionPlanService.createExecutionPlan(
        conversationId,
        conversation.user_id,
        conversation.workspace_id,
        planData.objective,
        planData.steps
      )

      // Request approval
      await this.executionPlanService.requestApproval(executionPlan)

      // Return formatted plan for user approval
      const formattedPlan = this.executionPlanService.formatPlanForApproval(executionPlan)
      
      return {
        message: `🤖 **Deployment Request Analyzed**\n\nI've created an execution plan for your request. Please review the following plan carefully:\n\n${formattedPlan}`,
        response_type: 'text',
        attachments: []
      }

    } catch (error) {
      console.error('[Watson] Error creating deployment plan:', error)
      return {
        message: "❌ I encountered an error while analyzing your deployment request. Please try rephrasing your request or contact support.",
        response_type: 'error',
        attachments: []
      }
    }
  }

  private isDeploymentRequest(userInput: string): boolean {
    const deploymentKeywords = [
      // Direct deployment terms
      'deploy', 'deployment', 'provision', 'create infrastructure',
      'set up server', 'launch application', 'host', 'hosting',
      
      // Infrastructure terms  
      'server', 'droplet', 'instance', 'vm', 'virtual machine',
      'load balancer', 'database', 'redis', 'nginx', 'ssl',
      
      // Application deployment
      'docker', 'kubernetes', 'k8s', 'container', 'build and deploy',
      'ci/cd', 'github actions', 'gitlab ci',
      
      // Domain and DNS
      'domain', 'dns', 'subdomain', 'certificate', 'https',
      
      // Cloud providers
      'digitalocean', 'hetzner', 'aws', 'azure', 'gcp',
      'linode', 'vultr', 'coreweave',
      
      // Specific actions
      'scale up', 'scale down', 'backup', 'migrate',
      'update server', 'configure firewall'
    ]

    const lowerInput = userInput.toLowerCase()
    
    // Check for exact keyword matches
    const hasKeyword = deploymentKeywords.some(keyword => 
      lowerInput.includes(keyword)
    )
    
    // Check for deployment patterns
    const deploymentPatterns = [
      /deploy.*(?:to|on|at)\s+\w+/i,  // "deploy X to Y"
      /create.*(?:server|instance|droplet)/i,  // "create a server"
      /set up.*(?:hosting|infrastructure)/i,   // "set up hosting"
      /launch.*(?:app|application|site|website)/i,  // "launch my app"
      /host.*(?:on|at)\s+\w+/i,       // "host on domain.com"
      /provision.*(?:resources|infrastructure)/i   // "provision resources"
    ]
    
    const hasPattern = deploymentPatterns.some(pattern => 
      pattern.test(userInput)
    )
    
    return hasKeyword || hasPattern
  }

  private async executeAsyncPlan(plan: ExecutionPlan, jwtToken: string | undefined, conversationId: string): Promise<void> {
    // Mark plan as executing
    plan.status = 'executing'
    this.emit('plan_execution_started', { plan })

    try {
      for (const step of plan.steps) {
        try {
          // Send real-time update about starting this step
          this.sendExecutionUpdate(conversationId, `🔄 Starting: ${step.description}`)

          // Execute each step via LLM with MCP tools
          await this.executionPlanService.executeStep(plan.id, step.id)
          
          const llmMessages: LLMMessage[] = [
            {
              role: 'system',
              content: `You are executing a pre-approved infrastructure step. Execute the requested action using available tools.`
            },
            {
              role: 'user',
              content: `Execute this step: ${step.description}\nService: ${step.service}\nAction: ${step.action}\nParameters: ${JSON.stringify(step.parameters)}`
            }
          ]

          const stepResult = await this.llmService.chat(
            llmMessages,
            jwtToken,
            plan.workspaceId,
            plan.conversationId
          )

          // Mark step as completed
          this.executionPlanService.completeStep(plan.id, step.id, {
            message: stepResult.message,
            tool_calls: stepResult.tool_calls,
            usage: stepResult.usage
          })

          // Send real-time success update
          this.sendExecutionUpdate(conversationId, `✅ Completed: ${step.description}`)
          this.emit('step_completed', { plan, step, result: stepResult })

        } catch (error) {
          // Mark step as failed
          this.executionPlanService.failStep(plan.id, step.id, error instanceof Error ? error.message : 'Unknown error')
          
          // Send real-time failure update
          this.sendExecutionUpdate(conversationId, `❌ Failed: ${step.description}\nError: ${error instanceof Error ? error.message : 'Unknown error'}`)
          this.emit('step_failed', { plan, step, error })
          
          // Stop execution on failure
          break
        }
      }

      // Check if plan completed successfully
      if (plan.steps.every(s => s.status === 'completed' || s.status === 'skipped')) {
        this.sendExecutionUpdate(conversationId, `🎉 **Execution Plan Completed Successfully!**\n\nAll steps for "${plan.objective}" have been executed.`)
      } else {
        this.sendExecutionUpdate(conversationId, `⚠️ **Execution Plan Stopped**\n\nExecution was halted due to step failure. Please check the logs above.`)
      }

    } catch (error) {
      console.error(`[Watson] Plan execution error:`, error)
      this.sendExecutionUpdate(conversationId, `❌ **Execution Error**\n\nPlan execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  private sendExecutionUpdate(conversationId: string, message: string): void {
    // Create an AI message for the execution update
    const updateMessage: ConversationMessage = {
      id: uuidv4(),
      conversation_id: conversationId,
      role: 'assistant' as const,
      content: message,
      timestamp: new Date().toISOString()
    }

    // Add to conversation history
    const conversation = this.conversations.get(conversationId)
    if (conversation) {
      conversation.messages.push(updateMessage)
      conversation.updated_at = new Date().toISOString()
      this.conversations.set(conversationId, conversation)
    }

    // Send via notification service (which handles WebSocket)
    this.notificationService.sendConversationMessage(conversationId, updateMessage)
    
    this.emit('conversation_message', {
      conversation_id: conversationId,
      message: updateMessage
    })
  }

  /**
   * Send contextual typing indicator based on operation being performed
   */
  private sendContextualTyping(conversationId: string, operation: string, agent: string = 'Victor'): void {
    const typingData = {
      type: 'typing_indicator',
      is_typing: true,
      agent: agent,
      operation: operation,
      conversation_id: conversationId,
      timestamp: new Date().toISOString()
    }

    // Emit to WebSocket connections
    this.emit('typing_status', typingData)
  }

  /**
   * Send typing end indicator
   */
  private sendTypingEnd(conversationId: string): void {
    const typingData = {
      type: 'typing_indicator',
      is_typing: false,
      conversation_id: conversationId,
      timestamp: new Date().toISOString()
    }

    // Emit to WebSocket connections
    this.emit('typing_status', typingData)
  }

  private async executePlan(plan: ExecutionPlan, jwtToken?: string): Promise<void> {
    // Mark plan as executing
    plan.status = 'executing'
    this.emit('plan_execution_started', { plan })

    for (const step of plan.steps) {
      try {
        // Execute each step via LLM with MCP tools
        await this.executionPlanService.executeStep(plan.id, step.id)
        
        const llmMessages: LLMMessage[] = [
          {
            role: 'system',
            content: `You are executing a pre-approved infrastructure step. Execute the requested action using available tools.`
          },
          {
            role: 'user',
            content: `Execute this step: ${step.description}\nService: ${step.service}\nAction: ${step.action}\nParameters: ${JSON.stringify(step.parameters)}`
          }
        ]

        const stepResult = await this.llmService.chat(
          llmMessages,
          jwtToken,
          plan.workspaceId,
          plan.conversationId
        )

        // Mark step as completed
        this.executionPlanService.completeStep(plan.id, step.id, {
          message: stepResult.message,
          tool_calls: stepResult.tool_calls,
          usage: stepResult.usage
        })

        this.emit('step_completed', { plan, step, result: stepResult })

      } catch (error) {
        // Mark step as failed
        this.executionPlanService.failStep(plan.id, step.id, error instanceof Error ? error.message : 'Unknown error')
        this.emit('step_failed', { plan, step, error })
        
        // Stop execution on failure
        break
      }
    }
  }

  getConversation(conversationId: string): Conversation | undefined {
    return this.conversations.get(conversationId)
  }

  getConversations(workspaceId?: string, userId?: string): Conversation[] {
    const conversations = Array.from(this.conversations.values())
    
    if (workspaceId && userId) {
      return conversations.filter(c => c.workspace_id === workspaceId && c.user_id === userId)
    } else if (workspaceId) {
      return conversations.filter(c => c.workspace_id === workspaceId)
    } else if (userId) {
      return conversations.filter(c => c.user_id === userId)
    }
    
    return conversations
  }

  getNotificationService(): NotificationService {
    return this.notificationService
  }

  createEventStream(conversationId: string) {
    return this.notificationService.createEventStream(conversationId)
  }

  getConversationEvents(conversationId: string, limit = 50) {
    return this.notificationService.getConversationHistory(conversationId, limit)
  }

  // Error Recovery Helper Methods

  /**
   * Determine if error should trigger intelligent error recovery
   */
  private shouldTriggerErrorRecovery(error: Error, userInput: string): boolean {
    // Check for DigitalOcean provisioning failures
    if (error.message.includes('atlas_provision_infrastructure') ||
        error.message.includes('DigitalOcean') ||
        error.message.includes('droplet') ||
        error.message.includes('provision') ||
        error.message.includes('infrastructure')) {
      return true
    }

    // Check for common infrastructure error patterns
    const infraErrorPatterns = [
      'rate limit',
      'insufficient quota', 
      'invalid region',
      'invalid size',
      'authentication failed',
      'api token',
      'resource limit',
      'account limit'
    ]

    const errorText = error.message.toLowerCase()
    const inputText = userInput.toLowerCase()
    
    return infraErrorPatterns.some(pattern => 
      errorText.includes(pattern) || 
      (inputText.includes('deploy') || inputText.includes('provision'))
    )
  }

  /**
   * Extract cloud provider from error context
   */
  private extractProviderFromError(error: Error, userInput: string): string {
    const errorMessage = error.message.toLowerCase()
    const input = userInput.toLowerCase()
    
    if (errorMessage.includes('digitalocean') || input.includes('digitalocean')) {
      return 'digitalocean'
    }
    if (errorMessage.includes('aws') || input.includes('aws')) {
      return 'aws'
    }
    if (errorMessage.includes('gcp') || input.includes('gcp') || input.includes('google')) {
      return 'gcp'  
    }
    if (errorMessage.includes('azure') || input.includes('azure')) {
      return 'azure'
    }
    
    // Default to digitalocean as it's most commonly used
    return 'digitalocean'
  }

  /**
   * Extract operation type from error context
   */
  private extractOperationFromError(error: Error, userInput: string): string {
    const errorMessage = error.message.toLowerCase()
    const input = userInput.toLowerCase()
    
    if (errorMessage.includes('provision') || input.includes('provision')) {
      return 'provision_infrastructure'
    }
    if (errorMessage.includes('deploy') || input.includes('deploy')) {
      return 'deploy_application'
    }
    if (errorMessage.includes('scale') || input.includes('scale')) {
      return 'scale_infrastructure'  
    }
    if (errorMessage.includes('dns') || input.includes('domain')) {
      return 'configure_dns'
    }
    
    // Default to infrastructure provisioning
    return 'provision_infrastructure'
  }

  /**
   * Extract parameters from error context for retry attempts
   */
  private extractParametersFromError(error: Error): any {
    const errorMessage = error.message
    
    // Try to extract parameters from error stack or message
    let params: any = {}
    
    try {
      // Look for JSON-like structures in error message
      const jsonMatch = errorMessage.match(/\{[^}]*\}/)
      if (jsonMatch) {
        params = JSON.parse(jsonMatch[0])
      }
    } catch (parseError) {
      // If we can't parse parameters, provide sensible defaults
      params = {
        region: 'nyc3',
        size: 's-1vcpu-2gb',
        retry_with_different_config: true
      }
    }
    
    return params
  }

  /**
   * Process message with autonomous execution loop for deployment requests
   * This method creates an autonomous agent that continues executing until reaching a decision point
   */
  private async processMessageWithAutonomousLoop(
    conversationId: string, 
    userInput: string, 
    conversation: Conversation, 
    jwtToken?: string
  ): Promise<WatsonResponse> {
    console.log(`[Watson] Starting autonomous execution loop for deployment request: "${userInput}"`)
    
    // Initialize loop parameters
    let loopIteration = 0
    const maxIterations = 10 // Prevent infinite loops
    let shouldContinue = true
    let currentMessages: LLMMessage[] = []
    
    // Set up initial system message with autonomous behavior instructions
    const autonomousSystemMessage = this.createAutonomousSystemMessage(conversation.workspace_id)
    currentMessages.push({
      role: 'system',
      content: autonomousSystemMessage
    })

    // Add conversation history (last 5 messages to avoid token limits)
    const recentMessages = conversation.messages.slice(-5)
    for (const msg of recentMessages) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        currentMessages.push({
          role: msg.role,
          content: msg.content
        })
      }
    }

    // Send initial status to user
    this.sendExecutionUpdate(conversationId, `🤖 **Autonomous Agent Activated**\n\nI'm now processing your deployment request autonomously. I'll continue working until completion or until I need your input.\n\n**Current Task**: ${userInput}`)

    // Track autonomous execution context
    let totalTokensUsed = 0
    let executedTools: string[] = []
    let stoppingReason = 'unknown'
    
    try {
      while (shouldContinue && loopIteration < maxIterations) {
        loopIteration++
        console.log(`[Watson] Autonomous loop iteration ${loopIteration}`)

        // Send status update for each iteration
        if (loopIteration > 1) {
          this.sendExecutionUpdate(conversationId, `🔄 **Iteration ${loopIteration}**: Continuing autonomous execution...`)
        }

        // Check token usage to prevent excessive costs
        if (totalTokensUsed > 50000) { // Safety limit
          console.log(`[Watson] Token usage limit reached: ${totalTokensUsed} tokens`)
          stoppingReason = 'Token usage limit reached'
          break
        }

        // Get LLM response with MCP tools
        const llmResponse = await this.llmService.chat(
          currentMessages,
          jwtToken,
          conversation.workspace_id,
          conversationId
        )

        console.log(`[Watson] Iteration ${loopIteration} - LLM response received. Used ${llmResponse.usage?.total_tokens || 0} tokens.`)
        
        // Track token usage and tool executions
        if (llmResponse.usage) {
          totalTokensUsed += llmResponse.usage.total_tokens
        }
        
        if (llmResponse.tool_calls) {
          const toolNames = llmResponse.tool_calls.map(tc => tc.function.name)
          executedTools.push(...toolNames)
          console.log(`[Watson] Iteration ${loopIteration} - Executed tools: ${toolNames.join(', ')}`)
        }
        
        // Add assistant response to conversation history
        const assistantMessage: ConversationMessage = {
          id: uuidv4(),
          conversation_id: conversationId,
          role: 'assistant',
          content: llmResponse.message,
          timestamp: new Date().toISOString()
        }

        conversation.messages.push(assistantMessage)
        currentMessages.push({
          role: 'assistant',
          content: llmResponse.message
        })

        // Check if we should continue the loop
        shouldContinue = this.shouldContinueAutonomousLoop(llmResponse.message, loopIteration)
        stoppingReason = this.getLoopStoppingReason(llmResponse.message)
        
        if (shouldContinue) {
          // Add continuation prompt to keep the agent going
          const continuationPrompt = this.createContinuationPrompt(loopIteration)
          currentMessages.push({
            role: 'user',
            content: continuationPrompt
          })
          
          console.log(`[Watson] Iteration ${loopIteration} - Continuing loop with prompt: "${continuationPrompt}"`)
          
          // Emit autonomous progress event
          this.emit('autonomous_progress', {
            conversation_id: conversationId,
            iteration: loopIteration,
            total_tokens: totalTokensUsed,
            tools_executed: executedTools.length,
            recent_tools: executedTools.slice(-5), // Last 5 tools
            continuing: true,
            timestamp: new Date().toISOString()
          })
        } else {
          console.log(`[Watson] Iteration ${loopIteration} - Stopping autonomous loop. Reason: ${stoppingReason}`)
          
          // Emit autonomous completion event
          this.emit('autonomous_complete', {
            conversation_id: conversationId,
            total_iterations: loopIteration,
            total_tokens: totalTokensUsed,
            tools_executed: executedTools,
            stopping_reason: stoppingReason,
            timestamp: new Date().toISOString()
          })
        }

        // Progressive delay to prevent API rate limiting
        const delay = Math.min(1000 + (loopIteration * 200), 3000) // 1s to 3s
        await new Promise(resolve => setTimeout(resolve, delay))
      }

      if (loopIteration >= maxIterations) {
        this.sendExecutionUpdate(conversationId, `⚠️ **Maximum Iterations Reached**\n\nI've completed ${maxIterations} autonomous execution cycles. The task may require additional input or manual intervention.`)
        stoppingReason = 'Maximum iterations reached'
      }

      // Update conversation and return final response
      conversation.updated_at = new Date().toISOString()
      this.conversations.set(conversationId, conversation)

      // Generate comprehensive execution summary
      const uniqueTools = [...new Set(executedTools)]
      const executionSummary = this.generateExecutionSummary(
        loopIteration, 
        totalTokensUsed, 
        uniqueTools, 
        stoppingReason
      )

      return {
        message: executionSummary,
        response_type: 'text',
        attachments: [],
        usage: { 
          prompt_tokens: 0, 
          completion_tokens: 0, 
          total_tokens: totalTokensUsed 
        }
      }

    } catch (error) {
      console.error('[Watson] Autonomous execution loop error:', error)
      
      this.sendExecutionUpdate(conversationId, `❌ **Autonomous Execution Error**\n\nError occurred during iteration ${loopIteration}: ${error instanceof Error ? error.message : 'Unknown error'}`)
      
      return {
        message: `❌ **Autonomous Execution Failed**\n\nError occurred during autonomous execution: ${error instanceof Error ? error.message : 'Unknown error'}\n\nCompleted ${loopIteration - 1} cycles before failure.`,
        response_type: 'error',
        attachments: []
      }
    }
  }

  /**
   * Create system message with autonomous behavior instructions
   */
  private createAutonomousSystemMessage(workspaceId?: string): string {
    const baseSystemMessage = this.llmService.createSystemMessage(workspaceId)
    
    return `${baseSystemMessage}

AUTONOMOUS EXECUTION MODE ACTIVATED:

You are now operating in autonomous mode for infrastructure deployment tasks. This means you should:

1. **Take Initiative**: Proactively execute the necessary tools and steps to complete the user's deployment request
2. **Continue Working**: After each tool execution, assess what needs to be done next and continue automatically
3. **Be Thorough**: Don't stop after just one tool call - continue until the task is complete or you need user input
4. **Chain Operations**: If you provision infrastructure, then deploy applications, then configure SSL - do it all in sequence
5. **Report Progress**: Provide clear status updates about what you're doing at each step

STOPPING CONDITIONS - Only stop the autonomous loop when:
- ✅ Task is fully completed successfully
- ❌ Critical error that requires user intervention 
- ❓ Ambiguous requirement that needs user clarification
- 🔐 Missing credentials or permissions that user must provide
- ⏱️ Long-running operation initiated that needs time to complete

DO NOT STOP for:
- Intermediate tool results (continue to next step)
- Successful completions of individual steps (continue to next step)  
- Information gathering (use the info to continue)
- Status updates (report status and continue)

CONTINUE WORKING until you reach a natural completion point or decision point that requires user input.`
  }

  /**
   * Determine if autonomous loop should continue based on LLM response
   * Enhanced with comprehensive termination conditions and decision point detection
   */
  private shouldContinueAutonomousLoop(assistantResponse: string, iteration: number): boolean {
    const response = assistantResponse.toLowerCase()
    
    // PRIORITY 1: Critical stop conditions - always stop immediately
    const criticalStopSignals = [
      'critical error occurred',
      'deployment failed permanently',
      'cannot proceed without',
      'missing required credentials',
      'authentication failed',
      'permission denied',
      'quota exceeded',
      'rate limit exceeded',
      'service unavailable',
      'api key invalid',
      'insufficient permissions',
      'access denied'
    ]
    
    for (const signal of criticalStopSignals) {
      if (response.includes(signal)) {
        console.log(`[Watson] Critical stop signal detected: "${signal}"`)
        return false
      }
    }
    
    // PRIORITY 2: Completion indicators - task finished successfully
    const completionSignals = [
      'deployment completed successfully',
      'deployment is complete',
      'task completed',
      'process finished',
      'everything is set up',
      'all steps completed',
      'deployment successful',
      'infrastructure is ready',
      'application is live',
      'ssl configured successfully',
      'domain configured successfully',
      'all services are running'
    ]
    
    for (const signal of completionSignals) {
      if (response.includes(signal)) {
        console.log(`[Watson] Completion signal detected: "${signal}"`)
        return false
      }
    }
    
    // PRIORITY 3: User decision required - need human input
    const decisionPointSignals = [
      'need user input',
      'please provide',
      'which would you prefer',
      'let me know',
      'requires user decision',
      'choose between',
      'confirm whether',
      'would you like me to',
      'do you want to',
      'should i proceed with',
      'please specify',
      'please confirm',
      'awaiting your decision',
      'requires confirmation',
      'multiple options available'
    ]
    
    for (const signal of decisionPointSignals) {
      if (response.includes(signal)) {
        console.log(`[Watson] Decision point signal detected: "${signal}"`)
        return false
      }
    }
    
    // PRIORITY 4: Wait conditions - external processes running
    const waitConditions = [
      'waiting for provisioning to complete',
      'server is being created',
      'dns propagation in progress',
      'ssl certificate being issued',
      'deployment in progress',
      'please wait',
      'this may take several minutes',
      'monitoring deployment status',
      'polling for completion'
    ]
    
    for (const condition of waitConditions) {
      if (response.includes(condition)) {
        console.log(`[Watson] Wait condition detected: "${condition}"`)
        return false
      }
    }
    
    // PRIORITY 5: Active work indicators - keep going
    const activeWorkSignals = [
      'next step',
      'proceeding to',
      'now I will',
      'now I\'m going to',
      'continuing with',
      'executing',
      'analyzing',
      'configuring',
      'setting up',
      'checking',
      'provisioning',
      'deploying',
      'installing',
      'creating',
      'updating',
      'verifying',
      'establishing',
      'initializing',
      'preparing'
    ]
    
    for (const signal of activeWorkSignals) {
      if (response.includes(signal)) {
        console.log(`[Watson] Active work signal detected: "${signal}"`)
        return true
      }
    }
    
    // PRIORITY 6: Tool execution indicators - agent is actively working
    const toolExecutionPatterns = [
      'executing.*tool',
      'calling.*api',
      'running.*command',
      'performing.*operation',
      'starting.*process',
      'initiating.*deployment'
    ]
    
    for (const pattern of toolExecutionPatterns) {
      const regex = new RegExp(pattern)
      if (regex.test(response)) {
        console.log(`[Watson] Tool execution pattern detected: "${pattern}"`)
        return true
      }
    }
    
    // PRIORITY 7: Progress indicators - intermediate status updates
    const progressIndicators = [
      'step 1 of',
      'step 2 of', 
      'step 3 of',
      'phase 1:',
      'phase 2:',
      'phase 3:',
      'in progress',
      'currently',
      'status:',
      'progress:'
    ]
    
    for (const indicator of progressIndicators) {
      if (response.includes(indicator)) {
        console.log(`[Watson] Progress indicator detected: "${indicator}"`)
        return true
      }
    }
    
    // PRIORITY 8: Response length analysis - very short responses might indicate completion
    const words = response.trim().split(/\s+/)
    if (words.length < 10) {
      console.log(`[Watson] Very short response detected (${words.length} words) - likely completion`)
      return false
    }
    
    // PRIORITY 9: Question patterns - if asking questions, likely needs user input
    const questionPatterns = [
      /\?.*$/m,  // Ends with question
      /^(what|where|when|why|how|which|should|would|could|can|do|does|is|are)/,
      /please.*\?/,
      /would you.*\?/,
      /should i.*\?/
    ]
    
    for (const pattern of questionPatterns) {
      if (pattern.test(response)) {
        console.log(`[Watson] Question pattern detected - likely needs user input`)
        return false
      }
    }
    
    // PRIORITY 10: Iteration-based fallback with progressive stopping
    if (iteration >= 8) {
      console.log(`[Watson] Maximum iterations (${iteration}) reached - stopping for safety`)
      return false
    }
    
    if (iteration >= 5) {
      console.log(`[Watson] High iteration count (${iteration}) - checking for repetitive patterns`)
      // Could add repetition detection here
      return iteration <= 6 // Allow 1-2 more iterations at high counts
    }
    
    // PRIORITY 11: Default behavior - continue for first few iterations
    if (iteration <= 3) {
      console.log(`[Watson] Early iteration (${iteration}) - continuing by default`)
      return true
    }
    
    // PRIORITY 12: Fallback - if no clear signals, stop to be safe
    console.log(`[Watson] No clear continuation signals detected - stopping for safety`)
    return false
  }

  /**
   * Create continuation prompt to keep autonomous agent working
   */
  private createContinuationPrompt(iteration: number): string {
    const prompts = [
      "What is the next step to complete this deployment? Continue working autonomously.",
      "Continue with the next required action to complete the deployment.",
      "What should be done next to finish this task? Proceed automatically.", 
      "Continue the deployment process. What is the next step?",
      "Keep working on the deployment. What needs to be done next?"
    ]
    
    // Use different prompts to avoid repetition
    return prompts[(iteration - 1) % prompts.length]
  }

  /**
   * Get human-readable reason why loop stopped
   */
  private getLoopStoppingReason(response: string): string {
    const lowerResponse = response.toLowerCase()
    
    if (lowerResponse.includes('completed') || lowerResponse.includes('finished')) {
      return 'Task completed successfully'
    }
    if (lowerResponse.includes('user input') || lowerResponse.includes('please provide')) {
      return 'User input required'
    }
    if (lowerResponse.includes('error') || lowerResponse.includes('failed')) {
      return 'Error encountered'
    }
    if (lowerResponse.includes('choose') || lowerResponse.includes('prefer')) {
      return 'User decision required'
    }
    
    return 'Natural stopping point reached'
  }

  /**
   * Generate comprehensive execution summary for autonomous loop completion
   */
  private generateExecutionSummary(
    iterations: number, 
    totalTokens: number, 
    toolsUsed: string[], 
    stoppingReason: string
  ): string {
    const isSuccess = stoppingReason.toLowerCase().includes('completed') || 
                     stoppingReason.toLowerCase().includes('successful')
    const emoji = isSuccess ? '✅' : '🔄'
    
    let summary = `${emoji} **Autonomous Execution ${isSuccess ? 'Complete' : 'Finished'}**\n\n`
    
    // Execution statistics
    summary += `**Execution Statistics:**\n`
    summary += `• **Iterations**: ${iterations} autonomous cycles\n`
    summary += `• **Token Usage**: ${totalTokens.toLocaleString()} tokens\n`
    summary += `• **Tools Executed**: ${toolsUsed.length} unique tools\n`
    summary += `• **Stopping Reason**: ${stoppingReason}\n\n`
    
    // Tools used breakdown
    if (toolsUsed.length > 0) {
      summary += `**Infrastructure Operations Performed:**\n`
      
      // Group tools by service for better readability
      const serviceGroups: { [key: string]: string[] } = {}
      toolsUsed.forEach(tool => {
        const service = tool.split('_')[0].toUpperCase()
        if (!serviceGroups[service]) {
          serviceGroups[service] = []
        }
        serviceGroups[service].push(tool.replace(`${service.toLowerCase()}_`, ''))
      })
      
      for (const [service, tools] of Object.entries(serviceGroups)) {
        const serviceNames: { [key: string]: string } = {
          'ATLAS': '🏗️ Atlas (Infrastructure)',
          'MERCURY': '📊 Mercury (Code Analysis)', 
          'NEPTUNE': '🌐 Neptune (DNS/Domain)',
          'HERMES': '🔐 Hermes (SSH/Security)',
          'PHOENIX': '🚀 Phoenix (Deployment)',
          'CONTEXT': '💾 Context (Configuration)'
        }
        
        const serviceName = serviceNames[service] || `${service} Service`
        summary += `• **${serviceName}**: ${tools.join(', ')}\n`
      }
      summary += '\n'
    }
    
    // Status and next steps
    if (isSuccess) {
      summary += `**Status**: Deployment request has been processed successfully! ✨\n\n`
      summary += `**Next Steps**: Check the detailed progress updates above to see exactly what infrastructure changes were made.`
    } else if (stoppingReason.includes('user')) {
      summary += `**Status**: Awaiting your input to continue the deployment process.\n\n`
      summary += `**Next Steps**: Please review the latest message above and provide the requested information.`
    } else if (stoppingReason.includes('error')) {
      summary += `**Status**: Encountered an issue that requires attention.\n\n`
      summary += `**Next Steps**: Review the error details above and try again with corrected parameters.`
    } else {
      summary += `**Status**: Autonomous execution paused at a natural decision point.\n\n`
      summary += `**Next Steps**: Review the progress above and continue with additional instructions if needed.`
    }
    
    // Add efficiency note for high token usage
    if (totalTokens > 20000) {
      summary += `\n\n⚡ **Performance Note**: This was a complex deployment requiring ${iterations} iteration${iterations > 1 ? 's' : ''} and ${totalTokens.toLocaleString()} tokens of AI processing. The autonomous loop ensured thorough execution without requiring manual intervention at each step.`
    }
    
    return summary
  }

  // EXECUTION ENGINE METHODS

  /**
   * Check if user input is an execute command
   */
  private isExecuteCommand(userInput: string): boolean {
    const executeKeywords = ['execute', 'run', 'proceed', 'yes', 'go ahead', 'start deployment']
    const input = userInput.toLowerCase().trim()
    
    return executeKeywords.some(keyword => 
      input === keyword || 
      input.includes(keyword)
    )
  }

  /**
   * Handle execute command - run actual deployment with real-time feedback
   */
  private async handleExecuteCommand(
    conversationId: string, 
    userInput: string, 
    conversation: Conversation, 
    jwtToken?: string
  ): Promise<WatsonResponse> {
    
    if (!jwtToken) {
      return {
        message: "❌ Authentication required to execute deployment plans.",
        response_type: 'error',
        attachments: []
      }
    }

    try {
      // Find the last deployment request in conversation history
      const recentMessages = conversation.messages.slice(-10)
      let deploymentRequest = ''
      
      for (let i = recentMessages.length - 1; i >= 0; i--) {
        const msg = recentMessages[i]
        if (msg.role === 'user' && this.isDeploymentRequest(msg.content)) {
          deploymentRequest = msg.content
          break
        }
      }

      if (!deploymentRequest) {
        return {
          message: "❌ No deployment request found to execute. Please provide a deployment request first.",
          response_type: 'error', 
          attachments: []
        }
      }

      // Execute the deployment plan using ExecutorService
      console.log(`[Watson] Executing deployment plan: ${deploymentRequest}`)
      
      const executionPlan = await this.executorService.executePlan(
        conversationId,
        conversation.user_id,
        conversation.workspace_id,
        jwtToken,
        deploymentRequest
      )

      return {
        message: `🚀 **Deployment Execution Started**

**Plan ID**: ${executionPlan.id}
**Steps**: ${executionPlan.steps.length}

✅ Step 1: ${executionPlan.steps[0]?.name || 'Initializing...'}

**Status**: Executing infrastructure deployment...
**Real-time updates**: You'll receive live progress updates as each step completes.

⏳ **Current Status**: ${executionPlan.status}`,
        response_type: 'text',
        attachments: []
      }

    } catch (error) {
      console.error('[Watson] Execute command failed:', error)
      
      return {
        message: `❌ **Execution Failed**

${error instanceof Error ? error.message : 'Unknown error occurred'}

Please check your credentials and try again.`,
        response_type: 'error',
        attachments: []
      }
    }
  }

}