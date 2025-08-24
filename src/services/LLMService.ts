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

export class LLMService {
  private config: WatsonConfig
  private mcpService: MCPService

  constructor(config: WatsonConfig, mcpService: MCPService) {
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

    return tools
  }

  /**
   * Main inference method - chat with LLM using user's credentials and MCP tools
   */
  async chat(
    messages: LLMMessage[],
    jwtToken?: string,
    workspaceId?: string
  ): Promise<LLMResponse> {
    const credentials = await this.getUserLLMCredentials(jwtToken)
    
    if (!credentials.preferred_provider) {
      throw new Error('No LLM credentials available. Please configure your API keys in settings.')
    }

    const tools = await this.getMCPToolDefinitions()
    
    console.log(`[LLM] Using ${credentials.preferred_provider} with ${tools.length} MCP tools available`)

    if (credentials.preferred_provider === 'anthropic' && credentials.anthropic_api_key) {
      return await this.chatWithClaude(messages, credentials.anthropic_api_key, tools, jwtToken, workspaceId)
    } else if (credentials.preferred_provider === 'openai' && credentials.openai_api_key) {
      return await this.chatWithOpenAI(messages, credentials.openai_api_key, tools, jwtToken, workspaceId)
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
    workspaceId?: string
  ): Promise<LLMResponse> {
    const anthropic = new Anthropic({ apiKey })

    // Convert messages to Claude format
    const systemMessage = messages.find(m => m.role === 'system')?.content || 
      'You are Watson, an AI infrastructure orchestration assistant. Use the available tools to help users manage their cloud infrastructure.'
    
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

        // Execute tool calls
        const toolResults = await this.executeMCPToolCalls(toolCalls, jwtToken, workspaceId)
        
        // Add tool results to messages and get final response
        const finalMessages = [...chatMessages, {
          role: 'assistant' as const,
          content: responseText
        }]
        
        // Add tool results
        for (let i = 0; i < toolResults.length; i++) {
          finalMessages.push({
            role: 'user' as const,
            content: `Tool result for ${toolCalls[i].function.name}: ${JSON.stringify(toolResults[i])}`
          })
        }

        // Get final response from Claude
        const finalResponse = await anthropic.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4000,
          system: systemMessage + '\n\nBased on the tool results above, provide a helpful response to the user.',
          messages: finalMessages
        })

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
    workspaceId?: string
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
        // Execute tool calls
        const toolResults = await this.executeMCPToolCalls(choice.message.tool_calls, jwtToken, workspaceId)
        
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
    workspaceId?: string
  ): Promise<any[]> {
    const results = []

    for (const toolCall of toolCalls) {
      try {
        const { name } = toolCall.function
        const args = JSON.parse(toolCall.function.arguments)

        console.log(`[LLM] Executing MCP tool: ${name}`, args)

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
          
          const result = await this.mcpService.callAtlasTool({ name: toolName, arguments: args }, jwtToken)
          results.push(result)
        } else if (name.startsWith('context_')) {
          const toolName = name.substring(8) // Remove 'context_' prefix
          const result = await this.mcpService.callContextTool({ name: toolName, arguments: args }, jwtToken)
          results.push(result)
        } else {
          results.push({ success: false, error: `Unknown tool: ${name}` })
        }
      } catch (error) {
        console.error(`[LLM] Tool execution failed for ${toolCall.function.name}:`, error)
        results.push({ 
          success: false, 
          error: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    }

    return results
  }

  /**
   * Create system message for infrastructure management context
   */
  createSystemMessage(workspaceId?: string, userContext?: any): string {
    return `You are Watson, an AI infrastructure orchestration assistant for the ControlVector platform.

Your role is to help users manage their cloud infrastructure through natural conversation. You have access to various tools that can:

- Get infrastructure overview and status
- Provision new infrastructure resources
- Estimate costs for infrastructure
- Scale existing resources  
- Monitor and troubleshoot issues
- Provide recommendations for optimization

Key guidelines:
1. Always use the available tools to get real data rather than making assumptions
2. Be proactive in calling multiple tools when needed to provide comprehensive answers
3. Explain what you're doing and why when using tools
4. Provide actionable insights and recommendations
5. Handle errors gracefully and suggest alternatives

${workspaceId ? `Current workspace: ${workspaceId}` : ''}

Available tools will be provided as function calls. Use them intelligently to help users achieve their infrastructure goals.`
  }
}