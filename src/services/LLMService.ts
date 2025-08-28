/**
 * LLM Service - Multi-provider AI inference with MCP tool integration
 * 
 * This service enables Watson to use user credentials to call Claude, OpenAI, etc.
 * and provides MCP tools as function calls for true inference loop agent behavior.
 */

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { WatsonConfig } from '../types'
import { MCPService, MCPTool } from './MCPService'
import axios from 'axios'
import EventEmitter from 'eventemitter3'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: LLMToolCall[]
}

export interface LLMToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface LLMToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: any
  }
}

export interface LLMResponse {
  message: string
  tool_calls?: LLMToolCall[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

export interface UserLLMCredentials {
  anthropic_api_key?: string
  openai_api_key?: string
  preferred_provider?: 'anthropic' | 'openai'
}

export class LLMService extends EventEmitter {
  private config: WatsonConfig
  private mcpService: MCPService

  constructor(config: WatsonConfig, mcpService: MCPService) {
    super()
    this.config = config
    this.mcpService = mcpService
  }

  /**
   * Get user's LLM credentials from Context Manager
   */
  async getUserLLMCredentials(jwtToken?: string): Promise<UserLLMCredentials> {
    if (!jwtToken) {
      throw new Error('JWT token required to access user LLM credentials')
    }

    const credentials: UserLLMCredentials = {}

    try {
      // Try to get Anthropic key
      const anthropicResponse = await axios.get(
        `${this.config.context_manager_url}/api/v1/context/secret/credential/anthropic_api_key`,
        { headers: { Authorization: `Bearer ${jwtToken}` } }
      )
      if (anthropicResponse.data.success) {
        credentials.anthropic_api_key = anthropicResponse.data.data.value
      }
    } catch (error) {
      console.log('[LLM] Anthropic API key not found in user credentials')
    }

    try {
      // Try to get OpenAI key
      const openaiResponse = await axios.get(
        `${this.config.context_manager_url}/api/v1/context/secret/credential/openai_api_key`,
        { headers: { Authorization: `Bearer ${jwtToken}` } }
      )
      if (openaiResponse.data.success) {
        credentials.openai_api_key = openaiResponse.data.data.value
      }
    } catch (error) {
      console.log('[LLM] OpenAI API key not found in user credentials')
    }

    // Determine preferred provider based on available credentials
    if (credentials.anthropic_api_key) {
      credentials.preferred_provider = 'anthropic'
    } else if (credentials.openai_api_key) {
      credentials.preferred_provider = 'openai'
    }

    return credentials
  }

  /**
   * Get all available MCP tools formatted as LLM function definitions
   */
  async getMCPToolDefinitions(): Promise<LLMToolDefinition[]> {
    const tools: LLMToolDefinition[] = []

    // Get Atlas tools
    try {
      const atlasTools = await this.mcpService.getAtlasTools()
      for (const tool of atlasTools) {
        tools.push({
          type: 'function',
          function: {
            name: `atlas_${tool.name}`,
            description: `[Atlas] ${tool.description}`,
            parameters: tool.inputSchema
          }
        })
      }
    } catch (error) {
      console.error('[LLM] Failed to get Atlas tools:', error)
    }

    // Get Context Manager tools
    try {
      const contextTools = await this.mcpService.getContextTools()
      for (const tool of contextTools) {
        tools.push({
          type: 'function',
          function: {
            name: `context_${tool.name}`,
            description: `[Context Manager] ${tool.description}`,
            parameters: tool.inputSchema
          }
        })
      }
    } catch (error) {
      console.error('[LLM] Failed to get Context Manager tools:', error)
    }

    // Get Mercury repository analysis tools
    try {
      const mercuryTools = await this.mcpService.getMercuryTools()
      for (const tool of mercuryTools) {
        tools.push({
          type: 'function',
          function: {
            name: tool.name, // Use tool name directly (already has mercury_ prefix)
            description: `[Mercury] ${tool.description}`,
            parameters: tool.inputSchema
          }
        })
      }
    } catch (error) {
      console.error('[LLM] Failed to get Mercury tools:', error)
    }

    // Get Neptune DNS management tools
    try {
      const neptuneTools = await this.mcpService.getNeptuneTools()
      for (const tool of neptuneTools) {
        tools.push({
          type: 'function',
          function: {
            name: tool.name, // Use tool name directly (already has neptune_ prefix)
            description: `[Neptune] ${tool.description}`,
            parameters: tool.inputSchema
          }
        })
      }
    } catch (error) {
      console.error('[LLM] Failed to get Neptune tools:', error)
    }

    // Get Hermes SSH management tools
    try {
      const hermesTools = await this.mcpService.getHermesTools()
      for (const tool of hermesTools) {
        tools.push({
          type: 'function',
          function: {
            name: tool.name, // Use tool name directly (already has hermes_ prefix)
            description: `[Hermes] ${tool.description}`,
            parameters: tool.inputSchema
          }
        })
      }
    } catch (error) {
      console.error('[LLM] Failed to get Hermes tools:', error)
    }

    // Get Phoenix deployment execution tools
    try {
      const phoenixTools = await this.mcpService.getPhoenixTools()
      for (const tool of phoenixTools) {
        tools.push({
          type: 'function',
          function: {
            name: tool.name, // Use tool name directly (already has phoenix_ prefix)
            description: `[Phoenix] ${tool.description}`,
            parameters: tool.inputSchema
          }
        })
      }
    } catch (error) {
      console.error('[LLM] Failed to get Phoenix tools:', error)
    }

    return tools
  }

  /**
   * Main inference method - chat with LLM using user's credentials and MCP tools
   */
  async chat(
    messages: LLMMessage[],
    jwtToken?: string,
    workspaceId?: string,
    conversationId?: string
  ): Promise<LLMResponse> {
    const credentials = await this.getUserLLMCredentials(jwtToken)
    
    if (!credentials.preferred_provider) {
      throw new Error('No LLM credentials available. Please configure your API keys in settings.')
    }

    const tools = await this.getMCPToolDefinitions()
    
    console.log(`[LLM] Using ${credentials.preferred_provider} with ${tools.length} MCP tools available`)

    if (credentials.preferred_provider === 'anthropic' && credentials.anthropic_api_key) {
      return await this.chatWithClaude(messages, credentials.anthropic_api_key, tools, jwtToken, workspaceId, conversationId)
    } else if (credentials.preferred_provider === 'openai' && credentials.openai_api_key) {
      return await this.chatWithOpenAI(messages, credentials.openai_api_key, tools, jwtToken, workspaceId, conversationId)
    } else {
      throw new Error('No valid LLM credentials available')
    }
  }

  /**
   * Chat with Claude using Anthropic API
   */
  private async chatWithClaude(
    messages: LLMMessage[], 
    apiKey: string, 
    tools: LLMToolDefinition[],
    jwtToken?: string,
    workspaceId?: string,
    conversationId?: string
  ): Promise<LLMResponse> {
    const anthropic = new Anthropic({ apiKey })

    // Convert messages to Claude format - use comprehensive system prompt
    const systemMessage = messages.find(m => m.role === 'system')?.content || 
      this.createSystemMessage(workspaceId)
    
    const chatMessages = messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'tool' ? 'user' : m.role as 'user' | 'assistant',
        content: m.role === 'tool' ? `Tool result: ${m.content}` : m.content
      }))

    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 4000,
        system: systemMessage,
        messages: chatMessages,
        tools: tools.map(tool => ({
          name: tool.function.name,
          description: tool.function.description,
          input_schema: {
            type: 'object',
            ...tool.function.parameters
          }
        }))
      })

      // Handle tool calls
      if (response.content.some(c => c.type === 'tool_use')) {
        const toolCalls: LLMToolCall[] = []
        let responseText = ''

        for (const contentBlock of response.content) {
          if (contentBlock.type === 'text') {
            responseText += contentBlock.text
          } else if (contentBlock.type === 'tool_use') {
            toolCalls.push({
              id: contentBlock.id,
              type: 'function',
              function: {
                name: contentBlock.name,
                arguments: JSON.stringify(contentBlock.input)
              }
            })
          }
        }

        // Execute tool calls with progress indicators
        console.log(`[LLM] About to execute ${toolCalls.length} tool calls:`, JSON.stringify(toolCalls.map(tc => ({name: tc.function.name, args: JSON.parse(tc.function.arguments)})), null, 2))
        
        // Send detailed agent status before tool execution
        if (conversationId) {
          console.log(`[LLM] Emitting agent_status for conversation: ${conversationId}`)
          this.emit('agent_status', {
            conversation_id: conversationId,
            agent: 'Victor',
            status: 'executing_tools',
            activity: `Executing ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}`,
            details: toolCalls.map(tc => ({
              tool: tc.function.name,
              status: 'starting',
              args: JSON.parse(tc.function.arguments || '{}')
            })),
            progress: {
              current: 0,
              total: toolCalls.length,
              percentage: 0
            },
            timestamp: new Date().toISOString()
          })
          
          // Legacy thinking indicator for compatibility
          this.emit('thinking_update', {
            conversation_id: conversationId,
            message: `Executing ${toolCalls.length} tool${toolCalls.length > 1 ? 's' : ''}: ${toolCalls.map(tc => tc.function.name).join(', ')}...`,
            timestamp: new Date().toISOString()
          })
        }
        
        const toolResults = await this.executeMCPToolCalls(toolCalls, jwtToken, workspaceId, conversationId)
        console.log(`[LLM] Tool execution completed. Results:`, JSON.stringify(toolResults, null, 2))
        console.log(`[LLM] Tool result summary:`, toolResults.map(r => ({success: r.success, tool: r.tool_name, error: r.error})))
        
        // Send detailed completion status
        if (conversationId) {
          const successCount = toolResults.filter(r => r.success).length
          const errorCount = toolResults.filter(r => !r.success).length
          
          this.emit('agent_status', {
            conversation_id: conversationId,
            agent: 'Victor',
            status: 'processing_results',
            activity: 'Analyzing tool results and generating response',
            details: toolResults.map((result, index) => ({
              tool: toolCalls[index].function.name,
              status: result.success ? 'completed' : 'failed',
              result: result.success ? 'Success' : result.error,
              execution_time: result.execution_time
            })),
            progress: {
              current: toolCalls.length,
              total: toolCalls.length,
              percentage: 100
            },
            timestamp: new Date().toISOString()
          })
          
          // Legacy thinking indicator for compatibility
          this.emit('thinking_update', {
            conversation_id: conversationId,
            message: `Tool execution complete: ${successCount} successful, ${errorCount} failed. Processing results...`,
            timestamp: new Date().toISOString()
          })
        }
        
        // Add tool results to messages and get final response
        const finalMessages = [...chatMessages, {
          role: 'assistant' as const,
          content: responseText
        }]
        
        // Add tool results with better formatting and proper status validation
        for (let i = 0; i < toolResults.length; i++) {
          const toolName = toolCalls[i].function.name
          const result = toolResults[i]
          
          let formattedResult = ''
          
          // Determine actual operation success by checking both API success and operation status
          let operationSuccessful = result.success
          let operationStatus = 'unknown'
          let errorDetails = result.error || ''
          
          // For Atlas tools, check the actual operation status inside result data
          if (toolName.startsWith('atlas_') && result.result) {
            try {
              const atlasResult = typeof result.result === 'string' ? JSON.parse(result.result) : result.result
              
              // Check for infrastructure creation status
              if (atlasResult.infrastructure?.status) {
                operationStatus = atlasResult.infrastructure.status
                operationSuccessful = operationSuccessful && (atlasResult.infrastructure.status !== 'failed')
              }
              
              // Check for operation status
              if (atlasResult.operation?.status) {
                operationStatus = atlasResult.operation.status
                operationSuccessful = operationSuccessful && (atlasResult.operation.status !== 'failed')
              }
              
              // Check for direct status field
              if (atlasResult.status) {
                operationStatus = atlasResult.status
                operationSuccessful = operationSuccessful && (atlasResult.status !== 'failed')
              }
              
              // Additional validation for Atlas provisioning
              if (toolName.includes('provision') && atlasResult.infrastructure?.estimated_monthly_cost === 0) {
                operationSuccessful = false
                errorDetails = 'Infrastructure provisioning failed - no cost estimate generated'
              }
            } catch (error) {
              console.error('[LLM] Failed to parse Atlas result for status validation:', error)
            }
          }
          
          if (operationSuccessful) {
            formattedResult = `✅ TOOL EXECUTION SUCCESSFUL: ${toolName}\n`
            formattedResult += `Execution Time: ${result.execution_time || 'N/A'}\n`
            if (operationStatus !== 'unknown') {
              formattedResult += `Operation Status: ${operationStatus}\n`
            }
            
            // Format specific tool results for better LLM understanding
            if (result.key) {
              formattedResult += `SSH Key Generated:\n- ID: ${result.key.id}\n- Name: ${result.key.name}\n- Type: ${result.key.key_type}\n- Fingerprint: ${result.key.fingerprint}\n`
            }
            if (result.connection) {
              formattedResult += `SSH Connection Established:\n- Host: ${result.connection.host}:${result.connection.port}\n- Status: ${result.connection.status}\n`
            }
            if (result.result?.stdout) {
              formattedResult += `Command Output:\n${result.result.stdout}\n`
            }
            if (result.deployment) {
              formattedResult += `Deployment Results:\n- Total: ${result.deployment.summary?.total || 0}\n- Successful: ${result.deployment.summary?.successful || 0}\n- Failed: ${result.deployment.summary?.failed || 0}\n`
            }
            
            // Include full result data for LLM context
            formattedResult += `Raw Result: ${JSON.stringify(result.result || result, null, 2)}`
          } else {
            formattedResult = `❌ TOOL EXECUTION FAILED: ${toolName}\n`
            formattedResult += `Error: ${errorDetails || result.error || 'Unknown error'}\n`
            formattedResult += `Execution Time: ${result.execution_time || 'N/A'}\n`
            if (operationStatus !== 'unknown') {
              formattedResult += `Operation Status: ${operationStatus}\n`
            }
            formattedResult += `Raw Result: ${JSON.stringify(result.result || result, null, 2)}`
          }
          
          finalMessages.push({
            role: 'user' as const,
            content: formattedResult
          })
        }

        // Log formatted tool results that will be sent to LLM
        console.log(`[LLM] Formatted tool results being sent to LLM:`)
        finalMessages.slice(-toolResults.length).forEach((msg, i) => {
          console.log(`[LLM] Tool result ${i+1}:`, msg.content.substring(0, 500) + (msg.content.length > 500 ? '...' : ''))
        })

        // Get final response from Claude with enhanced instructions
        const enhancedSystemMessage = systemMessage + `

CRITICAL: You have just executed real infrastructure tools and received actual results. The user MUST see the concrete outcomes of these operations.

RESPONSE REQUIREMENTS:
1. ALWAYS acknowledge what tools were actually executed
2. SHOW the specific results (IDs, statuses, outputs) from the tool execution
3. If SSH keys were generated, provide the key details
4. If commands were executed, show the actual output
5. If deployments occurred, report the specific success/failure counts
6. Be specific about what infrastructure changes actually happened
7. Use the actual data from the tool results, not generic responses

The user specifically wants to see real execution results, not simulated text. Base your entire response on the actual tool execution data provided above.`

        console.log(`[LLM] Sending ${finalMessages.length} messages to LLM for final response`)
        const finalResponse = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          system: enhancedSystemMessage,
          messages: finalMessages
        })

        console.log(`[LLM] Final LLM response length: ${finalResponse.content.map(c => (c as any).text).join('').length} characters`)

        const finalText = finalResponse.content
          .filter(c => c.type === 'text')
          .map(c => (c as any).text)
          .join('')

        return {
          message: finalText,
          tool_calls: toolCalls,
          usage: {
            prompt_tokens: response.usage.input_tokens + (finalResponse.usage?.input_tokens || 0),
            completion_tokens: response.usage.output_tokens + (finalResponse.usage?.output_tokens || 0),
            total_tokens: response.usage.input_tokens + response.usage.output_tokens + 
                         (finalResponse.usage?.input_tokens || 0) + (finalResponse.usage?.output_tokens || 0)
          }
        }
      }

      // No tool calls, just return the response
      const responseText = response.content
        .filter(c => c.type === 'text')
        .map(c => (c as any).text)
        .join('')

      return {
        message: responseText,
        usage: {
          prompt_tokens: response.usage.input_tokens,
          completion_tokens: response.usage.output_tokens,
          total_tokens: response.usage.input_tokens + response.usage.output_tokens
        }
      }
    } catch (error: any) {
      console.error('[LLM] Claude API error:', error)
      
      // Preserve specific error details for better error handling
      if (error.error?.error?.message?.includes('credit balance is too low')) {
        throw new Error('Anthropic: Your credit balance is too low to access the Anthropic API')
      } else if (error.status === 401) {
        throw new Error('Anthropic: Invalid API key')
      } else if (error.status === 429) {
        throw new Error('Anthropic: Rate limit exceeded')
      }
      
      throw new Error(`Failed to get response from Claude: ${error.message || 'Unknown error'}`)
    }
  }

  /**
   * Chat with OpenAI GPT
   */
  private async chatWithOpenAI(
    messages: LLMMessage[], 
    apiKey: string, 
    tools: LLMToolDefinition[],
    jwtToken?: string,
    workspaceId?: string,
    conversationId?: string
  ): Promise<LLMResponse> {
    const openai = new OpenAI({ apiKey })

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: messages.map(m => {
          if (m.role === 'tool') {
            return {
              role: 'tool' as const,
              content: m.content,
              tool_call_id: m.tool_call_id!
            }
          }
          return {
            role: m.role as 'system' | 'user' | 'assistant',
            content: m.content,
            ...(m.tool_calls && { tool_calls: m.tool_calls as any })
          }
        }),
        tools: tools,
        tool_choice: 'auto'
      })

      const choice = response.choices[0]
      
      if (choice.message.tool_calls) {
        // Send thinking indicator before tool execution
        if (conversationId) {
          this.emit('thinking_update', {
            conversation_id: conversationId,
            message: `Executing ${choice.message.tool_calls.length} tool${choice.message.tool_calls.length > 1 ? 's' : ''}: ${choice.message.tool_calls.map(tc => tc.function.name).join(', ')}...`,
            timestamp: new Date().toISOString()
          })
        }
        
        // Execute tool calls
        const toolResults = await this.executeMCPToolCalls(choice.message.tool_calls, jwtToken, workspaceId, conversationId)
        
        // Send thinking indicator after tool execution
        if (conversationId) {
          const successCount = toolResults.filter(r => r.success).length
          const errorCount = toolResults.filter(r => !r.success).length
          this.emit('thinking_update', {
            conversation_id: conversationId,
            message: `Tool execution complete: ${successCount} successful, ${errorCount} failed. Processing results...`,
            timestamp: new Date().toISOString()
          })
        }
        
        // Add tool results and get final response
        const toolMessages: any[] = choice.message.tool_calls.map((call, index) => ({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(toolResults[index])
        }))

        const finalResponse = await openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            ...messages,
            {
              role: 'assistant',
              content: choice.message.content || '',
              tool_calls: choice.message.tool_calls
            },
            ...toolMessages
          ]
        })

        return {
          message: finalResponse.choices[0].message.content || '',
          tool_calls: choice.message.tool_calls,
          usage: {
            prompt_tokens: (response.usage?.prompt_tokens || 0) + (finalResponse.usage?.prompt_tokens || 0),
            completion_tokens: (response.usage?.completion_tokens || 0) + (finalResponse.usage?.completion_tokens || 0),
            total_tokens: (response.usage?.total_tokens || 0) + (finalResponse.usage?.total_tokens || 0)
          }
        }
      }

      return {
        message: choice.message.content || '',
        usage: {
          prompt_tokens: response.usage?.prompt_tokens || 0,
          completion_tokens: response.usage?.completion_tokens || 0,
          total_tokens: response.usage?.total_tokens || 0
        }
      }
    } catch (error: any) {
      console.error('[LLM] OpenAI API error:', error)
      
      // Preserve specific error details for better error handling
      if (error.message?.includes('insufficient_quota') || error.message?.includes('billing')) {
        throw new Error('OpenAI: Insufficient credits or quota exceeded')
      } else if (error.status === 401) {
        throw new Error('OpenAI: Invalid API key')
      } else if (error.status === 429) {
        throw new Error('OpenAI: Rate limit exceeded')
      }
      
      throw new Error(`Failed to get response from OpenAI: ${error.message || 'Unknown error'}`)
    }
  }

  /**
   * Execute MCP tool calls requested by the LLM
   */
  private async executeMCPToolCalls(
    toolCalls: LLMToolCall[], 
    jwtToken?: string, 
    workspaceId?: string,
    conversationId?: string
  ): Promise<any[]> {
    const results = []

    for (const toolCall of toolCalls) {
      try {
        const { name } = toolCall.function
        const args = JSON.parse(toolCall.function.arguments)

        console.log(`[LLM] Executing MCP tool: ${name}`, args)

        // Emit tool execution start event
        if (conversationId) {
          this.emit('tool_progress', {
            conversation_id: conversationId,
            tool_name: name,
            status: 'starting',
            step: this.getStepNameFromTool(name),
            timestamp: new Date().toISOString()
          })
        }

        if (name.startsWith('atlas_')) {
          const toolName = name.substring(6) // Remove 'atlas_' prefix
          
          // Auto-inject workspace_id, jwt_token, and user_id for tools that require it
          if (workspaceId && ['get_infrastructure_overview', 'get_infrastructure_costs', 'get_cost_breakdown', 'provision_infrastructure', 'scale_infrastructure_resource', 'destroy_infrastructure'].includes(toolName)) {
            args.workspace_id = workspaceId
            args.jwt_token = jwtToken
            
            // Extract user_id from JWT token
            if (jwtToken) {
              try {
                const payload = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64').toString())
                args.user_id = payload.user_id
              } catch (error) {
                console.error('[LLM] Failed to extract user_id from JWT:', error)
              }
            }
          }
          
          try {
            const result = await this.mcpService.callAtlasTool({ name: toolName, arguments: args }, jwtToken)
            results.push(result)
            
            // Emit success progress
            if (conversationId) {
              this.emit('tool_progress', {
                conversation_id: conversationId,
                tool_name: name,
                status: 'completed',
                step: this.getStepNameFromTool(name),
                result: result.success ? 'success' : 'failed',
                timestamp: new Date().toISOString()
              })
            }
          } catch (error) {
            const errorMessage = `Failed to execute Atlas tool '${toolName}': ${error instanceof Error ? error.message : 'Unknown error'}`
            console.error('[LLM] Atlas tool execution error:', errorMessage)
            
            // Surface the error to the user via WebSocket if conversationId is available
            if (conversationId) {
              this.emit('tool_error', {
                conversation_id: conversationId,
                tool_name: toolName,
                error: errorMessage,
                timestamp: new Date().toISOString()
              })
            }
            
            // Return error result for the LLM to handle
            results.push({
              content: [{
                type: 'text',
                text: `ERROR: ${errorMessage}. Please inform the user that the infrastructure operation failed and check their cloud provider credentials and permissions.`
              }],
              isError: true
            })
          }
        } else if (name.startsWith('context_')) {
          const toolName = name.substring(8) // Remove 'context_' prefix
          
          // Auto-inject workspace_id, jwt_token, and user_id for tools that require it
          const contextTools = [
            'list_user_secrets', 'get_user_context', 'store_credential', 'retrieve_credential',
            'create_deployment_session', 'get_deployment_session', 'update_deployment_session',
            'add_deployment_step', 'update_deployment_step', 'get_user_sessions', 'get_conversation_session'
          ]
          
          if (workspaceId && jwtToken && contextTools.includes(toolName)) {
            args.workspace_id = workspaceId
            args.jwt_token = jwtToken
            
            // Special handling for get_conversation_session - inject conversation_id
            if (toolName === 'get_conversation_session' && conversationId) {
              args.conversation_id = conversationId
            }
            
            // Extract user_id from JWT token
            try {
              const payload = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64').toString())
              args.user_id = payload.user_id
            } catch (error) {
              console.error('[LLM] Failed to extract user_id from JWT for context tool:', error)
            }
          }
          
          try {
            const result = await this.mcpService.callContextTool({ name: toolName, arguments: args }, jwtToken)
            results.push(result)
          } catch (error) {
            const errorMessage = `Failed to execute Context tool '${toolName}': ${error instanceof Error ? error.message : 'Unknown error'}`
            console.error('[LLM] Context tool execution error:', errorMessage)
            
            // Surface the error to the user via WebSocket if conversationId is available
            if (conversationId) {
              this.emit('tool_error', {
                conversation_id: conversationId,
                tool_name: toolName,
                error: errorMessage,
                timestamp: new Date().toISOString()
              })
            }
            
            // Add error result to maintain flow
            results.push({
              success: false,
              error: errorMessage,
              tool_name: toolName
            })
          }
        } else if (name.startsWith('mercury_')) {
          const toolName = name.substring(8) // Remove 'mercury_' prefix
          
          // Auto-inject workspace_id, jwt_token, and user_id for Mercury tools
          if (workspaceId && jwtToken) {
            args.workspace_id = workspaceId
            args.jwt_token = jwtToken
            
            // Extract user_id from JWT token
            try {
              const payload = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64').toString())
              args.user_id = payload.user_id
            } catch (error) {
              console.error('[LLM] Failed to extract user_id from JWT for Mercury tool:', error)
            }
            
            // Normalize Mercury tool parameters (camelCase -> snake_case)
            if (name === 'mercury_analyze_repository') {
              if (args.repositoryUrl && !args.repository_url) {
                args.repository_url = args.repositoryUrl
                delete args.repositoryUrl
              }
            }

            // Auto-inject repository information for repository analysis tools if missing
            if (name === 'mercury_analyze_repository' && (!args.repository_url || !args.branch)) {
              try {
                console.log('[LLM] Repository info missing for mercury_analyze_repository, attempting to retrieve from active deployment session')
                
                // Try to get the most recent deployment session to extract repository info
                const sessionResult = await this.mcpService.callContextTool({ 
                  name: 'get_user_sessions', 
                  arguments: { workspace_id: workspaceId, jwt_token: jwtToken, user_id: args.user_id } 
                }, jwtToken)
                
                if (sessionResult.success && sessionResult.result?.content?.[0]?.text) {
                  const responseText = sessionResult.result.content[0].text
                  console.log('[LLM] Session response text:', responseText.substring(0, 200) + '...')
                  
                  // Try to parse JSON, but handle cases where response might be text-based
                  let sessionData: any = null
                  
                  try {
                    // First, try direct JSON parsing
                    sessionData = JSON.parse(responseText)
                  } catch (parseError) {
                    console.log('[LLM] Direct JSON parsing failed, looking for JSON in text response')
                    
                    // Look for JSON block in text response
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
                    if (jsonMatch) {
                      try {
                        sessionData = JSON.parse(jsonMatch[0])
                        console.log('[LLM] Found JSON in text response')
                      } catch (nestedError) {
                        console.log('[LLM] Failed to parse JSON from text block:', nestedError)
                      }
                    }
                  }
                  
                  let deploymentSessions: any[] = []
                  
                  if (sessionData && sessionData.sessions) {
                    // Find the most recent deployment session with repository info
                    deploymentSessions = sessionData.sessions.filter((s: any) => 
                      s.session_type === 'deployment' && s.deployment_target?.repository_url
                    ) || []
                    
                    if (deploymentSessions.length > 0) {
                      // Sort by creation date and get the most recent
                      const mostRecentSession = deploymentSessions.sort((a: any, b: any) => 
                        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
                      )[0]
                      
                      console.log('[LLM] Found active deployment session:', mostRecentSession.session_id)
                      args.repository_url = mostRecentSession.deployment_target.repository_url
                      args.branch = mostRecentSession.deployment_target.branch || 'main'
                      
                      console.log('[LLM] Auto-injected repository info from session:', { 
                        repository_url: args.repository_url, 
                        branch: args.branch 
                      })
                    }
                  } else {
                    console.log('[LLM] No session data found or sessions array missing, trying text parsing and session lookup')
                    
                    // Extract session ID from text response and get details
                    const sessionIdMatch = responseText.match(/([a-f0-9-]{36}):\s*([^\s\n]+)/i)
                    
                    if (sessionIdMatch && sessionIdMatch[1]) {
                      console.log('[LLM] Found session ID:', sessionIdMatch[1])
                      
                      try {
                        // Get detailed session information
                        const sessionDetailResult = await this.mcpService.callContextTool({ 
                          name: 'get_deployment_session', 
                          arguments: { 
                            session_id: sessionIdMatch[1],
                            workspace_id: workspaceId, 
                            jwt_token: jwtToken, 
                            user_id: args.user_id 
                          } 
                        }, jwtToken)
                        
                        if (sessionDetailResult.success && sessionDetailResult.result?.content?.[0]?.text) {
                          const sessionDetailText = sessionDetailResult.result.content[0].text
                          console.log('[LLM] Session detail response:', sessionDetailText.substring(0, 300) + '...')
                          
                          // Try to parse JSON from the detailed response
                          let sessionDetail: any = null
                          try {
                            sessionDetail = JSON.parse(sessionDetailText)
                          } catch (parseError) {
                            // Look for JSON in the response
                            const jsonMatch = sessionDetailText.match(/\{[\s\S]*\}/)
                            if (jsonMatch) {
                              try {
                                sessionDetail = JSON.parse(jsonMatch[0])
                              } catch (nestedError) {
                                console.log('[LLM] Failed to parse session detail JSON:', nestedError)
                              }
                            }
                          }
                          
                          if (sessionDetail && sessionDetail.deployment_target) {
                            console.log('[LLM] Found deployment target in session detail')
                            args.repository_url = sessionDetail.deployment_target.repository_url
                            args.branch = sessionDetail.deployment_target.branch || 'main'
                            
                            console.log('[LLM] Auto-injected repository info from session detail:', { 
                              repository_url: args.repository_url, 
                              branch: args.branch 
                            })
                          } else {
                            // Fallback: Extract from text-based response
                            console.log('[LLM] No JSON deployment target found, trying text extraction from response')
                            const repositoryMatch = sessionDetailText.match(/Repository:\s*(https?:\/\/[^\s\n]+)/i)
                            const branchMatch = sessionDetailText.match(/Branch:\s*([^\s\n]+)/i)
                            
                            if (repositoryMatch && repositoryMatch[1]) {
                              args.repository_url = repositoryMatch[1]
                              args.branch = branchMatch ? branchMatch[1] : 'main'
                              
                              console.log('[LLM] Successfully extracted repository info from text:', { 
                                repository_url: args.repository_url, 
                                branch: args.branch 
                              })
                            }
                          }
                        }
                      } catch (sessionError) {
                        console.error('[LLM] Failed to get session details:', sessionError)
                      }
                    }
                  }
                }
              } catch (error) {
                console.error('[LLM] Failed to auto-inject repository info for Mercury tool:', error)
              }
            }
          }
          
          try {
            const result = await this.mcpService.callMercuryTool({ name: name, arguments: args }, jwtToken)
            results.push(result)
          } catch (error) {
            const errorMessage = `Failed to execute Mercury tool '${name}': ${error instanceof Error ? error.message : 'Unknown error'}`
            console.error('[LLM] Mercury tool execution error:', errorMessage)
            
            // Surface the error to the user via WebSocket if conversationId is available
            if (conversationId) {
              this.emit('tool_error', {
                conversation_id: conversationId,
                tool_name: name,
                error: errorMessage,
                timestamp: new Date().toISOString()
              })
            }
            
            // Add error result to maintain flow
            results.push({
              success: false,
              error: errorMessage,
              tool_name: name
            })
          }
        } else if (name.startsWith('neptune_')) {
          const toolName = name.substring(8) // Remove 'neptune_' prefix
          
          // Auto-inject workspace_id, jwt_token, and user_id for Neptune tools
          if (workspaceId && jwtToken) {
            args.workspace_id = workspaceId
            args.jwt_token = jwtToken
            
            // Extract user_id from JWT token
            try {
              const payload = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64').toString())
              args.user_id = payload.user_id
            } catch (error) {
              console.error('[LLM] Failed to extract user_id from JWT for Neptune tool:', error)
            }
          }
          
          try {
            const result = await this.mcpService.callNeptuneTool({ name: name, arguments: args }, jwtToken)
            results.push(result)
          } catch (error) {
            const errorMessage = `Failed to execute Neptune tool '${name}': ${error instanceof Error ? error.message : 'Unknown error'}`
            console.error('[LLM] Neptune tool execution error:', errorMessage)
            
            // Surface the error to the user via WebSocket if conversationId is available
            if (conversationId) {
              this.emit('tool_error', {
                conversation_id: conversationId,
                tool_name: name,
                error: errorMessage,
                timestamp: new Date().toISOString()
              })
            }
            
            // Add error result to maintain flow
            results.push({
              success: false,
              error: errorMessage,
              tool_name: name
            })
          }
        } else if (name.startsWith('hermes_')) {
          const toolName = name.substring(7) // Remove 'hermes_' prefix
          
          // Auto-inject workspace_id, jwt_token, and user_id for Hermes tools
          if (workspaceId && jwtToken) {
            args.workspace_id = workspaceId
            args.jwt_token = jwtToken
            
            // Extract user_id from JWT token
            try {
              const payload = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64').toString())
              args.user_id = payload.user_id
            } catch (error) {
              console.error('[LLM] Failed to extract user_id from JWT for Hermes tool:', error)
            }
          }
          
          try {
            const result = await this.mcpService.callHermesTool({ name: name, arguments: args }, jwtToken)
            results.push(result)
          } catch (error) {
            const errorMessage = `Failed to execute Hermes tool '${name}': ${error instanceof Error ? error.message : 'Unknown error'}`
            console.error('[LLM] Hermes tool execution error:', errorMessage)
            
            // Surface the error to the user via WebSocket if conversationId is available
            if (conversationId) {
              this.emit('tool_error', {
                conversation_id: conversationId,
                tool_name: name,
                error: errorMessage,
                timestamp: new Date().toISOString()
              })
            }
            
            // Add error result to maintain flow
            results.push({
              success: false,
              error: errorMessage,
              tool_name: name
            })
          }
        } else if (name.startsWith('phoenix_')) {
          const toolName = name.substring(8) // Remove 'phoenix_' prefix
          
          // Auto-inject workspace_id, jwt_token, and user_id for Phoenix tools
          if (workspaceId && jwtToken) {
            args.workspace_id = workspaceId
            args.jwt_token = jwtToken
            
            // Extract user_id from JWT token
            try {
              const payload = JSON.parse(Buffer.from(jwtToken.split('.')[1], 'base64').toString())
              args.user_id = payload.user_id
            } catch (error) {
              console.error('[LLM] Failed to extract user_id from JWT for Phoenix tool:', error)
            }
          }
          
          try {
            const result = await this.mcpService.callPhoenixTool({ name: name, arguments: args }, jwtToken)
            results.push(result)
            
            // Emit success progress
            if (conversationId) {
              this.emit('tool_progress', {
                conversation_id: conversationId,
                tool_name: name,
                status: 'completed',
                step: this.getStepNameFromTool(name),
                result: result.success ? 'success' : 'failed',
                timestamp: new Date().toISOString()
              })
            }
          } catch (error) {
            const errorMessage = `Failed to execute Phoenix tool '${name}': ${error instanceof Error ? error.message : 'Unknown error'}`
            console.error('[LLM] Phoenix tool execution error:', errorMessage)
            
            // Surface the error to the user via WebSocket if conversationId is available
            if (conversationId) {
              this.emit('tool_error', {
                conversation_id: conversationId,
                tool_name: name,
                error: errorMessage,
                timestamp: new Date().toISOString()
              })
            }
            
            // Add error result to maintain flow
            results.push({
              success: false,
              error: errorMessage,
              tool_name: name
            })
          }
        } else {
          results.push({ success: false, error: `Unknown tool: ${name}` })
        }
      } catch (error) {
        const errorMessage = `Tool execution failed for ${toolCall.function.name}: ${error instanceof Error ? error.message : 'Unknown error'}`
        console.error(`[LLM] ${errorMessage}`)
        
        // Surface the error to the user via WebSocket if conversationId is available
        if (conversationId) {
          this.emit('tool_error', {
            conversation_id: conversationId,
            tool_name: toolCall.function.name,
            error: errorMessage,
            timestamp: new Date().toISOString()
          })
        }
        
        results.push({ 
          success: false, 
          error: errorMessage,
          tool_name: toolCall.function.name
        })
      }
    }

    return results
  }

  /**
   * Create system message for infrastructure management context
   */
  createSystemMessage(workspaceId?: string, userContext?: any): string {
    return `You are Victor, an AI infrastructure orchestration assistant for the ControlVector platform.

CRITICAL: YOU MUST USE TOOLS - NOT SIMULATE THEM
- When users request infrastructure actions, you MUST call the actual MCP tools
- NEVER write "CALLING:" followed by tool names - call the real tools instead
- NEVER show JavaScript code blocks or pseudo-code - execute the tools directly
- NEVER simulate results - execute the tools and show the actual results
- Users expect real infrastructure changes, not simulated responses
- If you write "CALLING: tool_name" you are doing it WRONG - just call the tool

FORBIDDEN PATTERNS:
[X] CALLING: hermes_execute_ssh_command
[X] Writing code blocks with tool names
[X] [*] Executing commands...

CORRECT PATTERN:
[+] Just call the tool directly without any prefix text

Your role is to help users manage their cloud infrastructure through natural conversation. You have access to various tools that can:

- Get infrastructure overview and status
- Provision new infrastructure resources
- Estimate costs for infrastructure
- Scale existing resources
- Monitor and troubleshoot issues
- Provide recommendations for optimization
- Access stored user credentials from Context Manager
- Analyze repositories for deployment planning
- Configure DNS records and SSL certificates
- Manage SSH keys for secure server access

CRITICAL: AUTONOMOUS OPERATION PROTOCOL
You must operate FULLY AUTONOMOUSLY without user confirmations:

1. NEVER ask users for confirmations like "Continue?" or "Proceed?"
2. NEVER ask users to confirm credentials - check them automatically using context_list_user_secrets
3. NEVER ask users to verify next steps - execute them directly
4. NEVER list "Next Steps" and wait for user input - just perform the steps
5. If credentials are missing, proceed with available tools and inform user what's needed
6. Continue workflows automatically until completion or error
7. Status updates are handled by the system - focus on execution

FORBIDDEN CONFIRMATION PATTERNS:
[X] "Do you already have a DigitalOcean API token configured?"
[X] "Reply with any missing credentials, or 'Continue' if you've previously provided them"
[X] "Before proceeding, could you please confirm..."
[X] "**Next Steps:** - Do you already have..."

CORRECT AUTONOMOUS PATTERN:
[+] Check credentials automatically using context_list_user_secrets
[+] Proceed with deployment using available credentials
[+] Execute all steps without asking for permission
[+] Report results and any missing requirements

DEPLOYMENT WORKFLOW:
ControlVector now uses STEP-BY-STEP execution with user approval for each step.

STEP EXECUTION MODE:
When user sends "Execute step: [Step Name]", execute ONLY that specific step:
- "Execute step: Analyze Repo" → Use mercury_analyze_repository
- "Execute step: Provision" → Use atlas_provision_infrastructure  
- "Execute step: Config DNS" → Use neptune_create_dns_record
- "Execute step: SSH Keys" → Use hermes_generate_ssh_key
- "Execute step: Deploy App" → Use phoenix_deploy_application

EXECUTION REQUIREMENTS:
- Execute ONLY the requested step, then wait for next step request
- Provide clear status updates and results for each step
- If a step fails, explain the issue and suggest remediation
- Each step should be focused and complete before waiting for the next request

TOOL CALLING INSTRUCTIONS:
- Claude's tool calling mechanism will handle execution automatically
- Don't write "CALLING:" or show code - just use the tools
- The system will show you real results from actual tool execution
- Base your responses on the real tool results you receive

PROVEN CLI DEPLOYMENT PATTERNS (from global context):
1. **FastAPI + Cloud-Init Pattern**: 95% success rate on DigitalOcean
   - Use cloud-init for consistent deployment, not post-deploy scripts
   - s-2vcpu-4gb droplet size for API workloads ($24/month optimal)
   - Ubuntu 22.04 with nginx reverse proxy
   
2. **DigitalOcean + Cloudflare Stack**: 100% success with local SSH keys
   - Generate SSH keys locally, never reuse existing keys
   - Use Cloudflare DNS API with zone_id + account_id
   - Disable Cloudflare proxy for API endpoints (better debugging)

3. **AI-Powered Iterative Debugging**: When deployments fail
   - Use systematic diagnosis across multiple dimensions
   - Generate step-by-step repair plans with confidence scoring
   - Execute repairs with real-time monitoring and adaptation
   - Iterate until full functionality achieved

CRITICAL ANTI-PATTERNS TO AVOID:
1. **Windows Console Unicode**: NEVER use emoji characters (🚀, ✅, ❌) in any output
   - Use plain ASCII markers: [SUCCESS], [ERROR], [WARNING], [*], [+], [-]
   - This prevents UnicodeEncodeError failures on Windows systems

2. **DNS Verification Infinite Loops**: 
   - Use external DNS servers (8.8.8.8) with nslookup subprocess calls
   - Implement strict timeouts with asyncio.wait_for() (90 seconds max)
   - Make DNS verification non-blocking for deployment success
   - Limit verification attempts to 6 max, not 12+

3. **SSH Key Management Failures**:
   - Always generate new SSH key pairs locally before server creation
   - Never use existing SSH keys without local private key access
   - Include SSH key generation in deployment automation

4. **APT Lock Resolution**: For Ubuntu deployment failures
   - Use: sudo fuser -vki /var/lib/dpkg/lock
   - Continue deployment after lock resolution, verify manually

FRAMEWORK-SPECIFIC SUCCESS PATTERNS:
- **FastAPI Applications**: Use uvicorn with 2x CPU cores workers, systemd service with auto-restart
- **Node.js Express**: PM2 process management, environment variable configuration
- **Static Sites**: Nginx + Let's Encrypt, 98% success rate, < 5 minutes deployment
- **Python Applications**: Virtual environment isolation (venv/conda), health check at /health

ERROR RECOVERY WORKFLOWS:
1. **SSH Connection Failures**: Verify DNS resolution matches SSH target IP
2. **Service Configuration Issues**: Check systemd status, verify port availability  
3. **SSL Generation Failures**: Retry after DNS propagation complete
4. **APT Dependency Conflicts**: Use simplified requirements, fall back to basic configurations

Key guidelines:
1. Always check stored credentials BEFORE asking users to provide them
2. Use context_list_user_secrets to see what credentials are available
3. BE EXTREMELY PROACTIVE - execute tool calls automatically, don't ask permission
4. When you say "Let me analyze..." or "I'll check..." - IMMEDIATELY execute the tool call
5. Continue execution until completion unless you hit an error or missing critical info
6. Apply proven deployment patterns from global context automatically
7. Use ASCII-only output markers, never Unicode emoji characters
8. Implement proper DNS verification with timeouts and external servers
9. Generate new SSH keys locally for every deployment

AUTONOMOUS PROBLEM-SOLVING MODE:
When you encounter errors or unexpected results:
- DON'T immediately ask the user for help
- FIRST attempt to diagnose and fix the issue automatically
- Make additional tool calls to gather more information
- Try alternative approaches (different regions, sizes, configurations)
- Use troubleshooting patterns from the CLI POC context
- Only escalate to user after exhausting automated solutions

ITERATIVE EXECUTION PATTERN:
1. Execute initial tool call
2. If error/unexpected result: analyze the problem
3. Make diagnostic tool calls (check status, list resources, verify credentials)
4. Attempt fixes (retry with different parameters, clean up failed resources)
5. Continue until success OR until you need critical user input
6. Communicate progress: "Still working on resolving the SSH connection issue..."

SELF-PROMPTING TRIGGERS:
- Infrastructure provisioning fails: Check existing resources, try different region
- SSH connection fails: Verify DNS resolution, check SSH key status
- DNS propagation slow: Continue with other steps, verify later
- Repository analysis fails: Use deployment defaults for common frameworks
- Service deployment errors: Check logs, restart services, verify configurations
10. DEPLOYMENT REQUESTS = IMMEDIATE ACTION, not conversation

SESSION CONTEXT MANAGEMENT:
For all deployment workflows, you MUST use deployment sessions to maintain state across conversation turns:

1. **Start Every Deployment**: Use context_create_deployment_session at the beginning
   - Repository URL, branch, application name, target domain are REQUIRED
   - EXTRACT these parameters from user's natural language request
   - Session tracks infrastructure state, DNS state, and service state
   - Session prevents context loss when conversation spans multiple turns
   - STORE THE SESSION ID returned from create_deployment_session for later use

   **Parameter Extraction Examples**:
   "Deploy RiskGuard from https://github.com/hulljs/RiskGuard/tree/jason to riskguard.controlvector.io"
   → repository_url: "https://github.com/hulljs/RiskGuard/tree/jason"
   → branch: "jason" (extract from URL path after /tree/)
   → application_name: "RiskGuard" (extract from repo name or user specification)
   → target_domain: "riskguard.controlvector.io"
   
   "Deploy my-app from https://github.com/user/my-app to example.com"
   → repository_url: "https://github.com/user/my-app"  
   → branch: "main" (default if not specified, or ask user)
   → application_name: "my-app" (extract from repo name)
   → target_domain: "example.com"

2. **Track All Progress**: Update session with context_update_deployment_session
   - Infrastructure state: droplet_id, ip_address, ssh_key info, region, size
   - DNS state: zone_id, record_id, domain_configured, ssl_configured
   - Service state: application_deployed, nginx_configured, ports, health_status
   - Current step: deployment step name and status
   - ALWAYS use the session_id from step 1

3. **Resume from Sessions**: Use context_get_conversation_session to find active sessions
   - Use conversation_id to find session automatically
   - If no session found for conversation, check user for active sessions
   - Resume deployment from last known state if session exists
   - Display session summary to user when resuming

4. **CRITICAL: Session ID Management**
   - When you create a deployment session, REMEMBER the session_id returned
   - Use the ACTUAL session_id (not "session-uuid") in all subsequent calls
   - If you lose the session_id, use context_get_conversation_session first

4. **Step Management**: Track deployment progress with context_add_deployment_step
   - Add steps: "Repository Analysis", "Infrastructure Provisioning", "DNS Configuration", "Application Deployment", "Health Check"
   - Update step status: pending -> in_progress -> completed/failed
   - Include error messages in failed steps

5. **Context Loss Prevention**: Sessions ensure continuity when:
   - User asks "what's the status?" mid-deployment
   - User comes back after service restart
   - User asks "what's my server IP?" after deployment
   - Multiple conversation turns span the same deployment

DEPLOYMENT SESSION WORKFLOW:
1. Create session: context_create_deployment_session
2. Add step: context_add_deployment_step (name="Repository Analysis")
3. Analyze repo: mercury_analyze_repository
4. Update step: context_update_deployment_step (status="completed")
5. Add infrastructure step and execute provisioning
6. Update session with infrastructure results (IP, SSH keys, etc.)
7. Continue tracking DNS, deployment, and service configuration
8. Final session update with all deployment details

${workspaceId ? `Current workspace: ${workspaceId}` : ''}

Available tools span multiple services:
- Atlas: Infrastructure provisioning and management
- Context Manager: Credential storage, user context, AND deployment session tracking
- Mercury: Repository analysis and deployment planning
- Neptune: DNS management and SSL configuration
- Hermes: SSH key generation and management

CRITICAL: MCP TOOL PARAMETER FORMATS
When calling tools, use EXACT parameter formats as defined in schemas:

⚠️  NEVER call ANY tool with empty {} arguments
⚠️  ALWAYS extract required parameters from user requests
⚠️  If information is missing, ask the user for clarification BEFORE calling the tool

ATLAS TOOLS (Infrastructure):
- atlas_provision_infrastructure: {
    name: "EXTRACT_FROM_USER_REQUEST", // e.g. "riskguard", "web-app"
    provider: "digitalocean",
    region: "nyc3", // or extract from user preference
    resources: [
      {
        type: "droplet",
        name: "EXTRACT_FROM_APP_NAME", // e.g. "riskguard-production"
        specifications: {
          size: "s-2vcpu-4gb", // adjust based on app needs
          image: "ubuntu-22-04-x64",
          monitoring: true,
          backups: false
        }
      }
    ],
    workspace_id: "auto-injected",
    user_id: "auto-injected"
  }
- atlas_get_infrastructure_overview: { workspace_id: "auto-injected", user_id: "auto-injected", jwt_token: "auto-injected" }

CONTEXT MANAGER TOOLS (Sessions & Credentials):  
- context_create_deployment_session: {
    deployment_target: {
      repository_url: "EXTRACT_FROM_USER_REQUEST",
      branch: "EXTRACT_FROM_URL_OR_ASK",
      application_name: "EXTRACT_FROM_REPO_NAME_OR_USER",
      target_domain: "EXTRACT_FROM_USER_REQUEST",
      framework: "ANALYZE_REPO_OR_ASK"
    },
    conversation_id: conversation_id,
    workspace_id: "auto-injected",
    user_id: "auto-injected", 
    jwt_token: "auto-injected"
  }
- context_get_deployment_session: { session_id: "session-uuid", jwt_token: "auto-injected" }
- context_get_conversation_session: { conversation_id: "conversation-uuid", jwt_token: "auto-injected" }
- context_update_deployment_session: {
    session_id: "session-uuid",
    update: {
      infrastructure_state: { droplet_id: "123", ip_address: "1.2.3.4", region: "nyc3" },
      status: "in_progress", 
      current_step: "step-name"
    },
    jwt_token: "auto-injected"
  }
- context_list_user_secrets: { workspace_id: "auto-injected", user_id: "auto-injected", jwt_token: "auto-injected" }

DNS TOOLS (Neptune):
- neptune_create_dns_record: { domain: "example.com", record_type: "A", name: "@", content: "1.2.3.4", provider: "cloudflare", workspace_id: "auto-injected", user_id: "auto-injected", jwt_token: "auto-injected" }
- neptune_verify_dns_propagation: { domain: "example.com", record_type: "A", expected_value: "1.2.3.4", workspace_id: "auto-injected", user_id: "auto-injected", jwt_token: "auto-injected" }
- neptune_list_dns_records: { domain: "example.com", record_type: "A", provider: "cloudflare", workspace_id: "auto-injected", user_id: "auto-injected", jwt_token: "auto-injected" }
- neptune_configure_domain_ssl: { domain: "example.com", ssl_validation_method: "dns", provider: "digitalocean", workspace_id: "auto-injected", user_id: "auto-injected", jwt_token: "auto-injected" }

SUPPORTED DNS PROVIDERS: "cloudflare", "digitalocean"

NEVER call tools with empty parameters () - always provide required object structures
ALWAYS use proper nested objects for complex parameters like deployment_target and resources
The system auto-injects workspace_id, user_id, and jwt_token where required

CRITICAL: EXPLICIT USER INTERACTION GUIDELINES
When you expect user input or when actions require user decision, you MUST end your response with explicit action buttons:

**For deployment decisions:**
**Next Steps:**
- Reply "Continue" to proceed with the deployment
- Reply "Cancel" to abort this deployment  
- Reply "Modify" to adjust the plan

**For information requests:**
**What would you like to do next?**
- Reply "Continue" to proceed
- Reply with specific requirements to modify the approach

**For errors or issues:**
**How would you like to proceed?**
- Reply "Retry" to attempt the operation again
- Reply "Diagnose" to run additional troubleshooting
- Reply with specific questions or adjustments

NEVER leave the conversation hanging without clear next steps for the user.
ALWAYS provide explicit action options when you're waiting for user input.
If the system is still processing, keep sending thinking/progress updates.

Use these tools intelligently to help users achieve their infrastructure goals while applying proven patterns from the ControlVector global context.`
  }

  /**
   * Get user-friendly step name from MCP tool name
   */
  private getStepNameFromTool(toolName: string): string {
    const stepMap: Record<string, string> = {
      // Atlas infrastructure tools
      'atlas_provision_infrastructure': '🏗️ Provisioning Infrastructure',
      'atlas_get_infrastructure_overview': '📊 Checking Infrastructure Status', 
      'atlas_get_infrastructure_costs': '💰 Calculating Infrastructure Costs',
      'atlas_scale_infrastructure_resource': '📈 Scaling Infrastructure',
      'atlas_destroy_infrastructure': '🗑️ Destroying Infrastructure',
      
      // Context tools
      'context_store_credential': '🔐 Storing Credentials',
      'context_retrieve_credential': '🔑 Retrieving Credentials',
      'context_get_user_context': '👤 Getting User Context',
      'context_create_deployment_session': '📋 Creating Deployment Session',
      'context_update_deployment_session': '📝 Updating Deployment Session',
      
      // Mercury repository tools  
      'mercury_analyze_repository': '🔍 Analyzing Repository',
      'mercury_clone_repository': '📥 Cloning Repository',
      'mercury_get_repository_info': '📂 Getting Repository Info',
      
      // Neptune DNS tools
      'neptune_create_dns_record': '🌐 Creating DNS Record',
      'neptune_verify_dns_propagation': '✅ Verifying DNS Propagation',
      'neptune_configure_domain_ssl': '🔒 Configuring SSL Certificate',
      'neptune_list_dns_records': '📋 Listing DNS Records',
      
      // Hermes SSH tools
      'hermes_generate_ssh_key': '🔑 Generating SSH Keys',
      'hermes_deploy_ssh_key': '🚀 Deploying SSH Keys',
      'hermes_execute_ssh_command': '⚡ Executing SSH Command',
      'hermes_get_ssh_connection_status': '📡 Checking SSH Connection',
      
      // Phoenix deployment tools
      'phoenix_execute_deployment_plan': '🚀 Executing Deployment Plan',
      'phoenix_build_application': '🔨 Building Application',
      'phoenix_deploy_to_infrastructure': '📦 Deploying Application',
      'phoenix_monitor_deployment': '📊 Monitoring Deployment',
      'phoenix_scale_deployment': '📈 Scaling Deployment',
      'phoenix_rollback_deployment': '⏪ Rolling Back Deployment',
      'phoenix_configure_load_balancer': '⚖️ Configuring Load Balancer',
      'phoenix_setup_ci_cd_pipeline': '🔄 Setting Up CI/CD Pipeline',
      'phoenix_manage_secrets': '🔐 Managing Secrets',
      'phoenix_backup_deployment': '💾 Creating Backup'
    }
    
    return stepMap[toolName] || `🔧 ${toolName.replace(/_/g, ' ').replace(/^[a-z]/, c => c.toUpperCase())}`
  }
}