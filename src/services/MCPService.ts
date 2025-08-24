/**
 * MCP Service - Watson's Interface to MCP Tool Primitives
 * 
 * This service allows Watson to call MCP tools from Atlas and Context Manager
 * in a standardized way, transforming Watson into a pure inference loop agent.
 */

import axios from 'axios'
import { WatsonConfig } from '../types'

export interface MCPToolCall {
  name: string
  arguments: Record<string, any>
}

export interface MCPToolResult {
  success: boolean
  result?: any
  error?: string
  tool_name?: string
  execution_time?: string
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: any
}

export class MCPService {
  private config: WatsonConfig
  private atlasClient: any
  private contextClient: any

  constructor(config: WatsonConfig) {
    this.config = config
    
    // Create axios clients for MCP services
    this.atlasClient = axios.create({
      baseURL: `${config.atlas_url}/api/v1/mcp`,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    })

    this.contextClient = axios.create({
      baseURL: `${config.context_manager_url}/api/v1/mcp`,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  /**
   * Get available MCP tools from Atlas service
   */
  async getAtlasTools(): Promise<MCPTool[]> {
    try {
      const response = await this.atlasClient.get('/tools')
      return response.data.tools || []
    } catch (error) {
      console.error('[MCP] Failed to get Atlas tools:', error)
      return []
    }
  }

  /**
   * Get available MCP tools from Context Manager service
   */
  async getContextTools(): Promise<MCPTool[]> {
    try {
      const response = await this.contextClient.get('/tools')
      return response.data.tools || []
    } catch (error) {
      console.error('[MCP] Failed to get Context Manager tools:', error)
      return []
    }
  }

  /**
   * Call an Atlas MCP tool
   */
  async callAtlasTool(toolCall: MCPToolCall, jwtToken?: string): Promise<MCPToolResult> {
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      console.log(`[MCP] Calling Atlas tool: ${toolCall.name}`)
      const response = await this.atlasClient.post('/call', toolCall, { headers })
      
      return {
        success: response.data.success || false,
        result: response.data.result,
        error: response.data.error,
        tool_name: toolCall.name,
        execution_time: response.data.execution_time
      }
    } catch (error: any) {
      console.error(`[MCP] Atlas tool call failed:`, error.response?.data || error.message)
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Unknown error',
        tool_name: toolCall.name
      }
    }
  }

  /**
   * Call a Context Manager MCP tool
   */
  async callContextTool(toolCall: MCPToolCall, jwtToken?: string): Promise<MCPToolResult> {
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      console.log(`[MCP] Calling Context Manager tool: ${toolCall.name}`)
      const response = await this.contextClient.post('/call', toolCall, { headers })
      
      return {
        success: response.data.success || false,
        result: response.data.result,
        error: response.data.error,
        tool_name: toolCall.name,
        execution_time: response.data.execution_time
      }
    } catch (error: any) {
      console.error(`[MCP] Context Manager tool call failed:`, error.response?.data || error.message)
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Unknown error',
        tool_name: toolCall.name
      }
    }
  }

  /**
   * Get current infrastructure using Atlas MCP tools
   */
  async getCurrentInfrastructure(workspaceId: string, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callAtlasTool({
      name: 'get_infrastructure_overview',
      arguments: { workspace_id: workspaceId }
    }, jwtToken)
  }

  /**
   * Get infrastructure costs using Atlas MCP tools
   */
  async getInfrastructureCosts(workspaceId: string, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callAtlasTool({
      name: 'get_cost_breakdown',
      arguments: { workspace_id: workspaceId }
    }, jwtToken)
  }

  /**
   * Get user context using Context Manager MCP tools
   */
  async getUserContext(workspaceId: string, userId: string, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callContextTool({
      name: 'get_user_context',
      arguments: { 
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Get community recommendations using Context Manager MCP tools
   */
  async getCommunityRecommendations(requirements: any): Promise<MCPToolResult> {
    return await this.callContextTool({
      name: 'get_recommended_stack',
      arguments: { requirements }
    })
  }

  /**
   * Get community patterns using Context Manager MCP tools
   */
  async getCommunityPatterns(filters: any = {}): Promise<MCPToolResult> {
    return await this.callContextTool({
      name: 'get_community_patterns',
      arguments: { filters }
    })
  }

  /**
   * Provision new infrastructure using Atlas MCP tools
   */
  async provisionInfrastructure(requirements: any, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callAtlasTool({
      name: 'provision_infrastructure',
      arguments: { requirements }
    }, jwtToken)
  }

  /**
   * Estimate infrastructure costs using Atlas MCP tools
   */
  async estimateInfrastructureCosts(requirements: any, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callAtlasTool({
      name: 'estimate_infrastructure_cost',
      arguments: { requirements }
    }, jwtToken)
  }

  /**
   * Scale infrastructure resources using Atlas MCP tools
   */
  async scaleInfrastructure(resourceType: string, scaleAction: any, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callAtlasTool({
      name: 'scale_infrastructure_resource',
      arguments: { resource_type: resourceType, scale_action: scaleAction }
    }, jwtToken)
  }

  /**
   * Destroy infrastructure using Atlas MCP tools
   */
  async destroyInfrastructure(resourceIds: string[], confirmation: boolean, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callAtlasTool({
      name: 'destroy_infrastructure',
      arguments: { resource_ids: resourceIds, confirmed: confirmation }
    }, jwtToken)
  }

  /**
   * Get provider status using Atlas MCP tools
   */
  async getProviderStatus(providers?: string[], jwtToken?: string): Promise<MCPToolResult> {
    return await this.callAtlasTool({
      name: 'get_provider_status',
      arguments: { providers: providers || [] }
    }, jwtToken)
  }

  /**
   * Get deployment patterns using Context Manager MCP tools
   */
  async getDeploymentPatterns(filters: any = {}, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callContextTool({
      name: 'search_deployment_patterns',
      arguments: { filters }
    }, jwtToken)
  }

  /**
   * Get recommended technology stack using Context Manager MCP tools
   */
  async getRecommendedStack(requirements: any, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callContextTool({
      name: 'get_recommended_stack',
      arguments: { requirements }
    }, jwtToken)
  }

  /**
   * Batch call multiple MCP tools across services
   */
  async batchCall(calls: Array<{ service: 'atlas' | 'context', toolCall: MCPToolCall }>, jwtToken?: string): Promise<MCPToolResult[]> {
    const promises = calls.map(async ({ service, toolCall }) => {
      if (service === 'atlas') {
        return await this.callAtlasTool(toolCall, jwtToken)
      } else {
        return await this.callContextTool(toolCall, jwtToken)
      }
    })

    return await Promise.all(promises)
  }
}