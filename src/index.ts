import fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import jwt from '@fastify/jwt'
import dotenv from 'dotenv'
import { registerRoutes } from './routes'
import { WatsonConfig } from './types'

dotenv.config()

const config: WatsonConfig = {
  port: parseInt(process.env.PORT || '3004'),
  host: process.env.HOST || '0.0.0.0',
  log_level: process.env.LOG_LEVEL || 'info',
  
  context_manager_url: process.env.CONTEXT_MANAGER_URL || 'http://localhost:3002',
  atlas_url: process.env.ATLAS_URL || 'http://localhost:3003',
  neptune_url: process.env.NEPTUNE_URL || 'http://localhost:3006',
  mercury_url: process.env.MERCURY_URL || 'http://localhost:3007',
  hermes_url: process.env.HERMES_URL || 'http://localhost:3008',
  phoenix_url: process.env.PHOENIX_URL,
  sherlock_url: process.env.SHERLOCK_URL,
  
  openai_api_key: process.env.OPENAI_API_KEY,
  enable_ai_assistance: process.env.ENABLE_AI_ASSISTANCE === 'true',
  
  max_concurrent_workflows: parseInt(process.env.MAX_CONCURRENT_WORKFLOWS || '10'),
  workflow_timeout_minutes: parseInt(process.env.WORKFLOW_TIMEOUT_MINUTES || '30'),
  
  enable_websockets: process.env.ENABLE_WEBSOCKETS !== 'false',
  websocket_heartbeat_interval: parseInt(process.env.WEBSOCKET_HEARTBEAT_INTERVAL || '30000'),
  
  jwt_secret: process.env.JWT_SECRET || 'controlvector-auth-development-secret-key',
  enable_cors: process.env.ENABLE_CORS !== 'false',
  allowed_origins: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
}

const server = fastify({
  logger: {
    level: config.log_level
  }
})

async function start() {
  try {
    if (config.enable_cors) {
      await server.register(cors, {
        origin: config.allowed_origins,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization'],
        credentials: true
      })
    }

    await server.register(helmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
          connectSrc: ["'self'", "ws:", "wss:"]
        }
      }
    })

    await server.register(jwt, {
      secret: config.jwt_secret
    })

    server.addHook('preHandler', async (request, reply) => {
      const publicPaths = ['/health', '/ws', '/test']
      const publicPrefixes = ['/api/v1/deploy', '/api/v1/unified']
      const requestPath = request.routeOptions.url || ''
      
      if (publicPaths.includes(requestPath) || publicPrefixes.some(prefix => requestPath.startsWith(prefix))) {
        return
      }

      // Development mode: bypass JWT authentication
      if (process.env.NODE_ENV === 'development' && process.env.BYPASS_AUTH === 'true') {
        // Inject a default user for development
        (request as any).user = {
          user_id: 'dev-user-123',
          workspace_id: 'dev-workspace-456',
          email: 'dev@controlvector.io'
        }
        return
      }

      const authHeader = request.headers.authorization
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        reply.code(401).send({
          success: false,
          error: 'Authentication required'
        })
        return
      }

      try {
        const token = authHeader.substring(7)
        await server.jwt.verify(token)
      } catch (error) {
        reply.code(401).send({
          success: false,
          error: 'Invalid token'
        })
      }
    })

    await registerRoutes(server, config)

    const address = await server.listen({
      port: config.port,
      host: config.host
    })

    server.log.info(`Watson Orchestration Engine listening at ${address}`)
    server.log.info('Configuration:')
    server.log.info(`- Context Manager: ${config.context_manager_url}`)
    server.log.info(`- Atlas: ${config.atlas_url}`)
    server.log.info(`- WebSockets: ${config.enable_websockets ? 'enabled' : 'disabled'}`)
    server.log.info(`- AI Assistant: ${config.enable_ai_assistance ? 'enabled' : 'disabled'}`)
    server.log.info(`- Max Concurrent Workflows: ${config.max_concurrent_workflows}`)

  } catch (error) {
    server.log.error(error, 'Failed to start Watson server')
    process.exit(1)
  }
}

process.on('SIGINT', async () => {
  server.log.info('Received SIGINT, gracefully shutting down...')
  try {
    await server.close()
    process.exit(0)
  } catch (error) {
    server.log.error(error, 'Error during graceful shutdown')
    process.exit(1)
  }
})

process.on('SIGTERM', async () => {
  server.log.info('Received SIGTERM, gracefully shutting down...')
  try {
    await server.close()
    process.exit(0)
  } catch (error) {
    server.log.error(error, 'Error during graceful shutdown')
    process.exit(1)
  }
})

start()


