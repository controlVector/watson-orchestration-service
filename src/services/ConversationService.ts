import { ConversationMessage, Conversation, ConversationStatus, WatsonResponse, ResponseType, WorkflowExecution, WatsonConfig, InfrastructureContext, ConversationContext } from '../types'
import { WorkflowEngine } from '../workflows/WorkflowEngine'
import { NotificationService } from './NotificationService'
import { MCPService } from './MCPService'
import { LLMService, LLMMessage } from './LLMService'
import { v4 as uuidv4 } from 'uuid'
import axios from 'axios'
import EventEmitter from 'eventemitter3'

export class ConversationService extends EventEmitter {
  private conversations: Map<string, Conversation> = new Map()
  private workflowEngine: WorkflowEngine
  private notificationService: NotificationService
  private mcpService: MCPService
  private llmService: LLMService
  private config: WatsonConfig

  constructor(config: WatsonConfig) {
    super()
    this.config = config
    this.workflowEngine = new WorkflowEngine(config)
    this.notificationService = new NotificationService()
    this.mcpService = new MCPService(config)
    this.llmService = new LLMService(config, this.mcpService)
    
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
        conversation.workspace_id
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