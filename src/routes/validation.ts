import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { SelfAssessmentService, DeploymentTarget } from '../services/SelfAssessmentService'
import { z } from 'zod'

// Validation request schema
const ValidationRequestSchema = z.object({
  ip: z.string().ip(),
  domain: z.string().optional(),
  port: z.number().optional().default(80),
  expectedService: z.string(),
  dropletId: z.string().optional(),
  provider: z.string().optional().default('digitalocean')
})

export async function validationRoutes(fastify: FastifyInstance) {
  const assessmentService = new SelfAssessmentService(fastify.log)

  /**
   * POST /api/deployments/validate
   * Validate a deployment and get assessment report
   */
  fastify.post('/api/deployments/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ValidationRequestSchema.parse(request.body)
      
      fastify.log.info(`Validating deployment for ${body.ip}`)
      
      // Perform validation
      const validation = await assessmentService.validateDeployment(body as DeploymentTarget)
      
      // Log results
      fastify.log.info({
        msg: 'Deployment validation complete',
        deploymentId: validation.deploymentId,
        overallStatus: validation.overallStatus,
        score: validation.score
      })
      
      // Send WebSocket update if connection exists
      const wsConnections = (fastify as any).websocketConnections
      if (wsConnections) {
        const message = {
          type: 'deployment.validation',
          data: validation
        }
        
        // Broadcast to all connections
        wsConnections.forEach((ws: any) => {
          if (ws.readyState === 1) { // OPEN
            ws.send(JSON.stringify(message))
          }
        })
      }
      
      return reply.code(200).send({
        success: true,
        validation
      })
      
    } catch (error: any) {
      fastify.log.error({
        msg: 'Deployment validation failed',
        error: error.message,
        stack: error.stack
      })
      
      return reply.code(400).send({
        success: false,
        error: error.message
      })
    }
  })

  /**
   * POST /api/deployments/validate-and-fix
   * Validate deployment and attempt automated fixes
   */
  fastify.post('/api/deployments/validate-and-fix', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const body = ValidationRequestSchema.parse(request.body)
      
      fastify.log.info(`Validating and attempting fixes for ${body.ip}`)
      
      // First validate
      const validation = await assessmentService.validateDeployment(body as DeploymentTarget)
      
      // If validation shows issues, attempt remediation
      let remediation = null
      if (validation.overallStatus !== 'success') {
        fastify.log.info('Attempting automated remediation...')
        remediation = await assessmentService.attemptRemediation(body as DeploymentTarget, validation)
      }
      
      return reply.code(200).send({
        success: true,
        validation,
        remediation
      })
      
    } catch (error: any) {
      fastify.log.error({
        msg: 'Validation and fix failed',
        error: error.message
      })
      
      return reply.code(400).send({
        success: false,
        error: error.message
      })
    }
  })

  /**
   * GET /api/deployments/:ip/validate
   * Quick validation check for a specific IP
   */
  fastify.get('/api/deployments/:ip/validate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { ip } = request.params as { ip: string }
      
      // Quick validation with minimal params
      const validation = await assessmentService.validateDeployment({
        ip,
        expectedService: 'unknown',
        port: 80
      })
      
      return reply.code(200).send({
        success: true,
        validation
      })
      
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        error: error.message
      })
    }
  })
}