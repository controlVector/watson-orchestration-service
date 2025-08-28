/**
 * Unified Deployment Routes - Bridges CLI and Microservices
 * 
 * These routes provide the same deployment capabilities as the CLI
 * through the microservices API, using the unified deployment engine.
 */

import { FastifyInstance } from 'fastify'
import { WatsonConfig } from '../types'
import axios from 'axios'

export async function unifiedDeploymentRoutes(fastify: FastifyInstance, config: WatsonConfig) {
  
  // Deploy application using unified approach
  fastify.post('/api/v1/unified/deploy/:appName', async (request: any, reply) => {
    try {
      const { appName } = request.params
      const { repository_url, domain, branch = 'main', environment = 'production' } = request.body

      if (!repository_url || !domain) {
        return reply.status(400).send({
          success: false,
          error: 'repository_url and domain are required'
        })
      }

      const deploymentId = `${appName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      
      fastify.log.info(`Starting unified deployment: ${deploymentId}`)
      
      // Call Phoenix service to handle deployment
      const phoenixResponse = await axios.post(`${config.phoenix_url || 'http://localhost:3005'}/api/deploy`, {
        id: deploymentId,
        repositoryUrl: repository_url,
        domain,
        branch,
        environment,
        appName
      }, {
        timeout: 30000
      })

      reply.send({
        success: true,
        deployment: {
          id: deploymentId,
          name: appName,
          status: 'initializing',
          progress: 0,
          repository_url,
          domain,
          branch,
          environment,
          phoenix_response: phoenixResponse.data
        }
      })
      
    } catch (error: any) {
      fastify.log.error(`Unified deployment failed: ${error.message}`)
      reply.status(500).send({
        success: false,
        error: error.message,
        details: error.response?.data || {}
      })
    }
  })

  // Get unified deployment status
  fastify.get('/api/v1/unified/deploy/:deploymentId/status', async (request: any, reply) => {
    try {
      const { deploymentId } = request.params
      
      // Query Phoenix for deployment status
      const phoenixResponse = await axios.get(
        `${config.phoenix_url || 'http://localhost:3005'}/api/deploy/${deploymentId}/status`,
        { timeout: 10000 }
      )

      reply.send({
        success: true,
        deployment: phoenixResponse.data
      })
      
    } catch (error: any) {
      fastify.log.error(`Failed to get deployment status: ${error.message}`)
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Generate deployment scripts (demonstrates code generation capability)
  fastify.post('/api/v1/unified/generate-scripts', async (request: any, reply) => {
    try {
      const { repository_url, domain } = request.body

      if (!repository_url || !domain) {
        return reply.status(400).send({
          success: false,
          error: 'repository_url and domain are required'
        })
      }

      // Call Phoenix to generate scripts
      const phoenixResponse = await axios.post(
        `${config.phoenix_url || 'http://localhost:3005'}/api/generate-scripts`,
        { repository_url, domain },
        { timeout: 15000 }
      )

      reply.send({
        success: true,
        scripts: phoenixResponse.data.scripts,
        analysis: phoenixResponse.data.analysis,
        message: 'Deployment scripts generated successfully'
      })
      
    } catch (error: any) {
      fastify.log.error(`Script generation failed: ${error.message}`)
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Complete RiskGuard deployment (specific endpoint for our case study)
  fastify.post('/api/v1/unified/complete-riskguard', async (request: any, reply) => {
    try {
      const { server_ip = '167.71.85.230', domain = 'riskguard.controlvector.io' } = request.body
      const deploymentId = `riskguard-complete-${Date.now()}`
      
      fastify.log.info(`Completing RiskGuard deployment on ${server_ip}`)
      
      // Generate RiskGuard-specific scripts
      const scriptsResponse = await axios.post(
        `${config.phoenix_url || 'http://localhost:3005'}/api/generate-scripts`,
        { 
          repository_url: 'https://github.com/hulljs/RiskGuard.git',
          domain 
        },
        { timeout: 10000 }
      )

      // Execute deployment on server
      const executionResponse = await axios.post(
        `${config.phoenix_url || 'http://localhost:3005'}/api/execute-scripts`,
        {
          server_ip,
          scripts: scriptsResponse.data.scripts,
          deployment_id: deploymentId
        },
        { timeout: 300000 } // 5 minutes for script execution
      )

      reply.send({
        success: true,
        deployment: {
          id: deploymentId,
          name: 'riskguard',
          status: executionResponse.data.success ? 'completed' : 'failed',
          progress: 100,
          server_ip,
          domain,
          deployment_url: `http://${server_ip}`,
          scripts_generated: Object.keys(scriptsResponse.data.scripts),
          execution_logs: executionResponse.data.logs
        }
      })
      
    } catch (error: any) {
      fastify.log.error(`RiskGuard completion failed: ${error.message}`)
      reply.status(500).send({
        success: false,
        error: error.message,
        details: error.response?.data || {}
      })
    }
  })

  // List all deployments with unified status
  fastify.get('/api/v1/unified/deployments', async (request: any, reply) => {
    try {
      const phoenixResponse = await axios.get(
        `${config.phoenix_url || 'http://localhost:3005'}/api/deployments`,
        { timeout: 10000 }
      )

      reply.send({
        success: true,
        deployments: phoenixResponse.data.deployments || [],
        source: 'unified-engine'
      })
      
    } catch (error: any) {
      fastify.log.error(`Failed to list deployments: ${error.message}`)
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })

  // Health check for unified deployment system
  fastify.get('/api/v1/unified/health', async (request: any, reply) => {
    try {
      const checks = {
        watson: 'healthy',
        phoenix: 'unknown',
        atlas: 'unknown',
        neptune: 'unknown'
      }

      // Check Phoenix service
      try {
        await axios.get(`${config.phoenix_url || 'http://localhost:3005'}/health`, { timeout: 5000 })
        checks.phoenix = 'healthy'
      } catch {
        checks.phoenix = 'unhealthy'
      }

      // Check Atlas service
      try {
        await axios.get(`${config.atlas_url || 'http://localhost:3003'}/health`, { timeout: 5000 })
        checks.atlas = 'healthy'
      } catch {
        checks.atlas = 'unhealthy'
      }

      // Check Neptune service
      try {
        await axios.get(`${config.neptune_url || 'http://localhost:3006'}/health`, { timeout: 5000 })
        checks.neptune = 'healthy'
      } catch {
        checks.neptune = 'unhealthy'
      }

      const allHealthy = Object.values(checks).every(status => status === 'healthy')

      reply.send({
        success: true,
        status: allHealthy ? 'healthy' : 'degraded',
        services: checks,
        capabilities: {
          code_generation: checks.phoenix === 'healthy',
          infrastructure_provisioning: checks.atlas === 'healthy',
          dns_management: checks.neptune === 'healthy',
          unified_deployments: allHealthy
        },
        timestamp: new Date().toISOString()
      })
      
    } catch (error: any) {
      reply.status(500).send({
        success: false,
        error: error.message
      })
    }
  })
}