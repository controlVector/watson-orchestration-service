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
import { validationRoutes } from './validation'
import { deploymentRoutes } from './deployment'
import { unifiedDeploymentRoutes } from './unified-deployment'
import { WatsonConfig } from '../types'
import { registerMCPRoutes } from '../mcp/routes'
import { WatsonMCPHandler } from '../mcp/handler'
import { MCPService } from '../services/MCPService'
import { LLMService } from '../services/LLMService'
import { DeploymentOrchestrator } from '../services/DeploymentOrchestrator'
import { ErrorHandlingService } from '../services/ErrorHandlingService'
import { StatusMonitoringService } from '../services/StatusMonitoringService'

function createWatsonMCPHandler(config: WatsonConfig): WatsonMCPHandler {
  const mcpService = new MCPService(config)
  const llmService = new LLMService(config, mcpService)
  const errorHandlingService = new ErrorHandlingService(llmService)
  const statusMonitoringService = new StatusMonitoringService()
  const deploymentOrchestrator = new DeploymentOrchestrator(
    mcpService,
    errorHandlingService,
    statusMonitoringService,
    llmService
  )
  
  return new WatsonMCPHandler(
    mcpService,
    llmService,
    deploymentOrchestrator,
    errorHandlingService
  )
}

export async function registerRoutes(fastify: FastifyInstance, config: WatsonConfig) {
  const controller = createConversationController(config)
  const mcpHandler = createWatsonMCPHandler(config)

  fastify.get('/health', {
    handler: healthCheck.bind(controller)
  })

  // Test endpoint for verifying tool execution
  fastify.post('/test/message', {
    handler: async (request, reply) => {
      try {
        const { message } = request.body as { message: string }
        
        // Extract real credentials from Authorization header
        const authHeader = request.headers.authorization as string
        const jwtToken = authHeader?.replace('Bearer ', '') || 'test-jwt-token'
        
        // Create a test conversation with real user/workspace if available
        const conversation = await controller.conversationService.createConversation(
          '146473cb-7285-4037-a926-869e8782e4f3', // real workspace
          'a104e3d2-b630-4d87-baab-6a6a0fb70ec0'  // real user
        )
        
        // Process message with real JWT token
        const response = await controller.conversationService.processMessage(
          conversation.id,
          message,
          jwtToken
        )
        
        reply.send({
          success: true,
          conversation_id: conversation.id,
          response: response
        })
      } catch (error) {
        reply.code(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }
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

  // Error streaming endpoint for Atlas service
  fastify.post('/api/v1/notifications/error', {
    handler: async (request, reply) => {
      try {
        const errorNotification = request.body as any
        
        // Process the error notification through the notification service
        controller.notificationService.sendErrorNotification(
          errorNotification,
          errorNotification.error?.context?.session_id
        )

        // Also emit WebSocket event for real-time user visibility
        const wsServer = (fastify as any).websocketServer
        if (wsServer && errorNotification.user_visible) {
          wsServer.clients.forEach((client: any) => {
            if (client.readyState === 1) {
              // Send to all active clients for now - could be improved with session filtering
              client.send(JSON.stringify({
                type: 'infrastructure_error',
                service: errorNotification.service,
                operation: errorNotification.error.operation,
                error_type: errorNotification.type,
                message: errorNotification.error.error?.userMessage || errorNotification.error.message,
                suggestions: errorNotification.error.suggestions || [],
                recovery_actions: errorNotification.recovery_suggestions || [],
                context: errorNotification.error.context,
                timestamp: errorNotification.error.timestamp
              }))
            }
          })
        }
        
        reply.send({ success: true, message: 'Error notification processed' })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        fastify.log.error(`Failed to process error notification: ${errorMessage}`)
        reply.code(500).send({ 
          success: false, 
          error: errorMessage
        })
      }
    }
  })

  // Register Watson MCP routes for orchestration tools
  await registerMCPRoutes(fastify, mcpHandler)

  // Register status routes for error monitoring and deployment health
  await statusRoutes(fastify, config)
  
  // Register validation routes for self-assessment
  await validationRoutes(fastify)
  
  // Register deployment routes for orchestrator API
  await deploymentRoutes(fastify, config)
  
  // Register unified deployment routes (CLI-microservices bridge)
  await unifiedDeploymentRoutes(fastify, config)

  if (config.enable_websockets) {
    await fastify.register(require('@fastify/websocket'))
    
    fastify.register(async function (fastify) {
      fastify.get('/ws', { websocket: true } as any, async (connection: any, request: any) => {
        // Validate JWT token on WebSocket connection
        try {
          const token = request.query?.token as string
          if (!token) {
            connection.socket.close(1008, 'Authentication required')
            return
          }
          
          // Verify the JWT token
          await fastify.jwt.verify(token)
          console.log('WebSocket connection authenticated successfully')
        } catch (error) {
          console.log('WebSocket authentication failed:', error)
          connection.socket.close(1008, 'Invalid token')
          return
        }

        connection.socket.on('message', async (message: any) => {
          try {
            console.log('WebSocket received message:', message.toString())
            const data = JSON.parse(message.toString())
            console.log('Parsed WebSocket data:', JSON.stringify(data))
            
            if (data.type === 'subscribe') {
              console.log('WebSocket subscribing to conversation:', data.conversation_id)
              ;(connection.socket as any).conversationId = data.conversation_id
            } else if (data.type === 'user_message') {
              // Send typing indicator
              connection.socket.send(JSON.stringify({
                type: 'typing_indicator',
                is_typing: true,
                agent: 'Victor',
                timestamp: new Date().toISOString()
              }))
              
              // Extract JWT token from WebSocket query parameters
              const token = request.query?.token as string
              
              let response
              try {
                response = await controller.conversationService.processMessage(
                  data.conversation_id,
                  data.content,
                  token
                )
              } catch (error) {
                // If conversation not found, create a new one and retry
                if (error instanceof Error && error.message.includes('not found')) {
                  console.log('Conversation not found, creating new conversation...')
                  
                  // Decode JWT to get user info
                  const tokenPayload = JSON.parse(atob(token.split('.')[1]))
                  const { user_id, workspace_id } = tokenPayload
                  
                  // Create new conversation
                  const newConversation = await controller.conversationService.createConversation(
                    workspace_id,
                    user_id
                  )
                  
                  console.log('Created new conversation:', newConversation.id)
                  
                  // Update the connection's conversation ID
                  ;(connection.socket as any).conversationId = newConversation.id
                  
                  // Retry with new conversation
                  response = await controller.conversationService.processMessage(
                    newConversation.id,
                    data.content,
                    token
                  )
                  
                  // Send conversation ID update to frontend
                  connection.socket.send(JSON.stringify({
                    type: 'conversation_created',
                    conversation_id: newConversation.id,
                    timestamp: new Date().toISOString()
                  }))
                } else {
                  throw error
                }
              }
              
              // Send AI response with deployment step metadata
              const aiResponse: any = {
                type: 'ai_response',
                content: response.message,
                conversation_id: data.conversation_id,
                intent: 'general',
                confidence: 0.9,
                agent: 'Victor',
                timestamp: new Date().toISOString()
              }
              
              // Add deployment steps metadata if this is a deployment-related response
              if (data.content && (
                data.content.toLowerCase().includes('deploy') || 
                data.content.toLowerCase().includes('provision') ||
                data.content.toLowerCase().includes('execute step')
              )) {
                // Check current deployment context to determine next steps
                if (data.content.toLowerCase().includes('analyze') || response.message.toLowerCase().includes('analyzed')) {
                  aiResponse.deployment_steps = [{
                    id: 'step-2',
                    name: 'Provision',
                    description: 'Create DigitalOcean droplet with specified configuration',
                    ready: true
                  }]
                } else if (data.content.toLowerCase().includes('provision') || response.message.toLowerCase().includes('provisioned')) {
                  // Only show next step if provisioning was successful
                  const provisioningSuccessful = !response.message.toLowerCase().includes('failed') && 
                    !response.message.toLowerCase().includes('error') &&
                    !response.message.toLowerCase().includes('issue') &&
                    response.message.toLowerCase().includes('successful')
                  
                  if (provisioningSuccessful) {
                    aiResponse.deployment_steps = [{
                      id: 'step-3', 
                      name: 'Configure DNS',
                      description: 'Set up domain and SSL certificates',
                      ready: true
                    }]
                  } else {
                    // Show retry or troubleshoot options for failed provisioning
                    aiResponse.deployment_steps = [{
                      id: 'step-2-retry',
                      name: 'Retry Provision',
                      description: 'Retry provisioning with corrected configuration',
                      ready: true
                    }]
                  }
                } else if (data.content.toLowerCase().includes('dns') || response.message.toLowerCase().includes('dns')) {
                  aiResponse.deployment_steps = [{
                    id: 'step-4',
                    name: 'Deploy App', 
                    description: 'Deploy application code to server',
                    ready: true
                  }]
                } else if (data.content.toLowerCase().includes('deploy') && !data.content.toLowerCase().includes('analyze')) {
                  // Generic deployment request - start with analyze
                  aiResponse.deployment_steps = [{
                    id: 'step-1',
                    name: 'Analyze Repo',
                    description: 'Analyze repository structure and requirements',
                    ready: true
                  }]
                }
              }
              
              connection.socket.send(JSON.stringify(aiResponse))
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
            } else if (data.type === 'ping') {
              // Respond to heartbeat ping with pong
              console.log('Received ping, sending pong')
              connection.socket.send(JSON.stringify({
                type: 'pong',
                timestamp: new Date().toISOString()
              }))
            }
          } catch (error) {
            fastify.log.error('WebSocket message processing error: ' + (error instanceof Error ? error.message : String(error)))
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

    controller.conversationService.on('typing_status', (data: any) => {
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'typing_indicator',
              is_typing: data.is_typing,
              agent: data.agent,
              operation: data.operation,
              conversation_id: data.conversation_id,
              timestamp: data.timestamp
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

    controller.conversationService.on('tool_error', (data: any) => {
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'tool_error',
              tool_name: data.tool_name,
              error: data.error,
              conversation_id: data.conversation_id,
              timestamp: data.timestamp
            }))
          }
        })
      }
    })

    controller.conversationService.on('tool_progress', (data: any) => {
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'tool_progress',
              tool_name: data.tool_name,
              status: data.status,
              step: data.step,
              result: data.result,
              conversation_id: data.conversation_id,
              timestamp: data.timestamp
            }))
          }
        })
      }
    })

    controller.conversationService.on('thinking_update', (data: any) => {
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'thinking_update',
              message: data.message,
              conversation_id: data.conversation_id,
              timestamp: data.timestamp
            }))
          }
        })
      }
    })

    controller.conversationService.on('agent_status', (data: any) => {
      console.log('[WebSocket] Received agent_status event for conversation:', data.conversation_id)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            console.log('[WebSocket] Sending agent_status to client for conversation:', data.conversation_id)
            client.send(JSON.stringify({
              type: 'agent_status',
              agent: data.agent,
              status: data.status,
              activity: data.activity,
              details: data.details,
              progress: data.progress,
              conversation_id: data.conversation_id,
              timestamp: data.timestamp
            }))
          }
        })
      }
    })

    controller.conversationService.on('step_completed', (data: any) => {
      console.log('[WebSocket] Step completed event:', data)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId) {
            console.log('[WebSocket] Sending step_completed to client')
            client.send(JSON.stringify({
              type: 'step_completed',
              step_id: data.step.id,
              step_name: data.step.action,
              plan_id: data.plan.id,
              result: data.result,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    controller.conversationService.on('step_failed', (data: any) => {
      console.log('[WebSocket] Step failed event:', data)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId) {
            console.log('[WebSocket] Sending step_failed to client')
            client.send(JSON.stringify({
              type: 'step_failed',
              step_id: data.step.id,
              step_name: data.step.action,
              plan_id: data.plan.id,
              error: data.error?.message || 'Unknown error',
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    // Error Recovery WebSocket Events
    controller.conversationService.on('recovery_started', (data: any) => {
      console.log('[WebSocket] Recovery started event:', data.recovery_id)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'recovery_started',
              recovery_id: data.recovery_id,
              provider: data.provider,
              operation: data.operation,
              status: data.status,
              message: data.message || '🔧 Starting intelligent error recovery...',
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    controller.conversationService.on('recovery_progress', (data: any) => {
      console.log('[WebSocket] Recovery progress event:', data.recovery_id)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'recovery_progress',
              recovery_id: data.recovery_id,
              status: data.status,
              message: data.message,
              step: data.step,
              total_steps: data.total_steps,
              attempt: data.attempt,
              details: data.details,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    controller.conversationService.on('recovery_success', (data: any) => {
      console.log('[WebSocket] Recovery success event:', data.recovery_id)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'recovery_success',
              recovery_id: data.recovery_id,
              message: data.message,
              result: data.result,
              attempts: data.attempts,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    controller.conversationService.on('recovery_escalated', (data: any) => {
      console.log('[WebSocket] Recovery escalated event:', data.recovery_id)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'recovery_escalated',
              recovery_id: data.recovery_id,
              message: data.message,
              attempts: data.attempts,
              duration: data.duration,
              suggestions: data.suggestions,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    // NEW EXECUTOR SERVICE EVENT HANDLERS

    controller.conversationService.on('execution_started', (data: any) => {
      console.log('[WebSocket] Execution started event:', data)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'execution_started',
              plan_id: data.plan_id,
              total_steps: data.total_steps,
              message: '🚀 Deployment execution started',
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    controller.conversationService.on('execution_step_started', (data: any) => {
      console.log('[WebSocket] Execution step started:', data)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'execution_step_started',
              plan_id: data.plan_id,
              step_id: data.step_id,
              step_name: data.step_name,
              message: `⏳ ${data.step_name}`,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    controller.conversationService.on('execution_step_completed', (data: any) => {
      console.log('[WebSocket] Execution step completed:', data)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'execution_step_completed',
              plan_id: data.plan_id,
              step_id: data.step_id,
              step_name: data.step_name,
              result: data.result,
              execution_time: data.execution_time,
              message: `✅ ${data.step_name} completed`,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    controller.conversationService.on('execution_step_failed', (data: any) => {
      console.log('[WebSocket] Execution step failed:', data)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            client.send(JSON.stringify({
              type: 'execution_step_failed',
              plan_id: data.plan_id,
              step_id: data.step_id,
              step_name: data.step_name,
              error: data.error,
              execution_time: data.execution_time,
              message: `❌ ${data.step_name} failed: ${data.error}`,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })

    controller.conversationService.on('execution_completed', (data: any) => {
      console.log('[WebSocket] Execution completed:', data)
      const wsServer = (fastify as any).websocketServer
      if (wsServer) {
        wsServer.clients.forEach((client: any) => {
          if (client.readyState === 1 && client.conversationId === data.conversation_id) {
            const message = data.status === 'completed' ? 
              '🎉 Deployment completed successfully!' : 
              '❌ Deployment failed'
            
            client.send(JSON.stringify({
              type: 'execution_completed',
              plan_id: data.plan_id,
              status: data.status,
              execution_time: data.execution_time,
              message: message,
              timestamp: new Date().toISOString()
            }))
          }
        })
      }
    })
  }
}