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
  private neptuneClient: any
  private mercuryClient: any
  private hermesClient: any
  private phoenixClient: any

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

    this.neptuneClient = axios.create({
      baseURL: `${config.neptune_url || 'http://localhost:3006'}/api/v1/mcp`,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    })

    this.mercuryClient = axios.create({
      baseURL: `${config.mercury_url || 'http://localhost:3007'}/api/v1/mcp`,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    })

    this.hermesClient = axios.create({
      baseURL: `${config.hermes_url || 'http://localhost:3008'}/api/v1/mcp`,
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    })

    this.phoenixClient = axios.create({
      baseURL: `${config.phoenix_url || 'http://localhost:3009'}/api/v1/mcp`,
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
   * Get available MCP tools from Neptune DNS service
   */
  async getNeptuneTools(): Promise<MCPTool[]> {
    try {
      const response = await this.neptuneClient.get('/tools')
      return response.data.tools || []
    } catch (error) {
      console.error('[MCP] Failed to get Neptune tools:', error)
      return []
    }
  }

  /**
   * Get available MCP tools from Mercury repository analysis service
   */
  async getMercuryTools(): Promise<MCPTool[]> {
    try {
      const response = await this.mercuryClient.get('/tools')
      return response.data.tools || []
    } catch (error) {
      console.error('[MCP] Failed to get Mercury tools:', error)
      return []
    }
  }

  /**
   * Get available MCP tools from Hermes SSH key management service
   */
  async getHermesTools(): Promise<MCPTool[]> {
    try {
      const response = await this.hermesClient.get('/tools')
      return response.data.tools || []
    } catch (error) {
      console.error('[MCP] Failed to get Hermes tools:', error)
      return []
    }
  }

  /**
   * Get available MCP tools from Phoenix deployment execution service
   */
  async getPhoenixTools(): Promise<MCPTool[]> {
    try {
      const response = await this.phoenixClient.get('/tools')
      return response.data.tools || []
    } catch (error) {
      console.error('[MCP] Failed to get Phoenix tools:', error)
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
   * Call a Neptune DNS MCP tool
   */
  async callNeptuneTool(toolCall: MCPToolCall, jwtToken?: string): Promise<MCPToolResult> {
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      console.log(`[MCP] Calling Neptune DNS tool: ${toolCall.name}`)
      const response = await this.neptuneClient.post('/call', toolCall, { headers })
      
      return {
        success: response.data.success || false,
        result: response.data.result,
        error: response.data.error,
        tool_name: toolCall.name,
        execution_time: response.data.execution_time
      }
    } catch (error: any) {
      console.error(`[MCP] Neptune tool call failed:`, error.response?.data || error.message)
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Unknown error',
        tool_name: toolCall.name
      }
    }
  }

  /**
   * Call a Mercury repository analysis MCP tool
   */
  async callMercuryTool(toolCall: MCPToolCall, jwtToken?: string): Promise<MCPToolResult> {
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      console.log(`[MCP] Calling Mercury repository analysis tool: ${toolCall.name}`)
      const response = await this.mercuryClient.post('/call', toolCall, { headers })
      
      return {
        success: response.data.success || false,
        result: response.data.result,
        error: response.data.error,
        tool_name: toolCall.name,
        execution_time: response.data.execution_time
      }
    } catch (error: any) {
      console.error(`[MCP] Mercury tool call failed:`, error.response?.data || error.message)
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Unknown error',
        tool_name: toolCall.name
      }
    }
  }

  /**
   * Call a Hermes SSH key management MCP tool
   */
  async callHermesTool(toolCall: MCPToolCall, jwtToken?: string): Promise<MCPToolResult> {
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      console.log(`[MCP] Calling Hermes SSH management tool: ${toolCall.name}`)
      const response = await this.hermesClient.post('/call', toolCall, { headers })
      
      return {
        success: response.data.success || false,
        result: response.data.result,
        error: response.data.error,
        tool_name: toolCall.name,
        execution_time: response.data.execution_time
      }
    } catch (error: any) {
      console.error(`[MCP] Hermes tool call failed:`, error.response?.data || error.message)
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Unknown error',
        tool_name: toolCall.name
      }
    }
  }

  /**
   * Call a Phoenix deployment MCP tool
   */
  async callPhoenix(toolName: string, args: any, jwtToken?: string): Promise<MCPToolResult> {
    const toolCall: MCPToolCall = { name: toolName, arguments: args }
    
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      console.log(`[MCP] Calling Phoenix deployment tool: ${toolCall.name}`)
      const response = await this.phoenixClient.post('/call', toolCall, { headers })
      
      return {
        success: response.data.success || false,
        result: response.data.result,
        error: response.data.error,
        tool_name: toolCall.name,
        execution_time: response.data.execution_time
      }
    } catch (error: any) {
      console.error(`[MCP] Phoenix tool call failed:`, error.response?.data || error.message)
      return {
        success: false,
        error: error.response?.data?.message || error.message || 'Unknown error',
        tool_name: toolCall.name
      }
    }
  }

  /**
   * Call a Phoenix deployment MCP tool (standardized interface)
   */
  async callPhoenixTool(toolCall: MCPToolCall, jwtToken?: string): Promise<MCPToolResult> {
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      if (jwtToken) {
        headers.Authorization = `Bearer ${jwtToken}`
      }

      console.log(`[MCP] Calling Phoenix deployment tool: ${toolCall.name}`)
      const response = await this.phoenixClient.post('/call', toolCall, { headers })
      
      return {
        success: response.data.success || false,
        result: response.data.result,
        error: response.data.error,
        tool_name: toolCall.name,
        execution_time: response.data.execution_time
      }
    } catch (error: any) {
      console.error(`[MCP] Phoenix tool call failed:`, error.response?.data || error.message)
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
   * Create DNS record using Neptune MCP tools
   */
  async createDNSRecord(domain: string, recordType: string, name: string, content: string, provider: string, workspaceId: string, userId: string, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callNeptuneTool({
      name: 'neptune_create_dns_record',
      arguments: {
        domain,
        record_type: recordType,
        name,
        content,
        provider,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Verify DNS propagation using Neptune MCP tools
   */
  async verifyDNSPropagation(domain: string, recordType: string, expectedValue: string, workspaceId: string, userId: string, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callNeptuneTool({
      name: 'neptune_verify_dns_propagation',
      arguments: {
        domain,
        record_type: recordType,
        expected_value: expectedValue,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Analyze repository using Mercury MCP tools
   */
  async analyzeRepository(repositoryUrl: string, workspaceId: string, userId: string, jwtToken?: string, forceRefresh = false, deepAnalysis = true): Promise<MCPToolResult> {
    return await this.callMercuryTool({
      name: 'mercury_analyze_repository',
      arguments: {
        repository_url: repositoryUrl,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken,
        force_refresh: forceRefresh,
        deep_analysis: deepAnalysis
      }
    }, jwtToken)
  }

  /**
   * Generate deployment plan using Mercury MCP tools
   */
  async generateDeploymentPlan(repositoryUrl: string, workspaceId: string, userId: string, jwtToken?: string, options: any = {}): Promise<MCPToolResult> {
    return await this.callMercuryTool({
      name: 'mercury_generate_deployment_plan',
      arguments: {
        repository_url: repositoryUrl,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken,
        target_environment: options.environment || 'production',
        infrastructure_provider: options.provider || 'digitalocean',
        budget_limit: options.budgetLimit,
        performance_tier: options.performanceTier || 'standard'
      }
    }, jwtToken)
  }

  /**
   * Estimate deployment cost using Mercury MCP tools
   */
  async estimateRepositoryDeploymentCost(repositoryUrl: string, workspaceId: string, userId: string, jwtToken?: string, options: any = {}): Promise<MCPToolResult> {
    return await this.callMercuryTool({
      name: 'mercury_estimate_deployment_cost',
      arguments: {
        repository_url: repositoryUrl,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken,
        infrastructure_provider: options.provider || 'digitalocean',
        instance_type: options.instanceType,
        duration_months: options.durationMonths || 1
      }
    }, jwtToken)
  }

  /**
   * Detect security issues using Mercury MCP tools
   */
  async detectRepositorySecurityIssues(repositoryUrl: string, workspaceId: string, userId: string, jwtToken?: string, options: any = {}): Promise<MCPToolResult> {
    return await this.callMercuryTool({
      name: 'mercury_detect_security_issues',
      arguments: {
        repository_url: repositoryUrl,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken,
        include_dependencies: options.includeDependencies !== false,
        severity_threshold: options.severityThreshold || 'moderate'
      }
    }, jwtToken)
  }

  /**
   * Validate deployment configuration using Mercury MCP tools
   */
  async validateDeploymentConfiguration(repositoryUrl: string, deploymentConfig: any, workspaceId: string, userId: string, jwtToken?: string): Promise<MCPToolResult> {
    return await this.callMercuryTool({
      name: 'mercury_validate_deployment',
      arguments: {
        repository_url: repositoryUrl,
        deployment_config: deploymentConfig,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Generate SSH key using Hermes MCP tools
   */
  async generateSSHKey(name: string, keyType: string, workspaceId: string, userId: string, jwtToken?: string, options: any = {}): Promise<MCPToolResult> {
    return await this.callHermesTool({
      name: 'hermes_generate_ssh_key',
      arguments: {
        name,
        key_type: keyType,
        key_size: options.keySize,
        passphrase: options.passphrase,
        purpose: options.purpose || 'deployment',
        tags: options.tags || [],
        expires_in: options.expiresIn,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Deploy SSH key to servers using Hermes MCP tools
   */
  async deploySSHKey(keyId: string, serverTargets: any[], workspaceId: string, userId: string, jwtToken?: string, options: any = {}): Promise<MCPToolResult> {
    return await this.callHermesTool({
      name: 'hermes_deploy_ssh_key',
      arguments: {
        key_id: keyId,
        server_targets: serverTargets,
        deployment_method: options.method || 'authorized_keys',
        backup_existing: options.backupExisting !== false,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Establish SSH connection using Hermes MCP tools
   */
  async establishSSHConnection(keyId: string, host: string, username: string, workspaceId: string, userId: string, jwtToken?: string, options: any = {}): Promise<MCPToolResult> {
    return await this.callHermesTool({
      name: 'hermes_establish_ssh_connection',
      arguments: {
        key_id: keyId,
        host,
        port: options.port || 22,
        username,
        timeout: options.timeout || 10000,
        server_name: options.serverName,
        keep_alive: options.keepAlive !== false,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Execute SSH command using Hermes MCP tools
   */
  async executeSSHCommand(command: string, workspaceId: string, userId: string, jwtToken?: string, options: any = {}): Promise<MCPToolResult> {
    return await this.callHermesTool({
      name: 'hermes_execute_ssh_command',
      arguments: {
        connection_id: options.connectionId,
        key_id: options.keyId,
        host: options.host,
        command,
        working_directory: options.workingDirectory,
        timeout: options.timeout || 30000,
        environment: options.environment,
        sudo: options.sudo || false,
        stdin: options.stdin,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Audit SSH keys using Hermes MCP tools
   */
  async auditSSHKeys(workspaceId: string, userId: string, jwtToken?: string, options: any = {}): Promise<MCPToolResult> {
    return await this.callHermesTool({
      name: 'hermes_audit_ssh_keys',
      arguments: {
        key_ids: options.keyIds,
        include_servers: options.includeServers !== false,
        include_usage_stats: options.includeUsageStats !== false,
        check_compromised: options.checkCompromised !== false,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Rotate SSH key using Hermes MCP tools
   */
  async rotateSSHKey(keyId: string, workspaceId: string, userId: string, jwtToken?: string, options: any = {}): Promise<MCPToolResult> {
    return await this.callHermesTool({
      name: 'hermes_rotate_ssh_key',
      arguments: {
        key_id: keyId,
        new_key_name: options.newKeyName,
        maintain_old_key: options.maintainOldKey || false,
        rollback_period: options.rollbackPeriod || 7,
        auto_deploy: options.autoDeploy !== false,
        workspace_id: workspaceId,
        user_id: userId,
        jwt_token: jwtToken
      }
    }, jwtToken)
  }

  /**
   * Batch call multiple MCP tools across services
   */
  async batchCall(calls: Array<{ service: 'atlas' | 'context' | 'neptune' | 'mercury' | 'hermes', toolCall: MCPToolCall }>, jwtToken?: string): Promise<MCPToolResult[]> {
    const promises = calls.map(async ({ service, toolCall }) => {
      if (service === 'atlas') {
        return await this.callAtlasTool(toolCall, jwtToken)
      } else if (service === 'context') {
        return await this.callContextTool(toolCall, jwtToken)
      } else if (service === 'neptune') {
        return await this.callNeptuneTool(toolCall, jwtToken)
      } else if (service === 'mercury') {
        return await this.callMercuryTool(toolCall, jwtToken)
      } else {
        return await this.callHermesTool(toolCall, jwtToken)
      }
    })

    return await Promise.all(promises)
  }

  /**
   * Generic method to call Atlas tools by name (for backward compatibility)
   */
  async callAtlas(toolName: string, args: any, jwtToken?: string): Promise<MCPToolResult> {
    // Map prefixed tool names to actual Atlas MCP tool names
    const toolMapping: Record<string, string> = {
      'atlas_provision_infrastructure': 'provision_infrastructure',
      'atlas_get_infrastructure_overview': 'get_infrastructure_overview',
      'atlas_get_infrastructure_costs': 'get_infrastructure_costs',
      'atlas_estimate_infrastructure_cost': 'estimate_infrastructure_cost',
      'atlas_scale_infrastructure_resource': 'scale_infrastructure_resource',
      'atlas_get_provider_status': 'get_provider_status',
      'atlas_destroy_infrastructure': 'destroy_infrastructure'
    }

    const actualToolName = toolMapping[toolName] || toolName

    return await this.callAtlasTool({
      name: actualToolName,
      arguments: args
    }, jwtToken)
  }

  /**
   * Generic method to call Mercury tools by name (for backward compatibility)
   */
  async callMercury(toolName: string, args: any, jwtToken?: string): Promise<MCPToolResult> {
    const toolMapping: Record<string, string> = {
      'mercury_analyze_repository': 'mercury_analyze_repository'
    }

    const actualToolName = toolMapping[toolName] || toolName

    return await this.callMercuryTool({
      name: actualToolName,
      arguments: args
    }, jwtToken)
  }

  /**
   * Generic method to call Neptune tools by name (for backward compatibility)
   */
  async callNeptune(toolName: string, args: any, jwtToken?: string): Promise<MCPToolResult> {
    const toolMapping: Record<string, string> = {
      'neptune_create_dns_record': 'neptune_create_dns_record'
    }

    const actualToolName = toolMapping[toolName] || toolName

    return await this.callNeptuneTool({
      name: actualToolName,
      arguments: args
    }, jwtToken)
  }

  /**
   * Generic method to call Hermes tools by name (for backward compatibility)
   */
  async callHermes(toolName: string, args: any, jwtToken?: string): Promise<MCPToolResult> {
    const toolMapping: Record<string, string> = {
      'hermes_generate_ssh_key': 'hermes_generate_ssh_key'
    }

    const actualToolName = toolMapping[toolName] || toolName

    return await this.callHermesTool({
      name: actualToolName,
      arguments: args
    }, jwtToken)
  }

}