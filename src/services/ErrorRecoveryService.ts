/**
 * Error Recovery Service - AI-Powered Failure Analysis and Recovery
 * 
 * This service implements intelligent error recovery by:
 * 1. Analyzing failures against provider API documentation
 * 2. Generating automated fix attempts
 * 3. Providing real-time progress updates to users
 * 4. Escalating to users after multiple failed attempts
 */

import { EventEmitter } from 'events'
import { LLMService, LLMResponse } from './LLMService'
import { MCPService } from './MCPService'

export interface ErrorRecoveryAttempt {
  id: string
  originalError: any
  provider: 'digitalocean' | 'aws' | 'gcp' | 'azure'
  operation: string
  attempt: number
  maxAttempts: number
  status: 'analyzing' | 'attempting_fix' | 'retrying' | 'succeeded' | 'failed' | 'escalated'
  diagnosis: string | null
  proposedFix: string | null
  startTime: Date
  endTime?: Date
  recoverySteps: RecoveryStep[]
}

export interface RecoveryStep {
  step: number
  action: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  details?: string
  timestamp: Date
}

export class ErrorRecoveryService extends EventEmitter {
  private llmService: LLMService
  private mcpService: MCPService
  private activeRecoveries: Map<string, ErrorRecoveryAttempt> = new Map()
  private maxRetryAttempts = 3
  private recoveryTimeout = 300000 // 5 minutes

  // DigitalOcean API Documentation Context for LLM
  private digitalOceanApiContext = `
  DIGITALOCEAN API COMMON ERRORS AND SOLUTIONS:

  1. **Authentication Errors (401)**:
     - Invalid or missing API token
     - Token lacks required scopes
     - Solution: Verify token and scopes in account settings

  2. **Rate Limiting (429)**:
     - Too many requests per hour/minute
     - Solution: Implement exponential backoff, reduce request frequency

  3. **Resource Limits (422)**:
     - Account limits exceeded (droplet limit, volume limit, etc.)
     - Solution: Check account limits, upgrade plan, or delete unused resources

  4. **Invalid Parameters (400)**:
     - Invalid region specified
     - Invalid size slug
     - Invalid image slug
     - Missing required parameters
     - Solution: Verify parameter values against API documentation

  5. **Insufficient Resources (422)**:
     - Not enough quota for requested resource size
     - Specific size not available in region
     - Solution: Try different size or region

  6. **Network/DNS Issues**:
     - Domain not configured properly
     - DNS propagation delays
     - Solution: Verify domain ownership, wait for propagation

  7. **SSH Key Issues**:
     - Invalid SSH key format
     - SSH key already exists
     - Solution: Validate key format, check existing keys

  DIGITALOCEAN API PARAMETERS:
  - Regions: nyc1, nyc3, ams3, sfo3, sgp1, lon1, fra1, tor1, blr1, syd1
  - Droplet sizes: s-1vcpu-1gb, s-1vcpu-2gb, s-2vcpu-2gb, s-2vcpu-4gb, s-4vcpu-8gb, etc.
  - Images: ubuntu-22-04-x64, ubuntu-20-04-x64, debian-11-x64, centos-8-x64, etc.
  `

  constructor(llmService: LLMService, mcpService: MCPService) {
    super()
    this.llmService = llmService
    this.mcpService = mcpService
  }

  /**
   * Start error recovery process for a failed operation
   */
  async startRecovery(
    conversationId: string,
    originalError: any,
    provider: string,
    operation: string,
    originalParams: any,
    jwtToken?: string
  ): Promise<string> {
    const recoveryId = `recovery-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`
    
    const attempt: ErrorRecoveryAttempt = {
      id: recoveryId,
      originalError,
      provider: provider as any,
      operation,
      attempt: 1,
      maxAttempts: this.maxRetryAttempts,
      status: 'analyzing',
      diagnosis: null,
      proposedFix: null,
      startTime: new Date(),
      recoverySteps: []
    }

    this.activeRecoveries.set(recoveryId, attempt)

    // Emit recovery started event
    this.emit('recovery_started', {
      conversation_id: conversationId,
      recovery_id: recoveryId,
      provider,
      operation,
      status: 'analyzing'
    })

    // Start the recovery process asynchronously
    this.performRecovery(conversationId, recoveryId, originalParams, jwtToken)
      .catch(error => {
        console.error(`[ErrorRecovery] Recovery ${recoveryId} failed:`, error)
        this.escalateToUser(conversationId, recoveryId, error)
      })

    return recoveryId
  }

  /**
   * Perform the actual recovery process
   */
  private async performRecovery(
    conversationId: string,
    recoveryId: string,
    originalParams: any,
    jwtToken?: string
  ): Promise<void> {
    const attempt = this.activeRecoveries.get(recoveryId)
    if (!attempt) return

    try {
      // Step 1: Analyze the error with AI
      await this.analyzeError(conversationId, attempt)

      // Step 2: Generate and attempt fixes
      while (attempt.attempt <= attempt.maxAttempts) {
        await this.attemptFix(conversationId, attempt, originalParams, jwtToken)
        
        if (attempt.status === 'succeeded' || attempt.status === 'failed') {
          break
        }

        attempt.attempt++
        if (attempt.attempt <= attempt.maxAttempts) {
          await this.delay(2000 * attempt.attempt) // Exponential backoff
        }
      }

      // Step 3: Escalate if all attempts failed
      if (attempt.status !== 'succeeded') {
        await this.escalateToUser(conversationId, recoveryId, new Error('All recovery attempts failed'))
      }

    } catch (error) {
      console.error(`[ErrorRecovery] Recovery process failed:`, error)
      await this.escalateToUser(conversationId, recoveryId, error)
    }
  }

  /**
   * Use AI to analyze the error and generate diagnosis
   */
  private async analyzeError(conversationId: string, attempt: ErrorRecoveryAttempt): Promise<void> {
    attempt.status = 'analyzing'
    this.addRecoveryStep(attempt, `Analyzing ${attempt.provider} error with AI`, 'in_progress')

    this.emit('recovery_progress', {
      conversation_id: conversationId,
      recovery_id: attempt.id,
      status: 'analyzing',
      message: `🔍 Analyzing ${attempt.provider} ${attempt.operation} failure...`,
      step: 1,
      total_steps: 3
    })

    const analysisPrompt = `
    You are a DigitalOcean infrastructure expert. Analyze this API error and provide:
    1. Root cause diagnosis
    2. Specific fix recommendations
    3. Modified parameters if needed

    ERROR DETAILS:
    Operation: ${attempt.operation}
    Provider: ${attempt.provider}
    Error: ${JSON.stringify(attempt.originalError, null, 2)}

    CONTEXT:
    ${this.digitalOceanApiContext}

    Respond in JSON format:
    {
      "diagnosis": "Clear explanation of what went wrong",
      "confidence": 0.9,
      "proposedFix": "Specific fix to try",
      "modifiedParameters": { /* corrected parameters if applicable */ },
      "reasoning": "Why this fix should work"
    }
    `

    try {
      const response = await this.llmService.chat(
        [{ role: 'user', content: analysisPrompt }],
        undefined, // jwtToken
        'default', // workspaceId
        conversationId
      )

      let analysis
      try {
        // Try to extract JSON from the response
        const jsonMatch = response.message.match(/\{[\s\S]*\}/)
        analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : null
      } catch (parseError) {
        // Fallback to text analysis
        analysis = {
          diagnosis: response.message,
          confidence: 0.7,
          proposedFix: "Retry with corrected parameters",
          reasoning: "AI text analysis"
        }
      }

      attempt.diagnosis = analysis.diagnosis
      attempt.proposedFix = analysis.proposedFix

      this.completeRecoveryStep(attempt, `Analysis complete: ${analysis.diagnosis}`)

      this.emit('recovery_progress', {
        conversation_id: conversationId,
        recovery_id: attempt.id,
        status: 'analysis_complete',
        message: `📋 **Error Analysis Complete**\n\n**Diagnosis:** ${analysis.diagnosis}\n\n**Proposed Fix:** ${analysis.proposedFix}`,
        step: 1,
        total_steps: 3,
        details: analysis
      })

    } catch (error) {
      this.failRecoveryStep(attempt, `Analysis failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      throw error
    }
  }

  /**
   * Attempt to fix the error based on AI analysis
   */
  private async attemptFix(
    conversationId: string,
    attempt: ErrorRecoveryAttempt,
    originalParams: any,
    jwtToken?: string
  ): Promise<void> {
    attempt.status = 'attempting_fix'
    
    this.addRecoveryStep(
      attempt, 
      `Attempting fix #${attempt.attempt}: ${attempt.proposedFix}`, 
      'in_progress'
    )

    this.emit('recovery_progress', {
      conversation_id: conversationId,
      recovery_id: attempt.id,
      status: 'attempting_fix',
      message: `🔧 **Recovery Attempt ${attempt.attempt}/${attempt.maxAttempts}**\n\nTrying: ${attempt.proposedFix}`,
      step: 2,
      total_steps: 3,
      attempt: attempt.attempt
    })

    try {
      // For DigitalOcean provisioning failures, retry with potentially corrected parameters
      if (attempt.provider === 'digitalocean' && attempt.operation === 'provision_infrastructure') {
        const result = await this.mcpService.callAtlas('atlas_provision_infrastructure', {
          ...originalParams,
          // Add any parameter corrections from AI analysis
          retry_attempt: attempt.attempt,
          recovery_id: attempt.id
        }, jwtToken)

        if (result.success) {
          attempt.status = 'succeeded'
          attempt.endTime = new Date()
          
          this.completeRecoveryStep(attempt, `Fix successful on attempt ${attempt.attempt}`)
          
          this.emit('recovery_success', {
            conversation_id: conversationId,
            recovery_id: attempt.id,
            message: `✅ **Recovery Successful!**\n\nFixed after ${attempt.attempt} attempts.\n\n**Solution:** ${attempt.proposedFix}`,
            result: result.result,
            attempts: attempt.attempt
          })
        } else {
          this.failRecoveryStep(attempt, `Attempt ${attempt.attempt} failed: ${result.error}`)
          
          // Update the error for next analysis iteration
          attempt.originalError = result.error
          
          if (attempt.attempt < attempt.maxAttempts) {
            // Re-analyze with new error information
            await this.analyzeError(conversationId, attempt)
          }
        }
      }
    } catch (error) {
      this.failRecoveryStep(attempt, `Fix attempt failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
      throw error
    }
  }

  /**
   * Escalate to user after failed recovery attempts
   */
  private async escalateToUser(conversationId: string, recoveryId: string, error: any): Promise<void> {
    const attempt = this.activeRecoveries.get(recoveryId)
    if (!attempt) return

    attempt.status = 'escalated'
    attempt.endTime = new Date()

    const duration = attempt.endTime.getTime() - attempt.startTime.getTime()
    const durationText = `${Math.round(duration / 1000)}s`

    this.emit('recovery_escalated', {
      conversation_id: conversationId,
      recovery_id: recoveryId,
      message: `⚠️ **Recovery Unsuccessful**\n\nAfter ${attempt.attempt - 1} attempts (${durationText}), I need your help.\n\n**Last Error:** ${attempt.originalError?.message || 'Unknown error'}\n\n**Tried:** ${attempt.proposedFix}\n\n**Options:**\n1. Check your DigitalOcean account limits\n2. Verify API token permissions\n3. Try a different region or size\n4. Manual intervention required`,
      attempts: attempt.attempt - 1,
      duration: durationText,
      suggestions: [
        "Check DigitalOcean account limits",
        "Verify API token permissions",
        "Try different region/size",
        "Contact DigitalOcean support"
      ]
    })

    // Clean up after delay
    setTimeout(() => {
      this.activeRecoveries.delete(recoveryId)
    }, 30000)
  }

  /**
   * Get recovery status
   */
  getRecoveryStatus(recoveryId: string): ErrorRecoveryAttempt | null {
    return this.activeRecoveries.get(recoveryId) || null
  }

  /**
   * Cancel an active recovery
   */
  cancelRecovery(recoveryId: string): boolean {
    const attempt = this.activeRecoveries.get(recoveryId)
    if (attempt) {
      attempt.status = 'failed'
      attempt.endTime = new Date()
      this.activeRecoveries.delete(recoveryId)
      return true
    }
    return false
  }

  // Helper methods
  private addRecoveryStep(attempt: ErrorRecoveryAttempt, action: string, status: 'pending' | 'in_progress' | 'completed' | 'failed'): void {
    attempt.recoverySteps.push({
      step: attempt.recoverySteps.length + 1,
      action,
      status,
      timestamp: new Date()
    })
  }

  private completeRecoveryStep(attempt: ErrorRecoveryAttempt, details?: string): void {
    const currentStep = attempt.recoverySteps[attempt.recoverySteps.length - 1]
    if (currentStep) {
      currentStep.status = 'completed'
      currentStep.details = details
    }
  }

  private failRecoveryStep(attempt: ErrorRecoveryAttempt, details?: string): void {
    const currentStep = attempt.recoverySteps[attempt.recoverySteps.length - 1]
    if (currentStep) {
      currentStep.status = 'failed'
      currentStep.details = details
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}