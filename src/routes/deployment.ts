import { FastifyInstance } from 'fastify'
import { DeploymentOrchestrator } from '../services/DeploymentOrchestrator'
import { ErrorHandlingService } from '../services/ErrorHandlingService'
import { StatusMonitoringService } from '../services/StatusMonitoringService'
import { LLMService } from '../services/LLMService'
import { WatsonConfig } from '../types'

// Deployment Routes - Integrates with CLI POC error handling patterns
export async function deploymentRoutes(fastify: FastifyInstance, config: WatsonConfig) {
  const llmService = new LLMService()
  const errorHandlingService = new ErrorHandlingService(llmService)
  const statusMonitoringService = new StatusMonitoringService()
  const deploymentOrchestrator = new DeploymentOrchestrator(config, {
    errorHandlingService,
    statusMonitoringService
  })

  // Enhanced authentication for deployment routes
  const authenticateDeployment = async (request: any, reply: any) => {
    try {
      await fastify.authenticate(request, reply)
      const { workspaceId, userId } = request.user
      if (!workspaceId || !userId) {
        reply.status(401).send({
          success: false,
          error: 'Invalid user context'
        })
        return
      }
    } catch (error) {
      reply.status(401).send({
        success: false,
        error: 'Authentication failed'
      })
    }
  }

  // Deploy applications (ImageVoyage, 7Things, etc.)
  fastify.post('/api/v1/deploy/:appName', {
    preHandler: [authenticateDeployment]
  }, async (request: any, reply) => {
    try {
      const { appName } = request.params
      const { repository_url, domain, environment = 'production' } = request.body
      const { workspaceId, userId } = request.user

      if (!repository_url) {
        return reply.status(400).send({
          success: false,
          error: 'Repository URL is required'
        })
      }

      // Create deployment execution
      const execution = await deploymentOrchestrator.executeDeployment({
        deploymentId: `${appName}-${Date.now()}`,
        workspaceId,
        userId,
        repositoryUrl: repository_url,
        domain: domain || `${appName}.controlvector.io`,
        environment,
        requirements: {
          technology_stack: appName === 'imagevoyage' ? 'python_flask' : 'node_express',
          compute_requirements: { cpu: 2, memory: '4GB', storage: '20GB' },
          database_requirements: appName === 'imagevoyage' ? { type: 'postgresql', size: 'small' } : undefined,
          ssl_requirements: true,
          monitoring_requirements: { basic_health_checks: true, error_tracking: true }
        }
      })

      reply.send({
        success: true,
        deployment: {
          id: execution.id,
          name: appName,
          status: execution.status,
          progress: execution.progress,
          estimated_completion: execution.estimatedCompletionTime
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

  // Get deployment status with real-time updates
  fastify.get('/api/v1/deploy/:deploymentId/status', {
    preHandler: [authenticateDeployment]
  }, async (request: any, reply) => {
    try {
      const { deploymentId } = request.params
      const { workspaceId, userId } = request.user

      const execution = await deploymentOrchestrator.getDeploymentStatus(deploymentId)
      
      if (!execution) {
        return reply.status(404).send({
          success: false,
          error: 'Deployment not found'
        })
      }

      // Verify user access
      if (execution.workspaceId !== workspaceId || execution.userId !== userId) {
        return reply.status(403).send({
          success: false,
          error: 'Access denied'
        })
      }

      reply.send({
        success: true,
        deployment: {
          id: execution.id,
          status: execution.status,
          progress: execution.progress,
          current_step: execution.currentStepDescription,
          logs: execution.logs.slice(-10), // Last 10 log entries
          errors: execution.errors,
          estimated_completion: execution.estimatedCompletionTime,
          cost_estimate: execution.costEstimate
        }
      })
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Stream deployment logs via WebSocket
  fastify.get('/api/v1/deploy/:deploymentId/stream', {
    websocket: true,
    preHandler: [authenticateDeployment]
  }, async (connection: any, request: any) => {
    const { deploymentId } = request.params
    const { workspaceId, userId } = request.user

    try {
      // Verify deployment access
      const execution = await deploymentOrchestrator.getDeploymentStatus(deploymentId)
      if (!execution || execution.workspaceId !== workspaceId || execution.userId !== userId) {
        connection.close(1008, 'Access denied')
        return
      }

      // Send current status
      connection.send(JSON.stringify({
        type: 'deployment_status',
        data: {
          status: execution.status,
          progress: execution.progress,
          currentStep: execution.currentStepDescription
        },
        timestamp: new Date().toISOString()
      }))

      // Listen for deployment updates
      const handleProgress = (data: any) => {
        if (data.deploymentId === deploymentId) {
          connection.send(JSON.stringify({
            type: 'deployment_progress',
            data: data.progress,
            timestamp: new Date().toISOString()
          }))
        }
      }

      const handleLog = (data: any) => {
        if (data.deploymentId === deploymentId) {
          connection.send(JSON.stringify({
            type: 'deployment_log',
            data: data.log,
            timestamp: new Date().toISOString()
          }))
        }
      }

      const handleError = (data: any) => {
        if (data.deploymentId === deploymentId) {
          connection.send(JSON.stringify({
            type: 'deployment_error',
            data: {
              error: data.error,
              recovery_actions: data.recoveryActions || []
            },
            timestamp: new Date().toISOString()
          }))
        }
      }

      const handleComplete = (data: any) => {
        if (data.deploymentId === deploymentId) {
          connection.send(JSON.stringify({
            type: 'deployment_complete',
            data: {
              status: data.status,
              url: data.url,
              cost: data.finalCost,
              duration: data.duration
            },
            timestamp: new Date().toISOString()
          }))
        }
      }

      // Register event listeners
      deploymentOrchestrator.on('deployment_progress', handleProgress)
      deploymentOrchestrator.on('deployment_log', handleLog)
      deploymentOrchestrator.on('deployment_error', handleError)
      deploymentOrchestrator.on('deployment_complete', handleComplete)

      // Cleanup on disconnect
      connection.on('close', () => {
        deploymentOrchestrator.off('deployment_progress', handleProgress)
        deploymentOrchestrator.off('deployment_log', handleLog)
        deploymentOrchestrator.off('deployment_error', handleError)
        deploymentOrchestrator.off('deployment_complete', handleComplete)
      })

    } catch (error) {
      connection.close(1011, 'Internal server error')
    }
  })

  // Retry failed deployments with AI-powered recovery
  fastify.post('/api/v1/deploy/:deploymentId/retry', {
    preHandler: [authenticateDeployment]
  }, async (request: any, reply) => {
    try {
      const { deploymentId } = request.params
      const { workspaceId, userId } = request.user

      const execution = await deploymentOrchestrator.getDeploymentStatus(deploymentId)
      
      if (!execution) {
        return reply.status(404).send({
          success: false,
          error: 'Deployment not found'
        })
      }

      if (execution.workspaceId !== workspaceId || execution.userId !== userId) {
        return reply.status(403).send({
          success: false,
          error: 'Access denied'
        })
      }

      if (execution.status !== 'failed') {
        return reply.status(400).send({
          success: false,
          error: 'Can only retry failed deployments'
        })
      }

      // Trigger AI-powered retry
      const retryExecution = await deploymentOrchestrator.retryDeployment(deploymentId)

      reply.send({
        success: true,
        deployment: {
          id: retryExecution.id,
          status: retryExecution.status,
          progress: retryExecution.progress,
          recovery_strategy: retryExecution.recoveryStrategy,
          estimated_completion: retryExecution.estimatedCompletionTime
        }
      })
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Cancel running deployment
  fastify.delete('/api/v1/deploy/:deploymentId', {
    preHandler: [authenticateDeployment]
  }, async (request: any, reply) => {
    try {
      const { deploymentId } = request.params
      const { workspaceId, userId } = request.user

      const execution = await deploymentOrchestrator.getDeploymentStatus(deploymentId)
      
      if (!execution) {
        return reply.status(404).send({
          success: false,
          error: 'Deployment not found'
        })
      }

      if (execution.workspaceId !== workspaceId || execution.userId !== userId) {
        return reply.status(403).send({
          success: false,
          error: 'Access denied'
        })
      }

      if (!['running', 'pending'].includes(execution.status)) {
        return reply.status(400).send({
          success: false,
          error: 'Can only cancel running or pending deployments'
        })
      }

      await deploymentOrchestrator.cancelDeployment(deploymentId)

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

  // Get deployment history
  fastify.get('/api/v1/deployments', {
    preHandler: [authenticateDeployment]
  }, async (request: any, reply) => {
    try {
      const { workspaceId, userId } = request.user
      const deployments = await deploymentOrchestrator.getDeploymentHistory(workspaceId, userId)

      reply.send({
        success: true,
        deployments: deployments.map(d => ({
          id: d.id,
          name: d.name,
          status: d.status,
          created_at: d.createdAt,
          completed_at: d.completedAt,
          duration: d.duration,
          cost: d.finalCost,
          url: d.url,
          environment: d.environment
        })),
        total: deployments.length
      })
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Cost analysis and optimization
  fastify.get('/api/v1/deploy/:deploymentId/cost-analysis', {
    preHandler: [authenticateDeployment]
  }, async (request: any, reply) => {
    try {
      const { deploymentId } = request.params
      const { workspaceId, userId } = request.user

      const analysis = await deploymentOrchestrator.getCostAnalysis(deploymentId, workspaceId, userId)

      reply.send({
        success: true,
        cost_analysis: analysis
      })
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Performance metrics
  fastify.get('/api/v1/deploy/:deploymentId/metrics', {
    preHandler: [authenticateDeployment]
  }, async (request: any, reply) => {
    try {
      const { deploymentId } = request.params
      const { workspaceId, userId } = request.user

      const metrics = await deploymentOrchestrator.getPerformanceMetrics(deploymentId, workspaceId, userId)

      reply.send({
        success: true,
        metrics
      })
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })
}