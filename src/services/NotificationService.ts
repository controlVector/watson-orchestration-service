import { EventEmitter } from 'eventemitter3'
import { WatsonEvent, WatsonEventType, WorkflowExecution, ConversationMessage } from '../types'
import { v4 as uuidv4 } from 'uuid'

interface NotificationChannel {
  id: string
  type: 'websocket' | 'webhook' | 'email'
  endpoint?: string
  filters?: WatsonEventType[]
  conversation_id?: string
  user_id?: string
  workspace_id?: string
}

export class NotificationService extends EventEmitter {
  private channels: Map<string, NotificationChannel> = new Map()
  private eventHistory: WatsonEvent[] = []
  private maxHistorySize = 1000

  constructor() {
    super()
  }

  /**
   * Register a notification channel
   */
  registerChannel(channel: NotificationChannel): string {
    const channelId = channel.id || uuidv4()
    this.channels.set(channelId, { ...channel, id: channelId })
    
    this.emit('channel_registered', {
      channel_id: channelId,
      type: channel.type,
      timestamp: new Date().toISOString()
    })

    return channelId
  }

  /**
   * Unregister a notification channel
   */
  unregisterChannel(channelId: string): boolean {
    const existed = this.channels.delete(channelId)
    
    if (existed) {
      this.emit('channel_unregistered', {
        channel_id: channelId,
        timestamp: new Date().toISOString()
      })
    }

    return existed
  }

  /**
   * Send a Watson event notification
   */
  sendEvent(event: Omit<WatsonEvent, 'id' | 'timestamp'>): void {
    const watsonEvent: WatsonEvent = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      ...event
    }

    // Store in history
    this.eventHistory.push(watsonEvent)
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift()
    }

    // Send to matching channels
    this.channels.forEach((channel) => {
      if (this.shouldNotifyChannel(channel, watsonEvent)) {
        this.notifyChannel(channel, watsonEvent)
      }
    })

    // Emit for internal listeners
    this.emit('watson_event', watsonEvent)
  }

  /**
   * Send conversation message notification
   */
  sendConversationMessage(conversationId: string, message: ConversationMessage): void {
    this.sendEvent({
      type: 'conversation.message',
      conversation_id: conversationId,
      data: {
        message,
        role: message.role,
        content: message.content,
        intent: message.intent,
        entities: message.entities
      }
    })
  }

  /**
   * Send workflow progress notification
   */
  sendWorkflowProgress(execution: WorkflowExecution): void {
    let eventType: WatsonEventType = 'workflow.progress'
    
    if (execution.status === 'pending') {
      eventType = 'workflow.started'
    } else if (execution.status === 'completed') {
      eventType = 'workflow.completed'
    } else if (execution.status === 'failed' || execution.status === 'timeout' || execution.status === 'cancelled') {
      eventType = 'workflow.failed'
    }

    this.sendEvent({
      type: eventType,
      conversation_id: execution.conversation_id,
      workflow_id: execution.id,
      data: {
        execution,
        workflow_id: execution.workflow_id,
        status: execution.status,
        progress: execution.progress,
        current_step: execution.current_step_id,
        outputs: execution.outputs
      }
    })
  }

  /**
   * Send infrastructure status change notification
   */
  sendInfrastructureStatusChange(infrastructureId: string, oldStatus: string, newStatus: string, conversationId?: string): void {
    this.sendEvent({
      type: 'infrastructure.status_change',
      conversation_id: conversationId || 'system',
      data: {
        infrastructure_id: infrastructureId,
        old_status: oldStatus,
        new_status: newStatus,
        changed_at: new Date().toISOString()
      }
    })
  }

  /**
   * Send cost alert notification
   */
  sendCostAlert(workspaceId: string, alertType: string, currentCost: number, limit: number, conversationId?: string): void {
    this.sendEvent({
      type: 'cost.alert',
      conversation_id: conversationId || 'system',
      data: {
        workspace_id: workspaceId,
        alert_type: alertType,
        current_cost: currentCost,
        limit,
        percentage: (currentCost / limit) * 100,
        triggered_at: new Date().toISOString()
      }
    })
  }

  /**
   * Send approval required notification
   */
  sendApprovalRequired(execution: WorkflowExecution, approvalRequest: any): void {
    this.sendEvent({
      type: 'approval.required',
      conversation_id: execution.conversation_id,
      workflow_id: execution.id,
      data: {
        execution,
        approval_request: approvalRequest,
        requires_approval_by: new Date(Date.now() + 30 * 60 * 1000).toISOString() // 30 minutes from now
      }
    })
  }

  /**
   * Send error notification from Atlas service
   */
  sendErrorNotification(error: {
    type: 'error' | 'warning' | 'recovery_needed'
    service: string
    error: {
      timestamp: string
      service: string
      operation: string
      level: 'warn' | 'error' | 'fatal'
      message: string
      error?: any
      context: {
        workspace_id?: string
        user_id?: string
        request_id?: string
        session_id?: string
      }
      suggestions?: string[]
      recovery_actions?: string[]
    }
    recovery_suggestions: string[]
    user_visible: boolean
  }, conversationId?: string): void {
    this.sendEvent({
      type: 'infrastructure.error',
      conversation_id: conversationId || error.error.context.session_id || 'system',
      data: {
        error_type: error.type,
        source_service: error.service,
        operation: error.error.operation,
        level: error.error.level,
        error_message: error.error.message,
        user_message: error.error.error?.userMessage || error.error.message,
        suggestions: error.error.suggestions || [],
        recovery_actions: error.recovery_suggestions,
        context: error.error.context,
        user_visible: error.user_visible,
        timestamp: error.error.timestamp,
        technical_details: {
          error_code: error.error.error?.code,
          stack: error.error.error?.stack,
          metadata: error.error.error?.metadata
        }
      }
    })
  }

  /**
   * Get event history for a conversation
   */
  getConversationHistory(conversationId: string, limit = 50): WatsonEvent[] {
    return this.eventHistory
      .filter(event => event.conversation_id === conversationId)
      .slice(-limit)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }

  /**
   * Get all events for a workspace
   */
  getWorkspaceEvents(workspaceId: string, eventTypes?: WatsonEventType[], limit = 100): WatsonEvent[] {
    return this.eventHistory
      .filter(event => {
        // Filter by workspace (this would require workspace info in events)
        const matchesWorkspace = true // TODO: Add workspace filtering when we have workspace data in events
        const matchesType = !eventTypes || eventTypes.includes(event.type)
        return matchesWorkspace && matchesType
      })
      .slice(-limit)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }

  /**
   * Get channel information
   */
  getChannel(channelId: string): NotificationChannel | undefined {
    return this.channels.get(channelId)
  }

  /**
   * List all active channels
   */
  listChannels(): NotificationChannel[] {
    return Array.from(this.channels.values())
  }

  /**
   * Check if channel should be notified for this event
   */
  private shouldNotifyChannel(channel: NotificationChannel, event: WatsonEvent): boolean {
    // Check event type filters
    if (channel.filters && !channel.filters.includes(event.type)) {
      return false
    }

    // Check conversation filter
    if (channel.conversation_id && channel.conversation_id !== event.conversation_id) {
      return false
    }

    // Check user filter (would need user info in event)
    if (channel.user_id) {
      // TODO: Add user filtering when we have user data in events
    }

    // Check workspace filter (would need workspace info in event)
    if (channel.workspace_id) {
      // TODO: Add workspace filtering when we have workspace data in events
    }

    return true
  }

  /**
   * Send notification to specific channel
   */
  private async notifyChannel(channel: NotificationChannel, event: WatsonEvent): Promise<void> {
    try {
      switch (channel.type) {
        case 'websocket':
          this.emit('websocket_notification', {
            channel_id: channel.id,
            event
          })
          break

        case 'webhook':
          if (channel.endpoint) {
            await this.sendWebhook(channel.endpoint, event)
          }
          break

        case 'email':
          // TODO: Implement email notifications
          this.emit('email_notification', {
            channel_id: channel.id,
            event
          })
          break

        default:
          console.warn(`Unknown notification channel type: ${channel.type}`)
      }
    } catch (error) {
      console.error(`Failed to notify channel ${channel.id}:`, error)
      this.emit('notification_failed', {
        channel_id: channel.id,
        error: error instanceof Error ? error.message : 'Unknown error',
        event_id: event.id
      })
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(endpoint: string, event: WatsonEvent): Promise<void> {
    const axios = require('axios')
    
    await axios.post(endpoint, {
      event_id: event.id,
      event_type: event.type,
      conversation_id: event.conversation_id,
      workflow_id: event.workflow_id,
      timestamp: event.timestamp,
      data: event.data
    }, {
      timeout: 5000,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Watson-Orchestration-Engine/1.0.0'
      }
    })
  }

  /**
   * Create a real-time event stream for a conversation
   */
  createEventStream(conversationId: string, eventTypes?: WatsonEventType[]): EventEmitter {
    const stream = new EventEmitter()
    
    const handleEvent = (event: WatsonEvent) => {
      if (event.conversation_id === conversationId) {
        if (!eventTypes || eventTypes.includes(event.type)) {
          stream.emit('event', event)
        }
      }
    }

    this.on('watson_event', handleEvent)
    
    // Clean up listener when stream is closed
    stream.on('close', () => {
      this.off('watson_event', handleEvent)
    })

    return stream
  }

  /**
   * Get real-time statistics
   */
  getStats(): {
    total_events: number
    events_by_type: Record<string, number>
    active_channels: number
    channels_by_type: Record<string, number>
  } {
    const eventsByType: Record<string, number> = {}
    this.eventHistory.forEach(event => {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1
    })

    const channelsByType: Record<string, number> = {}
    this.channels.forEach(channel => {
      channelsByType[channel.type] = (channelsByType[channel.type] || 0) + 1
    })

    return {
      total_events: this.eventHistory.length,
      events_by_type: eventsByType,
      active_channels: this.channels.size,
      channels_by_type: channelsByType
    }
  }
}