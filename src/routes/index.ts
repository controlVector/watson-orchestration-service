import { FastifyInstance } from 'fastify'
import { WebSocketServer } from 'ws'
import { 
  createConversationController,
  createConversation,
  sendMessage,
  getConversation,
  getConversations,
  getConversationMessages,
  getActiveWorkflows,
  getConversationEvents,
  streamConversationEvents,
  getNotificationStats,
  healthCheck
} from '../controllers/ConversationController'
import { statusRoutes } from './status'
import { WatsonConfig } from '../types'

export async function registerRoutes(fastify: FastifyInstance, config: WatsonConfig) {
  const controller = createConversationController(config)

  fastify.get('/health', {
    handler: healthCheck.bind(controller)
  })

  fastify.post('/api/conversations', {
    handler: createConversation.bind(controller)
  })

  fastify.post('/api/conversations/message', {
    handler: sendMessage.bind(controller)
  })

  fastify.get('/api/conversations', {
    handler: getConversations.bind(controller)
  })

  fastify.get('/api/conversations/:conversationId', {
    handler: getConversation.bind(controller)
  })

  fastify.get('/api/conversations/:conversationId/messages', {
    handler: getConversationMessages.bind(controller)
  })

  fastify.get('/api/conversations/:conversationId/workflows', {
    handler: getActiveWorkflows.bind(controller)
  })

  fastify.get('/api/conversations/:conversationId/events', {
    handler: getConversationEvents.bind(controller)
  })

  fastify.get('/api/conversations/:conversationId/stream', {
    handler: streamConversationEvents.bind(controller)
  })

  fastify.get('/api/notifications/stats', {
    handler: getNotificationStats.bind(controller)
  })

  // Register status routes for error monitoring and deployment health
  await statusRoutes(fastify, config)

  if (config.enable_websockets) {
    await fastify.register(require('@fastify/websocket'))
    
    fastify.register(async function (fastify) {
      fastify.get('/ws', { websocket: true } as any, (connection: any, request: any) => {
        connection.socket.on('message', async (message: any) => {
          try {
            const data = JSON.parse(message.toString())
            
            if (data.type === 'subscribe') {
              (connection.socket as any).conversationId = data.conversation_id
            } else if (data.type === 'user_message') {
              // Send typing indicator
              connection.socket.send(JSON.stringify({
                type: 'typing_indicator',
                is_typing: true,
                agent: 'Watson',
                timestamp: new Date().toISOString()
              }))
              
              // Extract JWT token from WebSocket query parameters
              const token = request.query?.token as string
              
              const response = await controller.conversationService.processMessage(
                data.conversation_id,
                data.content,
                token
              )
              
              // Send AI response
              connection.socket.send(JSON.stringify({
                type: 'ai_response',
                content: response.message,
                conversation_id: data.conversation_id,
                intent: 'general',
                confidence: 0.9,
                agent: 'Watson',
                timestamp: new Date().toISOString()
              }))
            } else if (data.type === 'message') {
              // Legacy support
              const response = await controller.conversationService.processMessage(
                data.conversation_id,
                data.message
              )
              
              connection.socket.send(JSON.stringify({
                type: 'response',
                data: response,
                timestamp: new Date().toISOString()
              }))
            }
          } catch (error) {
            connection.socket.send(JSON.stringify({
              type: 'error',
              message: error instanceof Error ? error.message : 'Failed to process message',
              timestamp: new Date().toISOString()
            }))
          }
        })

        connection.socket.on('error', (error: any) => {
          fastify.log.error(error, 'WebSocket error')
        })

        connection.socket.on('close', () => {
          fastify.log.info('WebSocket connection closed')
        })

        connection.socket.send(JSON.stringify({
          type: 'connected',
          message: 'WebSocket connection established',
          timestamp: new Date().toISOString()
        }))
      })
    })

    controller.conversationService.on('conversation_message', (data: any) => {
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'message',
              data: data.message,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    controller.conversationService.on('workflow_progress', (data: any) => {
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'workflow_progress',
              data: data.workflow_execution,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })
  }
}