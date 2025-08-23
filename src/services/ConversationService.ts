import { ConversationMessage, Conversation, ConversationStatus, WatsonResponse, ResponseType, WorkflowExecution, WatsonConfig, InfrastructureContext, ConversationContext } from '../types'
import { ConversationParser } from '../parsers/ConversationParser'
import { WorkflowEngine } from '../workflows/WorkflowEngine'
import { NotificationService } from './NotificationService'
import { v4 as uuidv4 } from 'uuid'
import axios from 'axios'
import EventEmitter from 'eventemitter3'

export class ConversationService extends EventEmitter {
  private conversations: Map<string, Conversation> = new Map()
  private parser: ConversationParser
  private workflowEngine: WorkflowEngine
  private notificationService: NotificationService
  private config: WatsonConfig

  constructor(config: WatsonConfig) {
    super()
    this.config = config
    this.parser = new ConversationParser()
    this.workflowEngine = new WorkflowEngine(config)
    this.notificationService = new NotificationService()
    
    this.workflowEngine.on('workflow_progress', (execution: WorkflowExecution) => {
      this.handleWorkflowProgress(execution)
    })

    // Connect notification service to workflow events
    this.workflowEngine.on('workflow_progress', (execution: WorkflowExecution) => {
      this.notificationService.sendWorkflowProgress(execution)
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

  async processMessage(conversationId: string, userInput: string): Promise<WatsonResponse> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`)
    }

    const messageId = uuidv4()
    const timestamp = new Date().toISOString()

    const { intent, entities } = this.parser.parseInput(userInput)

    const userMessage: ConversationMessage = {
      id: messageId,
      conversation_id: conversationId,
      role: 'user',
      content: userInput,
      timestamp,
      intent,
      entities
    }

    conversation.messages.push(userMessage)
    conversation.last_activity_at = timestamp

    const infrastructureContext = await this.getInfrastructureContext(conversation.workspace_id)
    
    userMessage.infrastructure_context = infrastructureContext

    try {
      const response = await this.generateResponse(conversation, userMessage)
      
      const assistantMessage: ConversationMessage = {
        id: uuidv4(),
        conversation_id: conversationId,
        role: 'assistant',
        content: response.message,
        timestamp: new Date().toISOString()
      }

      if (response.workflow_execution) {
        assistantMessage.workflow_id = response.workflow_execution.id
        conversation.active_workflows.push(response.workflow_execution)
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

      return response
    } catch (error) {
      conversation.status = 'error'
      this.conversations.set(conversationId, conversation)
      throw error
    }
  }

  private async generateResponse(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    const intent = message.intent!

    switch (intent.name) {
      case 'deploy_application':
        return await this.handleDeploymentRequest(conversation, message)
      
      case 'create_infrastructure':
        return await this.handleInfrastructureRequest(conversation, message)
      
      case 'estimate_costs':
        return await this.handleCostEstimateRequest(conversation, message)
      
      case 'check_status':
        return await this.handleStatusRequest(conversation, message)
      
      case 'scale_infrastructure':
        return await this.handleScalingRequest(conversation, message)
        
      case 'delete_infrastructure':
        return await this.handleDeletionRequest(conversation, message)
      
      case 'explain_architecture':
        return await this.handleArchitectureExplanation(conversation, message)
      
      case 'troubleshoot':
        return await this.handleTroubleshootRequest(conversation, message)
      
      case 'get_recommendations':
        return await this.handleRecommendationsRequest(conversation, message)
      
      case 'manage_costs':
        return await this.handleCostManagementRequest(conversation, message)
      
      case 'security_review':
        return await this.handleSecurityReviewRequest(conversation, message)
      
      case 'greeting':
        return this.handleGreeting(conversation, message)
      
      case 'general_question':
        return this.handleGeneralQuestion(conversation, message)
      
      default:
        return {
          message: "I'm not sure how to help with that. Could you please rephrase your request? I can help you deploy applications, manage infrastructure, estimate costs, and more.",
          response_type: 'question'
        }
    }
  }

  private async handleDeploymentRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    const entities = message.entities || []
    const technologies = entities.filter(e => e.type === 'technology').map(e => e.value)
    
    const workflowExecution = await this.workflowEngine.startWorkflow('deploy-application', {
      user_input: message.content,
      conversation_id: conversation.id,
      workspace_id: conversation.workspace_id,
      user_id: conversation.user_id,
      entities,
      technologies
    })

    return {
      message: `I'll help you deploy your application. Let me analyze your requirements and create a deployment plan.`,
      response_type: 'progress_update',
      workflow_execution: workflowExecution,
      next_steps: [
        'Analyzing your application requirements',
        'Estimating infrastructure costs',
        'Creating deployment configuration'
      ]
    }
  }

  private async handleInfrastructureRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    const entities = message.entities || []
    
    const workflowExecution = await this.workflowEngine.startWorkflow('create-infrastructure', {
      user_input: message.content,
      conversation_id: conversation.id,
      workspace_id: conversation.workspace_id,
      user_id: conversation.user_id,
      entities
    })

    return {
      message: `I'll help you create the infrastructure you need. Let me gather the requirements and prepare a cost estimate.`,
      response_type: 'progress_update',
      workflow_execution: workflowExecution,
      next_steps: [
        'Analyzing infrastructure requirements',
        'Calculating estimated costs',
        'Preparing resource specifications'
      ]
    }
  }

  private async handleCostEstimateRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    try {
      const infrastructureContext = message.infrastructure_context!
      
      return {
        message: `Based on your current infrastructure, here's your cost summary:\n\n**Current Monthly Cost:** $${infrastructureContext.current_monthly_cost.toFixed(2)}\n**Projected Monthly Cost:** $${infrastructureContext.projected_monthly_cost.toFixed(2)}\n**Cost Trend:** ${infrastructureContext.cost_trend}\n\nWould you like a detailed breakdown or recommendations for cost optimization?`,
        response_type: 'cost_estimate',
        attachments: [{
          type: 'cost_breakdown',
          title: 'Cost Breakdown',
          data: infrastructureContext,
          format: 'table'
        }],
        suggested_actions: [{
          id: 'cost_optimization',
          text: 'Get cost optimization recommendations',
          action_type: 'quick_reply',
          action_data: { intent: 'get_recommendations', focus: 'cost_optimization' }
        }]
      }
    } catch (error) {
      return {
        message: "I couldn't retrieve your current cost information. Would you like me to estimate costs for a specific infrastructure setup?",
        response_type: 'question'
      }
    }
  }

  private async handleStatusRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    try {
      const infrastructureContext = message.infrastructure_context!
      const activeInfra = infrastructureContext.active_infrastructure
      const pendingOps = infrastructureContext.pending_operations

      let statusMessage = "Here's your current infrastructure status:\n\n"
      
      if (activeInfra.length > 0) {
        statusMessage += "**Active Infrastructure:**\n"
        activeInfra.forEach(infra => {
          const healthIcon = infra.health_status === 'healthy' ? '🟢' : infra.health_status === 'warning' ? '🟡' : '🔴'
          statusMessage += `${healthIcon} ${infra.name} (${infra.type}) - ${infra.status}\n`
        })
        statusMessage += "\n"
      }

      if (pendingOps.length > 0) {
        statusMessage += "**Pending Operations:**\n"
        pendingOps.forEach(op => {
          statusMessage += `⏳ ${op.type} - ${op.progress_percentage}% complete\n`
        })
      } else {
        statusMessage += "No pending operations.\n"
      }

      return {
        message: statusMessage,
        response_type: 'infrastructure_status',
        attachments: [{
          type: 'infrastructure_diagram',
          title: 'Infrastructure Overview',
          data: infrastructureContext,
          format: 'diagram'
        }]
      }
    } catch (error) {
      return {
        message: "I couldn't retrieve your infrastructure status. Would you like me to check on specific resources?",
        response_type: 'question'
      }
    }
  }

  private async handleScalingRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    return {
      message: "I can help you scale your infrastructure. Which resources would you like to scale, and what are your performance requirements?",
      response_type: 'question',
      suggested_actions: [
        {
          id: 'scale_servers',
          text: 'Scale web servers',
          action_type: 'quick_reply',
          action_data: { resource_type: 'droplet', action: 'scale' }
        },
        {
          id: 'scale_database',
          text: 'Scale database',
          action_type: 'quick_reply',
          action_data: { resource_type: 'database', action: 'scale' }
        }
      ]
    }
  }

  private async handleDeletionRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    return {
      message: "⚠️ I can help you delete infrastructure resources. Please specify which resources you'd like to remove. Note that this action cannot be undone and may result in data loss.",
      response_type: 'confirmation',
      suggested_actions: [{
        id: 'list_resources',
        text: 'Show me my resources first',
        action_type: 'quick_reply',
        action_data: { intent: 'check_status' }
      }]
    }
  }

  private async handleArchitectureExplanation(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    try {
      const infrastructureContext = message.infrastructure_context!
      
      if (infrastructureContext.active_infrastructure.length === 0) {
        return {
          message: "You don't currently have any active infrastructure. Would you like me to help you create some?",
          response_type: 'question',
          suggested_actions: [{
            id: 'create_infra',
            text: 'Create infrastructure',
            action_type: 'quick_reply',
            action_data: { intent: 'create_infrastructure' }
          }]
        }
      }

      let explanation = "Here's an overview of your current architecture:\n\n"
      
      const grouped = infrastructureContext.active_infrastructure.reduce((acc, infra) => {
        if (!acc[infra.type]) acc[infra.type] = []
        acc[infra.type].push(infra)
        return acc
      }, {} as Record<string, typeof infrastructureContext.active_infrastructure>)

      Object.entries(grouped).forEach(([type, resources]) => {
        explanation += `**${type.charAt(0).toUpperCase() + type.slice(1)}s:**\n`
        resources.forEach(resource => {
          explanation += `• ${resource.name} in ${resource.region} - $${resource.monthly_cost}/month\n`
        })
        explanation += "\n"
      })

      return {
        message: explanation,
        response_type: 'infrastructure_status',
        attachments: [{
          type: 'infrastructure_diagram',
          title: 'Architecture Diagram',
          data: infrastructureContext,
          format: 'diagram'
        }]
      }
    } catch (error) {
      return {
        message: "I couldn't retrieve your architecture information. Would you like me to help you set up some infrastructure?",
        response_type: 'question'
      }
    }
  }

  private async handleTroubleshootRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    try {
      const infrastructureContext = message.infrastructure_context!
      
      if (infrastructureContext.active_issues.length === 0) {
        return {
          message: "Great news! I don't see any active issues with your infrastructure. All systems appear to be running normally.",
          response_type: 'text'
        }
      }

      let troubleshootMessage = "I found some issues that might need attention:\n\n"
      
      infrastructureContext.active_issues.forEach(issue => {
        const severityIcon = issue.severity === 'critical' ? '🚨' : issue.severity === 'high' ? '⚠️' : issue.severity === 'medium' ? '🟡' : '🔵'
        troubleshootMessage += `${severityIcon} **${issue.title}** (${issue.severity})\n`
        troubleshootMessage += `${issue.description}\n`
        if (issue.auto_resolvable) {
          troubleshootMessage += `✅ This can be automatically resolved.\n`
        }
        troubleshootMessage += "\n"
      })

      return {
        message: troubleshootMessage,
        response_type: 'text',
        suggested_actions: [{
          id: 'auto_resolve',
          text: 'Auto-resolve fixable issues',
          action_type: 'quick_reply',
          action_data: { action: 'auto_resolve_issues' }
        }]
      }
    } catch (error) {
      return {
        message: "I couldn't check for infrastructure issues. Could you describe the specific problem you're experiencing?",
        response_type: 'question'
      }
    }
  }

  private async handleRecommendationsRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    try {
      const infrastructureContext = message.infrastructure_context!
      
      if (infrastructureContext.recommendations.length === 0) {
        return {
          message: "Your infrastructure looks well-optimized! I don't have any specific recommendations at this time.",
          response_type: 'text'
        }
      }

      let recommendationsMessage = "Here are my recommendations for optimizing your infrastructure:\n\n"
      
      infrastructureContext.recommendations.forEach(rec => {
        const priorityIcon = rec.priority === 'high' ? '🔥' : rec.priority === 'medium' ? '⚡' : '💡'
        recommendationsMessage += `${priorityIcon} **${rec.title}** (${rec.type})\n`
        recommendationsMessage += `${rec.description}\n`
        if (rec.potential_savings) {
          recommendationsMessage += `💰 Potential savings: $${rec.potential_savings}/month\n`
        }
        recommendationsMessage += `🔧 Implementation effort: ${rec.implementation_effort}\n\n`
      })

      return {
        message: recommendationsMessage,
        response_type: 'text',
        attachments: [{
          type: 'cost_breakdown',
          title: 'Optimization Recommendations',
          data: infrastructureContext.recommendations,
          format: 'table'
        }]
      }
    } catch (error) {
      return {
        message: "I couldn't generate recommendations right now. Would you like me to analyze your infrastructure for cost optimization opportunities?",
        response_type: 'question'
      }
    }
  }

  private async handleCostManagementRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    return {
      message: "I can help you manage and optimize your infrastructure costs. What would you like to focus on?",
      response_type: 'question',
      suggested_actions: [
        {
          id: 'cost_breakdown',
          text: 'Show detailed cost breakdown',
          action_type: 'quick_reply',
          action_data: { intent: 'estimate_costs', detail: 'breakdown' }
        },
        {
          id: 'cost_optimization',
          text: 'Get cost optimization tips',
          action_type: 'quick_reply',
          action_data: { intent: 'get_recommendations', focus: 'cost' }
        },
        {
          id: 'set_budget_alerts',
          text: 'Set up budget alerts',
          action_type: 'quick_reply',
          action_data: { action: 'configure_budget_alerts' }
        }
      ]
    }
  }

  private async handleSecurityReviewRequest(conversation: Conversation, message: ConversationMessage): Promise<WatsonResponse> {
    return {
      message: "I'll help you review the security of your infrastructure. Let me check your current security configuration and identify any potential vulnerabilities.",
      response_type: 'progress_update',
      next_steps: [
        'Analyzing firewall configurations',
        'Checking SSL/TLS certificates',
        'Reviewing access controls',
        'Scanning for security vulnerabilities'
      ],
      suggested_actions: [{
        id: 'security_scan',
        text: 'Run comprehensive security scan',
        action_type: 'workflow',
        action_data: { workflow: 'security-review' }
      }]
    }
  }

  private handleGreeting(conversation: Conversation, message: ConversationMessage): WatsonResponse {
    const greetings = [
      "Hello! I'm Watson, your infrastructure assistant. How can I help you deploy or manage your applications today?",
      "Hi there! Ready to build something great? I can help you with deployments, infrastructure management, and cost optimization.",
      "Hey! What can I help you build or deploy today?",
      "Hello! I'm here to help you with all your infrastructure needs. What would you like to work on?"
    ]

    return {
      message: greetings[Math.floor(Math.random() * greetings.length)],
      response_type: 'text',
      suggested_actions: [
        {
          id: 'deploy_app',
          text: 'Deploy an application',
          action_type: 'quick_reply',
          action_data: { intent: 'deploy_application' }
        },
        {
          id: 'create_infra',
          text: 'Create infrastructure',
          action_type: 'quick_reply',
          action_data: { intent: 'create_infrastructure' }
        },
        {
          id: 'check_status',
          text: 'Check my infrastructure',
          action_type: 'quick_reply',
          action_data: { intent: 'check_status' }
        }
      ]
    }
  }

  private handleGeneralQuestion(conversation: Conversation, message: ConversationMessage): WatsonResponse {
    return {
      message: "I specialize in helping with infrastructure and deployment tasks. I can help you deploy applications, manage cloud resources, estimate costs, and optimize performance. What specific infrastructure question can I help you with?",
      response_type: 'question',
      suggested_actions: [
        {
          id: 'learn_capabilities',
          text: 'What can you help me with?',
          action_type: 'quick_reply',
          action_data: { action: 'show_capabilities' }
        },
        {
          id: 'get_started',
          text: 'Help me get started',
          action_type: 'quick_reply',
          action_data: { intent: 'greeting' }
        }
      ]
    }
  }

  private async getInfrastructureContext(workspaceId: string): Promise<InfrastructureContext> {
    try {
      const response = await axios.get(`${this.config.atlas_url}/api/infrastructure`, {
        params: { workspace_id: workspaceId }
      })

      return {
        active_infrastructure: response.data.infrastructure || [],
        pending_operations: response.data.operations || [],
        current_monthly_cost: response.data.current_monthly_cost || 0,
        projected_monthly_cost: response.data.projected_monthly_cost || 0,
        cost_trend: response.data.cost_trend || 'stable',
        performance_summary: response.data.performance_summary || {
          average_response_time: 0,
          requests_per_minute: 0,
          error_rate: 0,
          uptime_percentage: 100
        },
        active_issues: response.data.issues || [],
        recommendations: response.data.recommendations || []
      }
    } catch (error) {
      return {
        active_infrastructure: [],
        pending_operations: [],
        current_monthly_cost: 0,
        projected_monthly_cost: 0,
        cost_trend: 'stable',
        performance_summary: {
          average_response_time: 0,
          requests_per_minute: 0,
          error_rate: 0,
          uptime_percentage: 100
        },
        active_issues: [],
        recommendations: []
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
}