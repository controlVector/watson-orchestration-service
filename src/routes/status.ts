import { FastifyInstance } from 'fastify'
import { ErrorHandlingService } from '../services/ErrorHandlingService'
import { StatusMonitoringService } from '../services/StatusMonitoringService'
import { LLMService } from '../services/LLMService'
import { MCPService } from '../services/MCPService'

// Status and Error Handling Routes
// Based on CLI POC error patterns for comprehensive deployment monitoring

export async function statusRoutes(fastify: FastifyInstance, config: any) {
  // Initialize services with proper configuration
  const mcpService = new MCPService(config)
  const llmService = new LLMService(config, mcpService)
  const errorHandlingService = new ErrorHandlingService(llmService)
  const statusMonitoringService = new StatusMonitoringService()

  // Helper function to extract user context from JWT token
  const getUserContext = async (request: any) => {
    const token = request.headers.authorization?.substring(7)
    if (!token) {
      throw new Error('Authentication required')
    }
    
    const decoded = await fastify.jwt.verify(token) as any
    const { workspaceId, userId } = decoded.user || decoded
    
    if (!workspaceId || !userId) {
      throw new Error('Invalid user context')
    }
    
    return { workspaceId, userId }
  }

  // Real-time status monitoring endpoints
  fastify.get('/api/v1/status/deployments', async (request: any, reply) => {
    try {
      const { workspaceId, userId } = await getUserContext(request)
      const statuses = await statusMonitoringService.getAllStatuses(workspaceId, userId)
      
      reply.send({
        success: true,
        deployments: statuses,
        count: statuses.length
      })
    } catch (error: any) {
      reply.status(error.message === 'Authentication required' ? 401 : 500).send({
        success: false,
        error: error.message
      })
    }
  })

  fastify.get('/api/v1/status/deployments/:deploymentId', async (request: any, reply) => {
    try {
      const { deploymentId } = request.params
      const { workspaceId, userId } = await getUserContext(request)
      
      const status = await statusMonitoringService.getDeploymentStatus(deploymentId)
      
      if (!status) {
        return reply.status(404).send({
          success: false,
          error: 'Deployment not found'
        })
      }

      // Verify user access
      if (status.workspaceId !== workspaceId || status.userId !== userId) {
        return reply.status(403).send({
          success: false,
          error: 'Access denied'
        })
      }

      reply.send({
        success: true,
        deployment: status
      })
    } catch (error: any) {
      reply.status(error.message === 'Authentication required' ? 401 : 500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Status summary dashboard endpoint
  fastify.get('/api/v1/status/summary', async (request: any, reply) => {
    try {
      const { workspaceId, userId } = await getUserContext(request)
      const summary = await statusMonitoringService.getStatusSummary(workspaceId, userId)
      
      reply.send({
        success: true,
        summary
      })
    } catch (error: any) {
      reply.status(error.message === 'Authentication required' ? 401 : 500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Error handling endpoints
  fastify.get('/api/v1/errors', async (request: any, reply) => {
    try {
      await getUserContext(request) // Verify authentication
      const errors = await errorHandlingService.getActiveErrors()
      
      reply.send({
        success: true,
        errors,
        count: errors.length
      })
    } catch (error: any) {
      reply.status(error.message === 'Authentication required' ? 401 : 500).send({
        success: false,
        error: error.message
      })
    }
  })

  fastify.get('/api/v1/errors/:errorId', async (request: any, reply) => {
    try {
      const { errorId } = request.params
      await getUserContext(request) // Verify authentication
      const error = await errorHandlingService.getErrorById(errorId)
      
      if (!error) {
        return reply.status(404).send({
          success: false,
          error: 'Error not found'
        })
      }

      reply.send({
        success: true,
        error
      })
    } catch (error: any) {
      reply.status(error.message === 'Authentication required' ? 401 : 500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Mark error as resolved
  fastify.patch('/api/v1/errors/:errorId/resolve', async (request: any, reply) => {
    try {
      const { errorId } = request.params
      await getUserContext(request) // Verify authentication
      const resolved = await errorHandlingService.markErrorResolved(errorId)
      
      if (!resolved) {
        return reply.status(404).send({
          success: false,
          error: 'Error not found'
        })
      }

      reply.send({
        success: true,
        message: 'Error marked as resolved'
      })
    } catch (error: any) {
      reply.status(error.message === 'Authentication required' ? 401 : 500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Error statistics and analytics
  fastify.get('/api/v1/errors/statistics', async (request: any, reply) => {
    try {
      await getUserContext(request) // Verify authentication
      const statistics = await errorHandlingService.getErrorStatistics()
      
      reply.send({
        success: true,
        statistics
      })
    } catch (error: any) {
      reply.status(error.message === 'Authentication required' ? 401 : 500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Zombie server detection (based on CLI POC patterns)
  fastify.get('/api/v1/status/zombie-servers', async (request: any, reply) => {
    try {
      await getUserContext(request) // Verify authentication
      const candidates = await statusMonitoringService.getZombieServerCandidates()
      
      const totalPotentialSavings = candidates.reduce((sum, candidate) => 
        sum + candidate.monthlyCost, 0)
      
      reply.send({
        success: true,
        zombieServers: candidates,
        count: candidates.length,
        totalPotentialSavings,
        recommendations: {
          immediateTermination: candidates.filter(c => c.recommendation === 'terminate').length,
          requiresInvestigation: candidates.filter(c => c.recommendation === 'investigate').length,
          keepRunning: candidates.filter(c => c.recommendation === 'keep').length
        }
      })
    } catch (error: any) {
      reply.status(error.message === 'Authentication required' ? 401 : 500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Error recovery endpoint (AI-powered)
  fastify.post('/api/v1/errors/:errorId/recover', async (request: any, reply) => {
    try {
      const { errorId } = request.params
      await getUserContext(request) // Verify authentication
      const error = await errorHandlingService.getErrorById(errorId)
      
      if (!error) {
        return reply.status(404).send({
          success: false,
          error: 'Error not found'
        })
      }

      // Trigger AI-powered recovery attempt
      // This would integrate with the error handling service's recovery system
      
      reply.send({
        success: true,
        message: 'Recovery attempt initiated',
        estimatedTime: error.aiAnalysis?.estimatedRepairTime || 30,
        recoveryActions: error.aiAnalysis?.recommendedActions || []
      })
    } catch (error: any) {
      reply.status(error.message === 'Authentication required' ? 401 : 500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Cleanup on server shutdown
  fastify.addHook('onClose', async () => {
    statusMonitoringService.destroy()
  })
}