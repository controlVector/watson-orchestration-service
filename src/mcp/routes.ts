/**
 * Watson MCP Routes - HTTP endpoints for Watson's orchestration MCP tools
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { WatsonMCPHandler } from './handler'

interface MCPToolCallRequest {
  name: string
  arguments: Record<string, any>
}

export async function registerMCPRoutes(fastify: FastifyInstance, handler: WatsonMCPHandler) {
  
  /**
   * Get available Watson MCP tools
   */
  fastify.get('/api/v1/mcp/tools', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tools = handler.getTools()
      
      reply.code(200).send({
        success: true,
        tools: tools.map(tool => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema
        })),
        count: tools.length,
        service: 'Watson Orchestration Engine',
        mcp_version: '1.0.0'
      })
    } catch (error: any) {
      reply.code(500).send({
        success: false,
        error: error.message,
        service: 'Watson Orchestration Engine'
      })
    }
  })

  /**
   * Execute Watson MCP tool
   */
  fastify.post('/api/v1/mcp/call', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { name, arguments: args } = request.body as MCPToolCallRequest

      if (!name) {
        reply.code(400).send({
          success: false,
          error: 'Tool name is required'
        })
        return
      }

      console.log(`[Watson MCP] Executing tool: ${name}`)
      
      const result = await handler.handleToolCall(name, args)
      
      reply.code(200).send({
        success: result.success,
        result: result,
        tool_name: name,
        execution_time: result.execution_time
      })

    } catch (error: any) {
      console.error('[Watson MCP] Tool execution error:', error)
      reply.code(500).send({
        success: false,
        error: error.message,
        service: 'Watson Orchestration Engine'
      })
    }
  })

  /**
   * MCP service health check
   */
  fastify.get('/api/v1/mcp/health', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tools = handler.getTools()
      
      reply.code(200).send({
        status: 'healthy',
        service: 'Watson Orchestration Engine MCP',
        tools_available: tools.length,
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      })
    } catch (error: any) {
      reply.code(503).send({
        status: 'unhealthy',
        service: 'Watson Orchestration Engine MCP',
        error: error.message,
        timestamp: new Date().toISOString()
      })
    }
  })
}