import { FastifyInstance } from 'fastify'
import { DeploymentOrchestrator } from '../services/DeploymentOrchestrator'
import { ErrorHandlingService } from '../services/ErrorHandlingService'
import { StatusMonitoringService } from '../services/StatusMonitoringService'
import { LLMService } from '../services/LLMService'
import { MCPService } from '../services/MCPService'
import { WatsonConfig } from '../types'

// Deployment Routes - Simple working version
export async function deploymentRoutes(fastify: FastifyInstance, config: WatsonConfig) {
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

  // Simple authentication middleware (lenient for testing)
  const authenticateDeployment = async (request: any, reply: any) => {
    try {
      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.status(401).send({
          success: false,
          error: 'Missing authorization header'
        })
        return
      }

      const token = authHeader.substring(7)
      request.jwtToken = token
      
      // Simple token validation - accept any non-empty token for testing
      if (!token || token.trim().length === 0) {
        reply.status(401).send({
          success: false,
          error: 'Empty authentication token'
        })
        return
      }
      
      // Token is valid, continue processing
    } catch (error) {
      reply.status(401).send({
        success: false,
        error: 'Authentication failed'
      })
    }
  }

  // Deploy RiskGuard application (without auth for testing)
  fastify.post('/api/v1/deploy/:appName', async (request: any, reply) => {
    try {
      const { appName } = request.params
      const { repository_url, domain, environment = 'production' } = request.body

      if (!repository_url) {
        return reply.status(400).send({
          success: false,
          error: 'Repository URL is required'
        })
      }

      // Create deployment request with proper types
      const deploymentRequest = {
        id: `${appName}-${Date.now()}`,
        conversationId: `conv-${Date.now()}`,
        workspaceId: 'default-workspace',
        userId: 'default-user',
        repositoryUrl: repository_url,
        domain: domain || `${appName}.controlvector.io`,
        jwtToken: 'test-token',
        intent: {
          name: 'deploy_application' as const,
          confidence: 0.95,
          parameters: { appName, environment }
        },
        requirements: [
          {
            type: 'technology_stack' as const,
            specification: { framework: 'react' },
            priority: 'required' as const,
            source: 'user_specified' as const
          },
          {
            type: 'compute_requirements' as const,
            specification: { cpu: 2, memory: '4GB', storage: '20GB' },
            priority: 'required' as const,
            source: 'inferred' as const
          },
          {
            type: 'network_requirements' as const,
            specification: { ssl: true, domain: domain || `${appName}.controlvector.io` },
            priority: 'required' as const,
            source: 'user_specified' as const
          }
        ]
      }
      
      const execution = await deploymentOrchestrator.executeDeployment(deploymentRequest)

      reply.send({
        success: true,
        deployment: {
          id: execution.id,
          name: appName,
          status: execution.status,
          progress: execution.progress,
          estimated_completion: execution.estimatedCompletion?.toISOString()
        }
      })
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message,
        details: error.context || {}
      })
    }
  })

  // Get deployment status (without auth for testing)
  fastify.get('/api/v1/deploy/:deploymentId/status', async (request: any, reply) => {
    try {
      const { deploymentId } = request.params
      const execution = await deploymentOrchestrator.getExecution(deploymentId)
      
      if (!execution) {
        return reply.status(404).send({
          success: false,
          error: 'Deployment not found'
        })
      }

      reply.send({
        success: true,
        deployment: {
          id: execution.id,
          status: execution.status,
          progress: execution.progress,
          current_step: execution.currentStep
        }
      })
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Get all deployments
  fastify.get('/api/v1/deployments', {
    preHandler: [authenticateDeployment]
  }, async (request: any, reply) => {
    try {
      const deployments = await deploymentOrchestrator.getAllExecutions()

      reply.send({
        success: true,
        deployments: deployments.map(d => ({
          id: d.id,
          status: d.status,
          progress: d.progress,
          started_at: d.startedAt.toISOString()
        }))
      })
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Cancel deployment
  fastify.post('/api/v1/deploy/:deploymentId/cancel', {
    preHandler: [authenticateDeployment]
  }, async (request: any, reply) => {
    try {
      const { deploymentId } = request.params
      const cancelled = await deploymentOrchestrator.cancelExecution(deploymentId)

      if (!cancelled) {
        return reply.status(404).send({
          success: false,
          error: 'Deployment not found or cannot be cancelled'
        })
      }

      reply.send({
        success: true,
        message: 'Deployment cancelled successfully'
      })
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })
}