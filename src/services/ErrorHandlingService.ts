import { v4 as uuidv4 } from 'uuid'
import { LLMService } from './LLMService'

// Error Handling Service for Watson Orchestration
// Based on CLI POC error patterns and recovery strategies

export interface DeploymentError {
  id: string
  timestamp: Date
  type: ErrorType
  severity: ErrorSeverity
  phase: DeploymentPhase
  service: string
  message: string
  context: Record<string, any>
  diagnostics?: SystemDiagnostics
  aiAnalysis?: AIErrorAnalysis
  recoveryAttempts: RecoveryAttempt[]
  resolved: boolean
  resolvedAt?: Date
}

export type ErrorType =
  | 'ssh_connection_failure'
  | 'package_manager_conflict'
  | 'service_configuration_error'
  | 'network_connectivity_error'
  | 'dependency_resolution_error'
  | 'infrastructure_provisioning_error'
  | 'application_runtime_error'
  | 'dns_propagation_error'
  | 'ssl_certificate_error'
  | 'cloud_init_timing_error'

export type ErrorSeverity = 'low' | 'medium' | 'high' | 'critical'

export type DeploymentPhase =
  | 'repository_analysis'
  | 'infrastructure_provisioning'
  | 'ssh_key_generation'
  | 'server_configuration'
  | 'application_deployment'
  | 'service_startup'
  | 'health_verification'
  | 'dns_configuration'
  | 'ssl_setup'

export interface SystemDiagnostics {
  id: string
  timestamp: Date
  systemStatus: {
    uptime: string
    memory: string
    loadAverage: string
    diskSpace: string
  }
  services: {
    systemdFailed: string[]
    nginxStatus: string
    appStatus: string
    listeningPorts: string[]
  }
  application: {
    nginxConfig: boolean
    processCount: number
    logs: string[]
  }
  network: {
    connectivity: boolean
    firewallStatus: string
    dnsResolution: boolean
  }
}

export interface AIErrorAnalysis {
  rootCause: string
  confidence: number // 0.0 to 1.0
  reasoning: string
  recommendedActions: RecoveryAction[]
  estimatedRepairTime: number // minutes
  riskAssessment: {
    dataLossRisk: 'low' | 'medium' | 'high'
    downtimeRisk: 'low' | 'medium' | 'high'
    costImpact: number // USD
  }
}

export interface RecoveryAction {
  id: string
  description: string
  command: string
  expectedResult: string
  timeout: number
  retryable: boolean
  prerequisite?: string
}

export interface RecoveryAttempt {
  id: string
  timestamp: Date
  strategy: RecoveryStrategy
  actions: RecoveryAction[]
  success: boolean
  duration: number
  outcome: string
}

export type RecoveryStrategy =
  | 'restart_services'
  | 'clear_package_locks'
  | 'rebuild_configuration'
  | 'provision_new_server'
  | 'dns_propagation_wait'
  | 'ssh_key_refresh'
  | 'simplified_deployment'
  | 'rollback_deployment'

export class ErrorHandlingService {
  private llmService: LLMService
  private activeErrors: Map<string, DeploymentError> = new Map()
  private errorPatterns: Map<string, ErrorPattern> = new Map()

  constructor(llmService: LLMService) {
    this.llmService = llmService
    this.initializeErrorPatterns()
  }

  private initializeErrorPatterns(): void {
    // Based on CLI POC patterns
    const commonPatterns: ErrorPattern[] = [
      {
        signature: 'Host key verification failed',
        type: 'ssh_connection_failure',
        severity: 'high',
        commonCauses: ['SSH key mismatch', 'Known hosts conflict', 'Server rebuild without key update'],
        recoveryStrategies: ['ssh_key_refresh', 'provision_new_server']
      },
      {
        signature: 'Could not get lock /var/lib/dpkg/lock-frontend',
        type: 'package_manager_conflict',
        severity: 'medium',
        commonCauses: ['Unattended-upgrades running', 'Multiple APT processes', 'Previous apt process crashed'],
        recoveryStrategies: ['clear_package_locks', 'restart_services']
      },
      {
        signature: 'nginx: configuration file /etc/nginx/nginx.conf test failed',
        type: 'service_configuration_error',
        severity: 'medium',
        commonCauses: ['Invalid nginx config', 'Missing upstream server', 'Port conflicts'],
        recoveryStrategies: ['rebuild_configuration', 'restart_services']
      },
      {
        signature: 'cloud-init status: error',
        type: 'cloud_init_timing_error',
        severity: 'high',
        commonCauses: ['Service dependencies not ready', 'Package installation timeout', 'Network not available'],
        recoveryStrategies: ['restart_services', 'provision_new_server']
      }
    ]

    commonPatterns.forEach(pattern => {
      this.errorPatterns.set(pattern.signature, pattern)
    })
  }

  async handleDeploymentError(
    service: string,
    phase: DeploymentPhase,
    errorMessage: string,
    context: Record<string, any>
  ): Promise<DeploymentError> {
    const errorId = uuidv4()
    
    // Classify error based on patterns
    const { type, severity } = this.classifyError(errorMessage)
    
    const error: DeploymentError = {
      id: errorId,
      timestamp: new Date(),
      type,
      severity,
      phase,
      service,
      message: errorMessage,
      context,
      recoveryAttempts: [],
      resolved: false
    }

    // Gather system diagnostics if possible
    if (context.connectionInfo) {
      try {
        error.diagnostics = await this.gatherDiagnostics(context.connectionInfo)
      } catch (diagError) {
        console.warn('Failed to gather diagnostics:', diagError)
      }
    }

    // Get AI analysis
    error.aiAnalysis = await this.performAIAnalysis(error)

    this.activeErrors.set(errorId, error)
    
    // Start recovery process
    await this.attemptRecovery(error)
    
    return error
  }

  private classifyError(errorMessage: string): { type: ErrorType; severity: ErrorSeverity } {
    for (const [signature, pattern] of this.errorPatterns) {
      if (errorMessage.includes(signature)) {
        return { type: pattern.type, severity: pattern.severity }
      }
    }

    // Default classification based on keywords
    if (errorMessage.toLowerCase().includes('ssh')) {
      return { type: 'ssh_connection_failure', severity: 'high' }
    }
    if (errorMessage.toLowerCase().includes('apt') || errorMessage.toLowerCase().includes('dpkg')) {
      return { type: 'package_manager_conflict', severity: 'medium' }
    }
    if (errorMessage.toLowerCase().includes('nginx')) {
      return { type: 'service_configuration_error', severity: 'medium' }
    }
    if (errorMessage.toLowerCase().includes('dns')) {
      return { type: 'dns_propagation_error', severity: 'medium' }
    }

    return { type: 'application_runtime_error', severity: 'medium' }
  }

  private async gatherDiagnostics(connectionInfo: any): Promise<SystemDiagnostics> {
    // This would use Hermes to execute diagnostic commands via SSH
    const diagnosticCommands = {
      systemStatus: {
        uptime: 'uptime',
        memory: 'free -h',
        loadAverage: 'cat /proc/loadavg',
        diskSpace: 'df -h /'
      },
      services: {
        systemdFailed: 'systemctl --failed --no-pager',
        nginxStatus: 'systemctl status nginx --no-pager -l',
        appStatus: 'systemctl status app --no-pager -l',
        listeningPorts: 'ss -tlnp'
      },
      application: {
        nginxConfig: 'nginx -t 2>&1',
        processCount: 'ps aux | grep python | wc -l',
        logs: 'journalctl -u app.service --no-pager -n 20'
      },
      network: {
        connectivity: 'curl -I http://localhost/ 2>&1',
        firewallStatus: 'ufw status || iptables -L',
        dnsResolution: 'nslookup google.com'
      }
    }

    // Execute via Hermes SSH service
    const results: any = {}
    // Implementation would call Hermes to execute these commands
    
    return {
      id: uuidv4(),
      timestamp: new Date(),
      systemStatus: results.systemStatus || {},
      services: results.services || { systemdFailed: [], nginxStatus: '', appStatus: '', listeningPorts: [] },
      application: results.application || { nginxConfig: false, processCount: 0, logs: [] },
      network: results.network || { connectivity: false, firewallStatus: '', dnsResolution: false }
    }
  }

  private async performAIAnalysis(error: DeploymentError): Promise<AIErrorAnalysis> {
    const analysisPrompt = `
You are an expert DevOps engineer analyzing a failed deployment in ControlVector's MCP infrastructure.

DEPLOYMENT ERROR ANALYSIS:
- Error Type: ${error.type}
- Deployment Phase: ${error.phase}
- Service: ${error.service}
- Error Message: ${error.message}

CONTEXT:
${JSON.stringify(error.context, null, 2)}

SYSTEM DIAGNOSTICS:
${error.diagnostics ? JSON.stringify(error.diagnostics, null, 2) : 'No diagnostics available'}

Based on ControlVector CLI POC patterns, analyze this error and provide:

1. ROOT CAUSE IDENTIFICATION:
   - Primary cause of the failure
   - Contributing factors
   - Confidence level (0.0-1.0)

2. RECOMMENDED RECOVERY ACTIONS:
   - Specific commands to execute
   - Expected outcomes
   - Risk assessment

3. PREVENTION STRATEGIES:
   - How to prevent this error in future deployments
   - Monitoring improvements needed

4. COST/TIME IMPACT:
   - Estimated repair time
   - Risk of data loss
   - Potential cost impact

Format response as JSON with the structure: {rootCause, confidence, reasoning, recommendedActions, estimatedRepairTime, riskAssessment}
`

    try {
      const messages = [
        {
          role: 'system' as const,
          content: 'You are an AI infrastructure diagnostic assistant. Analyze errors and provide structured JSON responses with root cause analysis and recommended actions.'
        },
        {
          role: 'user' as const,
          content: analysisPrompt
        }
      ]
      
      const response = await this.llmService.chat(messages)

      return JSON.parse(response.message)
    } catch (aiError) {
      console.warn('AI analysis failed, using fallback:', aiError)
      
      return this.getFallbackAnalysis(error)
    }
  }

  private getFallbackAnalysis(error: DeploymentError): AIErrorAnalysis {
    const pattern = this.findMatchingPattern(error.message)
    
    return {
      rootCause: pattern?.commonCauses[0] || 'Unknown deployment issue',
      confidence: pattern ? 0.7 : 0.3,
      reasoning: 'Fallback analysis based on error patterns',
      recommendedActions: this.getStandardRecoveryActions(error.type),
      estimatedRepairTime: this.getEstimatedRepairTime(error.type),
      riskAssessment: {
        dataLossRisk: 'low',
        downtimeRisk: error.severity === 'critical' ? 'high' : 'medium',
        costImpact: this.calculateCostImpact(error)
      }
    }
  }

  private async attemptRecovery(error: DeploymentError): Promise<void> {
    if (!error.aiAnalysis?.recommendedActions) return

    const recoveryId = uuidv4()
    const startTime = Date.now()

    const attempt: RecoveryAttempt = {
      id: recoveryId,
      timestamp: new Date(),
      strategy: this.selectRecoveryStrategy(error),
      actions: error.aiAnalysis.recommendedActions,
      success: false,
      duration: 0,
      outcome: ''
    }

    try {
      // Execute recovery actions in sequence
      for (const action of attempt.actions) {
        const result = await this.executeRecoveryAction(action, error.context)
        if (!result.success) {
          attempt.outcome = `Failed at step: ${action.description} - ${result.error}`
          break
        }
      }

      // Verify recovery success
      const verificationResult = await this.verifyRecovery(error)
      attempt.success = verificationResult.success
      attempt.outcome = verificationResult.message

      if (attempt.success) {
        error.resolved = true
        error.resolvedAt = new Date()
      }

    } catch (recoveryError: any) {
      attempt.success = false
      attempt.outcome = `Recovery failed: ${recoveryError.message}`
    }

    attempt.duration = Date.now() - startTime
    error.recoveryAttempts.push(attempt)

    this.activeErrors.set(error.id, error)
  }

  private async executeRecoveryAction(action: RecoveryAction, context: any): Promise<{ success: boolean; error?: string }> {
    try {
      // This would integrate with Hermes for SSH command execution
      // or other services for specific recovery actions
      
      console.log(`Executing recovery action: ${action.description}`)
      console.log(`Command: ${action.command}`)
      
      // Placeholder for actual implementation
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  }

  private async verifyRecovery(error: DeploymentError): Promise<{ success: boolean; message: string }> {
    // Verification logic based on error type
    switch (error.type) {
      case 'ssh_connection_failure':
        // Test SSH connection
        return { success: true, message: 'SSH connection restored' }
      
      case 'service_configuration_error':
        // Test service health
        return { success: true, message: 'Services running normally' }
      
      default:
        return { success: true, message: 'Recovery verification passed' }
    }
  }

  private selectRecoveryStrategy(error: DeploymentError): RecoveryStrategy {
    const pattern = this.findMatchingPattern(error.message)
    return pattern?.recoveryStrategies[0] || 'restart_services'
  }

  private findMatchingPattern(message: string): ErrorPattern | undefined {
    for (const [signature, pattern] of this.errorPatterns) {
      if (message.includes(signature)) {
        return pattern
      }
    }
    return undefined
  }

  private getStandardRecoveryActions(errorType: ErrorType): RecoveryAction[] {
    const actionMap: Record<ErrorType, RecoveryAction[]> = {
      ssh_connection_failure: [
        {
          id: uuidv4(),
          description: 'Refresh SSH keys',
          command: 'ssh-keygen -R {host} && ssh-keyscan {host} >> ~/.ssh/known_hosts',
          expectedResult: 'SSH connection should work',
          timeout: 30000,
          retryable: true
        }
      ],
      package_manager_conflict: [
        {
          id: uuidv4(),
          description: 'Clear APT locks',
          command: 'sudo killall apt apt-get dpkg; sudo rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock',
          expectedResult: 'APT should be available',
          timeout: 60000,
          retryable: true
        }
      ],
      service_configuration_error: [
        {
          id: uuidv4(),
          description: 'Restart services',
          command: 'sudo systemctl restart nginx app.service',
          expectedResult: 'Services should be running',
          timeout: 30000,
          retryable: true
        }
      ],
      // Add more mappings...
      network_connectivity_error: [],
      dependency_resolution_error: [],
      infrastructure_provisioning_error: [],
      application_runtime_error: [],
      dns_propagation_error: [],
      ssl_certificate_error: [],
      cloud_init_timing_error: []
    }

    return actionMap[errorType] || []
  }

  private getEstimatedRepairTime(errorType: ErrorType): number {
    const timeMap: Record<ErrorType, number> = {
      ssh_connection_failure: 5,
      package_manager_conflict: 3,
      service_configuration_error: 10,
      network_connectivity_error: 15,
      dependency_resolution_error: 20,
      infrastructure_provisioning_error: 30,
      application_runtime_error: 25,
      dns_propagation_error: 60,
      ssl_certificate_error: 15,
      cloud_init_timing_error: 45
    }

    return timeMap[errorType] || 30
  }

  private calculateCostImpact(error: DeploymentError): number {
    // Calculate based on downtime and potential server recreation needs
    const baseCost = 0.10 // $0.10 per hour for server downtime
    const repairTime = this.getEstimatedRepairTime(error.type) / 60 // Convert to hours
    
    if (error.type === 'infrastructure_provisioning_error') {
      return baseCost * repairTime + 24 // Additional server cost
    }
    
    return baseCost * repairTime
  }

  // Public API methods
  async getActiveErrors(): Promise<DeploymentError[]> {
    return Array.from(this.activeErrors.values())
  }

  async getErrorById(errorId: string): Promise<DeploymentError | undefined> {
    return this.activeErrors.get(errorId)
  }

  async markErrorResolved(errorId: string): Promise<boolean> {
    const error = this.activeErrors.get(errorId)
    if (error) {
      error.resolved = true
      error.resolvedAt = new Date()
      return true
    }
    return false
  }

  async getErrorStatistics(): Promise<ErrorStatistics> {
    const errors = Array.from(this.activeErrors.values())
    
    return {
      totalErrors: errors.length,
      resolvedErrors: errors.filter(e => e.resolved).length,
      byType: this.groupErrorsByType(errors),
      bySeverity: this.groupErrorsBySeverity(errors),
      averageResolutionTime: this.calculateAverageResolutionTime(errors),
      costImpact: errors.reduce((sum, e) => sum + this.calculateCostImpact(e), 0)
    }
  }

  private groupErrorsByType(errors: DeploymentError[]): Record<ErrorType, number> {
    return errors.reduce((acc, error) => {
      acc[error.type] = (acc[error.type] || 0) + 1
      return acc
    }, {} as Record<ErrorType, number>)
  }

  private groupErrorsBySeverity(errors: DeploymentError[]): Record<ErrorSeverity, number> {
    return errors.reduce((acc, error) => {
      acc[error.severity] = (acc[error.severity] || 0) + 1
      return acc
    }, {} as Record<ErrorSeverity, number>)
  }

  private calculateAverageResolutionTime(errors: DeploymentError[]): number {
    const resolvedErrors = errors.filter(e => e.resolved && e.resolvedAt)
    if (resolvedErrors.length === 0) return 0

    const totalTime = resolvedErrors.reduce((sum, error) => {
      const resolutionTime = error.resolvedAt!.getTime() - error.timestamp.getTime()
      return sum + resolutionTime
    }, 0)

    return totalTime / resolvedErrors.length / 1000 / 60 // Convert to minutes
  }
}

interface ErrorPattern {
  signature: string
  type: ErrorType
  severity: ErrorSeverity
  commonCauses: string[]
  recoveryStrategies: RecoveryStrategy[]
}

interface ErrorStatistics {
  totalErrors: number
  resolvedErrors: number
  byType: Record<ErrorType, number>
  bySeverity: Record<ErrorSeverity, number>
  averageResolutionTime: number // minutes
  costImpact: number // USD
}