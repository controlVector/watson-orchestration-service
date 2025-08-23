import { FastifyRequest, FastifyReply } from 'fastify'
import { ConversationService } from '../services/ConversationService'
import { WatsonConfig } from '../types'
import { z } from 'zod'

const CreateConversationSchema = z.object({
  workspace_id: z.string().uuid(),
  user_id: z.string().uuid()
})

const SendMessageSchema = z.object({
  message: z.string().min(1).max(10000),
  conversation_id: z.string().uuid()
})

const GetConversationsSchema = z.object({
  workspace_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0)
})

interface ConversationController {
  conversationService: ConversationService
}

export function createConversationController(config: WatsonConfig): ConversationController {
  const conversationService = new ConversationService(config)
  
  return { conversationService }
}

export async function createConversation(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = CreateConversationSchema.parse(request.body)
    
    const conversation = await this.conversationService.createConversation(
      body.workspace_id,
      body.user_id
    )

    reply.code(201).send({
      success: true,
      data: conversation
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      reply.code(400).send({
        success: false,
        error: 'Validation error',
        details: error.errors
      })
    } else {
      request.log.error(error, 'Failed to create conversation')
      reply.code(500).send({
        success: false,
        error: 'Failed to create conversation'
      })
    }
  }
}

export async function sendMessage(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = SendMessageSchema.parse(request.body)
    
    const response = await this.conversationService.processMessage(
      body.conversation_id,
      body.message
    )

    reply.send({
      success: true,
      data: response
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      reply.code(400).send({
        success: false,
        error: 'Validation error',
        details: error.errors
      })
    } else {
      request.log.error(error, 'Failed to process message')
      reply.code(500).send({
        success: false,
        error: 'Failed to process message',
        message: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  }
}

export async function getConversation(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const { conversationId } = request.params as { conversationId: string }
    
    if (!conversationId) {
      reply.code(400).send({
        success: false,
        error: 'Conversation ID is required'
      })
      return
    }

    const conversation = this.conversationService.getConversation(conversationId)
    
    if (!conversation) {
      reply.code(404).send({
        success: false,
        error: 'Conversation not found'
      })
      return
    }

    reply.send({
      success: true,
      data: conversation
    })
  } catch (error) {
    request.log.error(error, 'Failed to get conversation')
    reply.code(500).send({
      success: false,
      error: 'Failed to get conversation'
    })
  }
}

export async function getConversations(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const query = GetConversationsSchema.parse(request.query)
    
    const conversations = this.conversationService.getConversations(
      query.workspace_id,
      query.user_id
    )

    const total = conversations.length
    const paginatedConversations = conversations
      .sort((a, b) => new Date(b.last_activity_at).getTime() - new Date(a.last_activity_at).getTime())
      .slice(query.offset, query.offset + query.limit)

    reply.send({
      success: true,
      data: {
        conversations: paginatedConversations,
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
          has_more: query.offset + query.limit < total
        }
      }
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      reply.code(400).send({
        success: false,
        error: 'Validation error',
        details: error.errors
      })
    } else {
      request.log.error(error, 'Failed to get conversations')
      reply.code(500).send({
        success: false,
        error: 'Failed to get conversations'
      })
    }
  }
}

export async function getConversationMessages(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const { conversationId } = request.params as { conversationId: string }
    const query = request.query as { limit?: string, offset?: string }
    
    if (!conversationId) {
      reply.code(400).send({
        success: false,
        error: 'Conversation ID is required'
      })
      return
    }

    const conversation = this.conversationService.getConversation(conversationId)
    
    if (!conversation) {
      reply.code(404).send({
        success: false,
        error: 'Conversation not found'
      })
      return
    }

    const limit = Math.min(parseInt(query.limit || '50'), 100)
    const offset = Math.max(parseInt(query.offset || '0'), 0)

    const messages = conversation.messages
      .slice()
      .reverse()
      .slice(offset, offset + limit)
      .reverse()

    reply.send({
      success: true,
      data: {
        messages,
        conversation_id: conversationId,
        pagination: {
          total: conversation.messages.length,
          limit,
          offset,
          has_more: offset + limit < conversation.messages.length
        }
      }
    })
  } catch (error) {
    request.log.error(error, 'Failed to get conversation messages')
    reply.code(500).send({
      success: false,
      error: 'Failed to get conversation messages'
    })
  }
}

export async function getActiveWorkflows(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const { conversationId } = request.params as { conversationId: string }
    
    if (!conversationId) {
      reply.code(400).send({
        success: false,
        error: 'Conversation ID is required'
      })
      return
    }

    const conversation = this.conversationService.getConversation(conversationId)
    
    if (!conversation) {
      reply.code(404).send({
        success: false,
        error: 'Conversation not found'
      })
      return
    }

    reply.send({
      success: true,
      data: {
        workflows: conversation.active_workflows,
        count: conversation.active_workflows.length
      }
    })
  } catch (error) {
    request.log.error(error, 'Failed to get active workflows')
    reply.code(500).send({
      success: false,
      error: 'Failed to get active workflows'
    })
  }
}

export async function getConversationEvents(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const { conversationId } = request.params as { conversationId: string }
    const query = request.query as { limit?: string }
    
    if (!conversationId) {
      reply.code(400).send({
        success: false,
        error: 'Conversation ID is required'
      })
      return
    }

    const limit = Math.min(parseInt(query.limit || '50'), 100)
    const events = this.conversationService.getConversationEvents(conversationId, limit)

    reply.send({
      success: true,
      data: {
        events,
        conversation_id: conversationId,
        count: events.length
      }
    })
  } catch (error) {
    request.log.error(error, 'Failed to get conversation events')
    reply.code(500).send({
      success: false,
      error: 'Failed to get conversation events'
    })
  }
}

export async function streamConversationEvents(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const { conversationId } = request.params as { conversationId: string }
    
    if (!conversationId) {
      reply.code(400).send({
        success: false,
        error: 'Conversation ID is required'
      })
      return
    }

    // Verify conversation exists
    const conversation = this.conversationService.getConversation(conversationId)
    if (!conversation) {
      reply.code(404).send({
        success: false,
        error: 'Conversation not found'
      })
      return
    }

    // Set up Server-Sent Events
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    })

    const eventStream = this.conversationService.createEventStream(conversationId)
    
    // Send initial connection event
    reply.raw.write(`data: ${JSON.stringify({
      type: 'connected',
      conversation_id: conversationId,
      timestamp: new Date().toISOString()
    })}\n\n`)

    // Handle events
    eventStream.on('event', (event) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    // Clean up on client disconnect
    request.raw.on('close', () => {
      eventStream.emit('close')
    })

  } catch (error) {
    request.log.error(error, 'Failed to stream conversation events')
    reply.code(500).send({
      success: false,
      error: 'Failed to stream conversation events'
    })
  }
}

export async function getNotificationStats(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const notificationService = this.conversationService.getNotificationService()
    const stats = notificationService.getStats()

    reply.send({
      success: true,
      data: stats
    })
  } catch (error) {
    request.log.error(error, 'Failed to get notification stats')
    reply.code(500).send({
      success: false,
      error: 'Failed to get notification stats'
    })
  }
}

export async function healthCheck(
  this: ConversationController,
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    reply.send({
      success: true,
      service: 'watson',
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0'
    })
  } catch (error) {
    request.log.error(error, 'Health check failed')
    reply.code(500).send({
      success: false,
      error: 'Health check failed'
    })
  }
}