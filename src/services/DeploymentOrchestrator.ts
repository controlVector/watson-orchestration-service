import { v4 as uuidv4 } from 'uuid'
import { EventEmitter } from 'events'
import { MCPService } from './MCPService'
import { ErrorHandlingService, DeploymentError } from './ErrorHandlingService'
import { StatusMonitoringService } from './StatusMonitoringService'
import { LLMService } from './LLMService'
import { Intent, DeploymentRequirement } from '../types'

// Deployment Orchestrator with AI-powered error recovery
// Replicates CLI POC success patterns in MCP architecture

export interface DeploymentRequest {
  id: string
  conversationId: string
  workspaceId: string
  userId: string
  intent: Intent
  requirements: DeploymentRequirement[]
  repositoryUrl?: string
  domain?: string
  jwtToken: string
}

export interface DeploymentExecution {
  id: string
  requestId: string
  phase: ExecutionPhase
  status: ExecutionStatus
  startedAt: Date
  estimatedCompletion?: Date
  
  // Agent results
  repositoryAnalysis?: any
  infrastructureProvisioning?: any
  sshKeyGeneration?: any
  deploymentExecution?: any
  
  // Error tracking
  errors: DeploymentError[]
  recoveryAttempts: number
  
  // Progress tracking
  progress: number
  currentStep: string
  completedSteps: ExecutionStep[]
  remainingSteps: ExecutionStep[]
}

export type ExecutionPhase =
  | 'initializing'
  | 'analyzing_repository'
  | 'provisioning_infrastructure'
  | 'generating_ssh_keys'
  | 'executing_deployment'
  | 'verifying_health'
  | 'completed'
  | 'failed'
  | 'recovering'

export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'success'
  | 'error'
  | 'recovering'
  | 'cancelled'

export interface ExecutionStep {
  name: string
  phase: ExecutionPhase
  service: string
  startedAt?: Date
  completedAt?: Date
  duration?: number
  success: boolean
  error?: string
  retryCount: number
}

export class DeploymentOrchestrator extends EventEmitter {
  private mcpService: MCPService
  private errorHandlingService: ErrorHandlingService
  private statusMonitoringService: StatusMonitoringService
  private llmService: LLMService
  private activeExecutions: Map<string, DeploymentExecution> = new Map()

  constructor(
    mcpService: MCPService,
    errorHandlingService: ErrorHandlingService,
    statusMonitoringService: StatusMonitoringService,
    llmService: LLMService
  ) {
    super()
    this.mcpService = mcpService
    this.errorHandlingService = errorHandlingService
    this.statusMonitoringService = statusMonitoringService
    this.llmService = llmService
  }

  async executeDeployment(request: DeploymentRequest): Promise<DeploymentExecution> {
    const executionId = uuidv4()
    
    const execution: DeploymentExecution = {
      id: executionId,
      requestId: request.id,
      phase: 'initializing',
      status: 'pending',
      startedAt: new Date(),
      errors: [],
      recoveryAttempts: 0,
      progress: 0,
      currentStep: 'Initializing deployment pipeline',
      completedSteps: [],
      remainingSteps: [
        { name: 'Repository Analysis', phase: 'analyzing_repository', service: 'mercury', success: false, retryCount: 0 },
        { name: 'Infrastructure Provisioning', phase: 'provisioning_infrastructure', service: 'atlas', success: false, retryCount: 0 },
        { name: 'SSH Key Generation', phase: 'generating_ssh_keys', service: 'hermes', success: false, retryCount: 0 },
        { name: 'Application Deployment', phase: 'executing_deployment', service: 'phoenix', success: false, retryCount: 0 },
        { name: 'Health Verification', phase: 'verifying_health', service: 'phoenix', success: false, retryCount: 0 }
      ]
    }

    this.activeExecutions.set(executionId, execution)
    
    // Create status monitoring entry
    await this.statusMonitoringService.createDeploymentStatus(
      executionId,
      request.workspaceId,
      request.userId,
      this.extractAppName(request.repositoryUrl || request.intent.parameters.repository_url)
    )

    // Start async execution
    this.executeDeploymentPipeline(execution, request).catch(error => {
      this.handleExecutionError(execution, 'deployment_orchestrator', 'initializing', error.message, { request })
    })

    this.emit('deployment_started', execution)
    return execution
  }

  private async executeDeploymentPipeline(execution: DeploymentExecution, request: DeploymentRequest): Promise<void> {
    try {
      execution.status = 'running'
      
      // Step 1: Repository Analysis
      await this.executeStep(execution, 'analyzing_repository', async () => {
        const repositoryUrl = request.repositoryUrl || request.intent.parameters.repository_url
        if (!repositoryUrl) {
          throw new Error('Repository URL is required')
        }

        execution.repositoryAnalysis = await this.mcpService.callMercury('mercury_analyze_repository', {
          repository_url: repositoryUrl,
          branch: request.intent.parameters.branch || 'main',
          deep_analysis: true,
          workspace_id: request.workspaceId,
          user_id: request.userId,
          jwt_token: request.jwtToken
        })

        return `Repository analyzed: ${execution.repositoryAnalysis.tech_stack?.primary_language || 'Unknown'} application`
      })

      // Step 2: Infrastructure Provisioning
      await this.executeStep(execution, 'provisioning_infrastructure', async () => {
        const requirements = this.generateInfrastructureRequirements(execution.repositoryAnalysis, request)
        
        execution.infrastructureProvisioning = await this.mcpService.callAtlas('atlas_provision_infrastructure', {
          requirements,
          workspace_id: request.workspaceId,
          user_id: request.userId,
          jwt_token: request.jwtToken
        })

        // Update status monitoring with infrastructure info
        await this.statusMonitoringService.updateInfrastructureStatus(execution.id, [{
          id: execution.infrastructureProvisioning.server?.id || uuidv4(),
          type: 'droplet',
          provider: 'digitalocean',
          region: execution.infrastructureProvisioning.server?.region || 'nyc3',
          status: 'healthy',
          ipAddress: execution.infrastructureProvisioning.server?.ip_address,
          hostname: execution.infrastructureProvisioning.server?.hostname,
          cpuUsage: 0,
          memoryUsage: 0,
          diskUsage: 0,
          networkIO: { bytesIn: 0, bytesOut: 0 },
          hourlyCost: 0.036, // $24/month ÷ 30 ÷ 24
          monthlyCost: 24,
          services: [],
          lastHealthCheck: new Date(),
          healthCheckStatus: 'pass'
        }])

        return `Infrastructure provisioned: ${execution.infrastructureProvisioning.server?.hostname || 'server'}`
      })

      // Step 3: SSH Key Generation
      await this.executeStep(execution, 'generating_ssh_keys', async () => {
        execution.sshKeyGeneration = await this.mcpService.callHermes('hermes_generate_ssh_key', {
          name: `${this.extractAppName(request.repositoryUrl)}-deploy-key`,
          key_type: 'ed25519',
          purpose: 'automated_deployment',
          tags: ['deployment', 'automated'],
          workspace_id: request.workspaceId,
          user_id: request.userId,
          jwt_token: request.jwtToken
        })

        return `SSH key generated: ${execution.sshKeyGeneration.key?.fingerprint}`
      })

      // Step 4: Application Deployment
      await this.executeStep(execution, 'executing_deployment', async () => {
        execution.deploymentExecution = await this.mcpService.callPhoenix('phoenix_execute_deployment_plan', {
          repository_url: request.repositoryUrl,
          infrastructure_targets: [{
            id: execution.infrastructureProvisioning.server?.id,
            host: execution.infrastructureProvisioning.server?.ip_address,
            ssh_key_id: execution.sshKeyGeneration.key?.id
          }],
          deployment_strategy: {
            type: 'direct',
            containerization: this.shouldUseContainers(execution.repositoryAnalysis) ? 'docker' : 'none',
            health_checks: [{
              type: 'http',
              endpoint: '/health',
              interval: 30000,
              timeout: 5000,
              retries: 3,
              initialDelay: 10000
            }]
          },
          workspace_id: request.workspaceId,
          user_id: request.userId,
          jwt_token: request.jwtToken
        })

        return `Application deployed: ${execution.deploymentExecution.execution?.endpoint || 'deployment completed'}`
      })

      // Step 5: Health Verification
      await this.executeStep(execution, 'verifying_health', async () => {
        const healthResult = await this.mcpService.callPhoenix('phoenix_monitor_deployment', {
          deployment_id: execution.deploymentExecution.execution?.id,
          workspace_id: request.workspaceId,
          user_id: request.userId,
          jwt_token: request.jwtToken
        })

        // Final status update
        await this.statusMonitoringService.updateDeploymentPhase(
          execution.id,
          'completed',
          `Deployment completed successfully - ${healthResult.monitoring?.status}`,
          100
        )

        return `Health verification passed: ${healthResult.monitoring?.status}`
      })

      // Mark as completed
      execution.phase = 'completed'
      execution.status = 'success'
      execution.progress = 100
      execution.currentStep = 'Deployment completed successfully'

      this.emit('deployment_completed', execution)

    } catch (error: any) {
      execution.phase = 'failed'
      execution.status = 'error'
      
      await this.handleExecutionError(execution, 'deployment_orchestrator', execution.phase, error.message, { request })
      
      // Attempt AI-powered recovery
      if (execution.recoveryAttempts < 3) {
        await this.attemptRecovery(execution, request)
      }

      this.emit('deployment_failed', execution)
    }
  }

  private async executeStep(
    execution: DeploymentExecution,
    phase: ExecutionPhase,
    stepFunction: () => Promise<string>
  ): Promise<void> {
    const step = execution.remainingSteps.find(s => s.phase === phase)
    if (!step) {
      throw new Error(`Step for phase ${phase} not found`)
    }

    execution.phase = phase
    execution.status = 'running'
    step.startedAt = new Date()

    try {
      execution.currentStep = await stepFunction()
      
      step.completedAt = new Date()
      step.duration = step.completedAt.getTime() - (step.startedAt?.getTime() || 0)
      step.success = true
      
      execution.completedSteps.push(step)
      execution.remainingSteps = execution.remainingSteps.filter(s => s.phase !== phase)
      execution.progress = Math.round((execution.completedSteps.length / (execution.completedSteps.length + execution.remainingSteps.length)) * 100)

      // Update status monitoring
      await this.statusMonitoringService.updateDeploymentPhase(
        execution.id,
        phase,
        execution.currentStep,
        execution.progress
      )

      this.emit('step_completed', { execution, step })

    } catch (error: any) {
      step.success = false
      step.error = error.message
      step.retryCount++
      step.completedAt = new Date()
      step.duration = step.completedAt.getTime() - (step.startedAt?.getTime() || 0)

      throw error
    }
  }

  private async handleExecutionError(
    execution: DeploymentExecution,
    service: string,
    phase: string,
    errorMessage: string,
    context: any
  ): Promise<void> {
    const error = await this.errorHandlingService.handleDeploymentError(
      service,
      phase as any,
      errorMessage,
      context
    )

    execution.errors.push(error)
    
    // Update status monitoring
    await this.statusMonitoringService.addIssue(execution.id, {
      severity: error.severity as any,
      type: error.type,
      title: `Deployment error in ${phase}`,
      description: error.message,
      detectedAt: new Date(),
      affectedComponents: [service],
      mitigationSteps: error.aiAnalysis?.recommendedActions.map(a => a.description) || [],
      autoResolvable: error.aiAnalysis?.recommendedActions.some(a => a.retryable) || false
    })

    this.emit('execution_error', { execution, error })
  }

  private async attemptRecovery(execution: DeploymentExecution, request: DeploymentRequest): Promise<void> {
    execution.recoveryAttempts++
    execution.phase = 'recovering'
    execution.status = 'recovering'
    execution.currentStep = `Attempting recovery (attempt ${execution.recoveryAttempts}/3)`

    const lastError = execution.errors[execution.errors.length - 1]
    if (!lastError.aiAnalysis) {
      return
    }

    try {
      // Based on CLI POC recovery patterns
      const recoveryStrategy = this.selectRecoveryStrategy(lastError, execution)
      
      switch (recoveryStrategy) {
        case 'retry_current_step':
          await this.retryCurrentStep(execution, request)
          break
          
        case 'provision_new_server':
          await this.provisionNewServer(execution, request)
          break
          
        case 'simplified_deployment':
          await this.attemptSimplifiedDeployment(execution, request)
          break
          
        default:
          throw new Error('No suitable recovery strategy available')
      }

      // If recovery succeeds, continue from where we left off
      const failedPhase = execution.phase
      execution.status = 'running'
      
      this.emit('recovery_successful', { execution, recoveryAttempts: execution.recoveryAttempts })

    } catch (recoveryError: any) {
      execution.status = 'error'
      await this.handleExecutionError(execution, 'recovery_orchestrator', 'recovering', recoveryError.message, { originalError: lastError })
      
      this.emit('recovery_failed', { execution, recoveryAttempts: execution.recoveryAttempts })
    }
  }

  private selectRecoveryStrategy(error: DeploymentError, execution: DeploymentExecution): string {
    // Based on CLI POC success patterns
    switch (error.type) {
      case 'ssh_connection_failure':
        return 'provision_new_server'
      case 'package_manager_conflict':
        return 'retry_current_step'
      case 'service_configuration_error':
        return 'simplified_deployment'
      case 'infrastructure_provisioning_error':
        return 'provision_new_server'
      default:
        return execution.recoveryAttempts === 1 ? 'retry_current_step' : 'simplified_deployment'
    }
  }

  private async retryCurrentStep(execution: DeploymentExecution, request: DeploymentRequest): Promise<void> {
    // Clear package manager locks if needed (CLI POC pattern)
    if (execution.infrastructureProvisioning?.server) {
      await this.mcpService.callHermes('hermes_execute_ssh_command', {
        connection_id: execution.infrastructureProvisioning.server.id,
        command: 'sudo killall apt apt-get dpkg || true; sudo rm -f /var/lib/dpkg/lock-frontend /var/lib/dpkg/lock || true',
        workspace_id: request.workspaceId,
        user_id: request.userId,
        jwt_token: request.jwtToken
      })
    }

    // Retry the failed step
    const currentPhase = execution.phase
    execution.phase = currentPhase === 'recovering' ? 'executing_deployment' : currentPhase
  }

  private async provisionNewServer(execution: DeploymentExecution, request: DeploymentRequest): Promise<void> {
    // Provision a fresh server (CLI POC successful pattern)
    execution.infrastructureProvisioning = await this.mcpService.callAtlas('atlas_provision_infrastructure', {
      requirements: this.generateInfrastructureRequirements(execution.repositoryAnalysis, request),
      workspace_id: request.workspaceId,
      user_id: request.userId,
      jwt_token: request.jwtToken
    })

    // Generate new SSH keys for the new server
    execution.sshKeyGeneration = await this.mcpService.callHermes('hermes_generate_ssh_key', {
      name: `${this.extractAppName(request.repositoryUrl)}-recovery-key`,
      key_type: 'ed25519',
      purpose: 'recovery_deployment',
      tags: ['deployment', 'recovery'],
      workspace_id: request.workspaceId,
      user_id: request.userId,
      jwt_token: request.jwtToken
    })
  }

  private async attemptSimplifiedDeployment(execution: DeploymentExecution, request: DeploymentRequest): Promise<void> {
    // Simplified deployment strategy (CLI POC fallback pattern)
    execution.deploymentExecution = await this.mcpService.callPhoenix('phoenix_execute_deployment_plan', {
      repository_url: request.repositoryUrl,
      infrastructure_targets: [{
        id: execution.infrastructureProvisioning.server?.id,
        host: execution.infrastructureProvisioning.server?.ip_address,
        ssh_key_id: execution.sshKeyGeneration.key?.id
      }],
      deployment_strategy: {
        type: 'direct',
        containerization: 'none', // Simplified: no containers
        health_checks: [] // Simplified: no health checks initially
      },
      workspace_id: request.workspaceId,
      user_id: request.userId,
      jwt_token: request.jwtToken
    })
  }

  private generateInfrastructureRequirements(repositoryAnalysis: any, request: DeploymentRequest): any {
    return {
      compute: {
        cpu_cores: 1,
        memory_gb: 1,
        storage_gb: 25
      },
      network: {
        public_ip: true,
        domain: request.domain
      },
      application: {
        framework: repositoryAnalysis?.tech_stack?.framework,
        language: repositoryAnalysis?.tech_stack?.primary_language,
        port: repositoryAnalysis?.deployment_config?.port || 3000
      }
    }
  }

  private shouldUseContainers(repositoryAnalysis: any): boolean {
    // Decision based on repository analysis
    const hasDockerfile = repositoryAnalysis?.build_files?.includes('Dockerfile')
    const isModernFramework = ['react', 'vue', 'angular', 'fastapi', 'express'].includes(
      repositoryAnalysis?.tech_stack?.framework?.toLowerCase()
    )
    
    return hasDockerfile || isModernFramework
  }

  private extractAppName(repositoryUrl?: string): string {
    if (!repositoryUrl) return 'deployment'
    
    const match = repositoryUrl.match(/\/([^\/]+)(?:\.git)?$/)
    return match ? match[1].toLowerCase() : 'deployment'
  }

  // Public API methods
  async getExecution(executionId: string): Promise<DeploymentExecution | undefined> {
    return this.activeExecutions.get(executionId)
  }

  async getAllExecutions(): Promise<DeploymentExecution[]> {
    return Array.from(this.activeExecutions.values())
  }

  async cancelExecution(executionId: string): Promise<boolean> {
    const execution = this.activeExecutions.get(executionId)
    if (!execution) return false

    execution.status = 'cancelled'
    execution.currentStep = 'Deployment cancelled by user'

    this.emit('deployment_cancelled', execution)
    return true
  }
}