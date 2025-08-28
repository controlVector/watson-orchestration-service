import { v4 as uuidv4 } from 'uuid'
import { EventEmitter } from 'events'

// Status Monitoring Service for real-time deployment health tracking
// Based on CLI POC monitoring patterns and zombie server prevention

export interface DeploymentStatus {
  id: string
  deploymentId: string
  workspaceId: string
  userId: string
  name: string
  phase: DeploymentPhase
  status: StatusLevel
  startedAt: Date
  lastUpdated: Date
  estimatedCompletion?: Date
  
  // Health metrics
  healthScore: number // 0-100
  uptime: number // seconds
  responseTime?: number // ms
  availability: number // percentage
  
  // Infrastructure details
  infrastructure: InfrastructureStatus[]
  totalMonthlyCost: number
  resourceUtilization: ResourceUtilization
  
  // Status details
  currentStep: string
  completedSteps: string[]
  remainingSteps: string[]
  progress: number // 0-100 percentage
  
  // Issues and alerts
  activeIssues: StatusIssue[]
  warnings: StatusWarning[]
  
  // Historical data
  statusHistory: StatusHistoryEntry[]
}

export type StatusLevel = 
  | 'healthy'           // All systems operational
  | 'warning'           // Minor issues detected
  | 'degraded'          // Partial functionality
  | 'critical'          // Major issues, service impacted
  | 'failed'            // Deployment failed
  | 'unknown'           // Status cannot be determined

export type DeploymentPhase =
  | 'initializing'
  | 'analyzing_repository'
  | 'provisioning_infrastructure'
  | 'configuring_ssh'
  | 'deploying_application'
  | 'configuring_services'
  | 'setting_up_dns'
  | 'configuring_ssl'
  | 'running_health_checks'
  | 'completed'
  | 'failed'
  | 'rolled_back'

export interface InfrastructureStatus {
  id: string
  type: 'droplet' | 'database' | 'load_balancer' | 'cdn'
  provider: string
  region: string
  status: StatusLevel
  
  // Connection info
  ipAddress?: string
  hostname?: string
  port?: number
  
  // Health metrics
  cpuUsage: number
  memoryUsage: number
  diskUsage: number
  networkIO: {
    bytesIn: number
    bytesOut: number
  }
  
  // Cost tracking
  hourlyCost: number
  monthlyCost: number
  
  // Service status
  services: ServiceStatus[]
  
  // Last health check
  lastHealthCheck: Date
  healthCheckStatus: 'pass' | 'fail' | 'timeout'
  healthCheckDetails?: string
}

export interface ServiceStatus {
  name: string
  status: 'running' | 'stopped' | 'failed' | 'unknown'
  port?: number
  processId?: number
  uptime: number
  restartCount: number
  lastRestart?: Date
  logs: string[]
}

export interface ResourceUtilization {
  cpu: {
    current: number
    average: number
    peak: number
  }
  memory: {
    current: number
    available: number
    percentage: number
  }
  storage: {
    used: number
    total: number
    percentage: number
  }
  network: {
    bandwidth: number
    connections: number
    latency: number
  }
}

export interface StatusIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  type: string
  title: string
  description: string
  detectedAt: Date
  affectedComponents: string[]
  estimatedResolution?: string
  mitigationSteps: string[]
  autoResolvable: boolean
}

export interface StatusWarning {
  id: string
  type: 'performance' | 'cost' | 'security' | 'configuration'
  message: string
  recommendation: string
  impact: 'low' | 'medium' | 'high'
  detectedAt: Date
}

export interface StatusHistoryEntry {
  timestamp: Date
  phase: DeploymentPhase
  status: StatusLevel
  details: string
  metrics?: {
    responseTime: number
    errorRate: number
    throughput: number
  }
}

export interface ZombieServerCandidate {
  serverId: string
  deploymentId: string
  createdAt: Date
  lastActivity: Date
  monthlyCost: number
  reason: 'deployment_failed' | 'deployment_abandoned' | 'duplicate_deployment' | 'test_server'
  confidence: number // 0-1
  recommendation: 'terminate' | 'investigate' | 'keep'
}

export interface StatusSummary {
  totalDeployments: number
  healthyDeployments: number
  degradedDeployments: number
  failedDeployments: number
  totalMonthlyCost: number
  averageHealthScore: number
  zombieServerCount: number
  potentialSavings: number
}

export class StatusMonitoringService extends EventEmitter {
  private deploymentStatuses: Map<string, DeploymentStatus> = new Map()
  private monitoringInterval: NodeJS.Timeout | null = null
  private healthCheckInterval = 60000 // 1 minute
  private zombieDetectionInterval = 300000 // 5 minutes

  constructor() {
    super()
    this.startMonitoring()
  }

  private startMonitoring(): void {
    // Regular health checks
    this.monitoringInterval = setInterval(() => {
      this.performHealthChecks()
    }, this.healthCheckInterval)

    // Zombie server detection
    setInterval(() => {
      this.detectZombieServers()
    }, this.zombieDetectionInterval)
  }

  async createDeploymentStatus(
    deploymentId: string,
    workspaceId: string,
    userId: string,
    name: string
  ): Promise<DeploymentStatus> {
    const status: DeploymentStatus = {
      id: uuidv4(),
      deploymentId,
      workspaceId,
      userId,
      name,
      phase: 'initializing',
      status: 'unknown',
      startedAt: new Date(),
      lastUpdated: new Date(),
      healthScore: 100,
      uptime: 0,
      availability: 100,
      infrastructure: [],
      totalMonthlyCost: 0,
      resourceUtilization: {
        cpu: { current: 0, average: 0, peak: 0 },
        memory: { current: 0, available: 0, percentage: 0 },
        storage: { used: 0, total: 0, percentage: 0 },
        network: { bandwidth: 0, connections: 0, latency: 0 }
      },
      currentStep: 'Initializing deployment',
      completedSteps: [],
      remainingSteps: [
        'Repository Analysis',
        'Infrastructure Provisioning',
        'SSH Configuration',
        'Application Deployment',
        'Service Configuration',
        'DNS Setup',
        'SSL Configuration',
        'Health Verification'
      ],
      progress: 0,
      activeIssues: [],
      warnings: [],
      statusHistory: [{
        timestamp: new Date(),
        phase: 'initializing',
        status: 'unknown',
        details: 'Deployment initiated'
      }]
    }

    this.deploymentStatuses.set(deploymentId, status)
    this.emit('deployment_created', status)
    
    return status
  }

  async updateDeploymentPhase(
    deploymentId: string,
    phase: DeploymentPhase,
    stepDetails: string,
    progress?: number
  ): Promise<void> {
    const status = this.deploymentStatuses.get(deploymentId)
    if (!status) return

    const previousPhase = status.phase
    status.phase = phase
    status.currentStep = stepDetails
    status.lastUpdated = new Date()
    
    if (progress !== undefined) {
      status.progress = Math.max(0, Math.min(100, progress))
    }

    // Update completed steps
    if (previousPhase !== phase) {
      const phaseStepMap: Record<DeploymentPhase, string> = {
        'initializing': 'Initialization',
        'analyzing_repository': 'Repository Analysis',
        'provisioning_infrastructure': 'Infrastructure Provisioning',
        'configuring_ssh': 'SSH Configuration',
        'deploying_application': 'Application Deployment',
        'configuring_services': 'Service Configuration',
        'setting_up_dns': 'DNS Setup',
        'configuring_ssl': 'SSL Configuration',
        'running_health_checks': 'Health Verification',
        'completed': 'Deployment Complete',
        'failed': 'Deployment Failed',
        'rolled_back': 'Deployment Rolled Back'
      }

      const completedStep = phaseStepMap[previousPhase]
      if (completedStep && !status.completedSteps.includes(completedStep)) {
        status.completedSteps.push(completedStep)
        status.remainingSteps = status.remainingSteps.filter(step => step !== completedStep)
      }
    }

    // Add to history
    status.statusHistory.push({
      timestamp: new Date(),
      phase,
      status: status.status,
      details: stepDetails
    })

    // Emit update event
    this.emit('deployment_updated', status)
    this.emit(`deployment_${deploymentId}_updated`, status)
  }

  async updateInfrastructureStatus(
    deploymentId: string,
    infrastructureStatuses: InfrastructureStatus[]
  ): Promise<void> {
    const status = this.deploymentStatuses.get(deploymentId)
    if (!status) return

    status.infrastructure = infrastructureStatuses
    status.totalMonthlyCost = infrastructureStatuses.reduce((sum, infra) => sum + infra.monthlyCost, 0)
    status.lastUpdated = new Date()

    // Calculate overall health score
    status.healthScore = this.calculateHealthScore(infrastructureStatuses)
    
    // Update status level based on health
    status.status = this.determineStatusLevel(status.healthScore, status.activeIssues)

    this.emit('infrastructure_updated', { deploymentId, status })
  }

  async addIssue(deploymentId: string, issue: Omit<StatusIssue, 'id'>): Promise<void> {
    const status = this.deploymentStatuses.get(deploymentId)
    if (!status) return

    const fullIssue: StatusIssue = {
      id: uuidv4(),
      ...issue
    }

    status.activeIssues.push(fullIssue)
    status.lastUpdated = new Date()

    // Recalculate status
    status.status = this.determineStatusLevel(status.healthScore, status.activeIssues)

    this.emit('issue_detected', { deploymentId, issue: fullIssue })
  }

  async resolveIssue(deploymentId: string, issueId: string): Promise<void> {
    const status = this.deploymentStatuses.get(deploymentId)
    if (!status) return

    status.activeIssues = status.activeIssues.filter(issue => issue.id !== issueId)
    status.lastUpdated = new Date()

    // Recalculate status
    status.status = this.determineStatusLevel(status.healthScore, status.activeIssues)

    this.emit('issue_resolved', { deploymentId, issueId })
  }

  async addWarning(deploymentId: string, warning: Omit<StatusWarning, 'id'>): Promise<void> {
    const status = this.deploymentStatuses.get(deploymentId)
    if (!status) return

    const fullWarning: StatusWarning = {
      id: uuidv4(),
      ...warning
    }

    status.warnings.push(fullWarning)
    status.lastUpdated = new Date()

    this.emit('warning_added', { deploymentId, warning: fullWarning })
  }

  private async performHealthChecks(): Promise<void> {
    for (const [deploymentId, status] of Array.from(this.deploymentStatuses.entries())) {
      if (status.phase === 'completed' || status.phase === 'failed') {
        continue
      }

      try {
        await this.checkDeploymentHealth(deploymentId)
      } catch (error) {
        console.warn(`Health check failed for ${deploymentId}:`, error)
      }
    }
  }

  private async checkDeploymentHealth(deploymentId: string): Promise<void> {
    const status = this.deploymentStatuses.get(deploymentId)
    if (!status) return

    // Update uptime
    status.uptime = Math.floor((Date.now() - status.startedAt.getTime()) / 1000)

    // Check infrastructure health
    for (const infra of status.infrastructure) {
      const healthResult = await this.checkInfrastructureHealth(infra)
      infra.lastHealthCheck = new Date()
      infra.healthCheckStatus = healthResult.status
      infra.healthCheckDetails = healthResult.details

      if (healthResult.status === 'fail') {
        await this.addIssue(deploymentId, {
          severity: 'high',
          type: 'infrastructure_health',
          title: `Infrastructure health check failed: ${infra.id}`,
          description: healthResult.details || 'Health check returned failure',
          detectedAt: new Date(),
          affectedComponents: [infra.id],
          mitigationSteps: ['Restart services', 'Check system resources', 'Verify network connectivity'],
          autoResolvable: true
        })
      }
    }

    // Emit health check completed
    this.emit('health_check_completed', { deploymentId, status })
  }

  private async checkInfrastructureHealth(infra: InfrastructureStatus): Promise<{ status: 'pass' | 'fail' | 'timeout'; details?: string }> {
    try {
      // This would integrate with actual health check endpoints
      // For now, simulate based on service status
      const hasFailedServices = infra.services.some(service => service.status === 'failed')
      const highResourceUsage = infra.cpuUsage > 90 || infra.memoryUsage > 95 || infra.diskUsage > 90
      
      if (hasFailedServices) {
        return { status: 'fail', details: 'One or more services are not running' }
      }
      
      if (highResourceUsage) {
        return { status: 'fail', details: 'High resource utilization detected' }
      }

      return { status: 'pass' }
    } catch (error: any) {
      return { status: 'timeout', details: error.message }
    }
  }

  private async detectZombieServers(): Promise<void> {
    const candidates: ZombieServerCandidate[] = []
    const now = Date.now()
    
    for (const [deploymentId, status] of Array.from(this.deploymentStatuses.entries())) {
      // Check for failed deployments with running infrastructure
      if (status.phase === 'failed' && status.infrastructure.length > 0) {
        const timeSinceFailure = now - status.lastUpdated.getTime()
        
        if (timeSinceFailure > 3600000) { // 1 hour
          for (const infra of status.infrastructure) {
            candidates.push({
              serverId: infra.id,
              deploymentId,
              createdAt: status.startedAt,
              lastActivity: status.lastUpdated,
              monthlyCost: infra.monthlyCost,
              reason: 'deployment_failed',
              confidence: 0.9,
              recommendation: 'terminate'
            })
          }
        }
      }
      
      // Check for abandoned deployments
      const timeSinceUpdate = now - status.lastUpdated.getTime()
      if (timeSinceUpdate > 7200000 && status.phase !== 'completed') { // 2 hours
        for (const infra of status.infrastructure) {
          candidates.push({
            serverId: infra.id,
            deploymentId,
            createdAt: status.startedAt,
            lastActivity: status.lastUpdated,
            monthlyCost: infra.monthlyCost,
            reason: 'deployment_abandoned',
            confidence: 0.7,
            recommendation: 'investigate'
          })
        }
      }
    }

    if (candidates.length > 0) {
      this.emit('zombie_servers_detected', candidates)
    }
  }

  private calculateHealthScore(infrastructureStatuses: InfrastructureStatus[]): number {
    if (infrastructureStatuses.length === 0) return 100

    let totalScore = 0
    let totalWeight = 0

    for (const infra of infrastructureStatuses) {
      let infraScore = 100

      // Deduct points for high resource usage
      if (infra.cpuUsage > 80) infraScore -= (infra.cpuUsage - 80) * 2
      if (infra.memoryUsage > 85) infraScore -= (infra.memoryUsage - 85) * 3
      if (infra.diskUsage > 90) infraScore -= (infra.diskUsage - 90) * 5

      // Deduct points for failed services
      const failedServices = infra.services.filter(s => s.status === 'failed').length
      infraScore -= failedServices * 15

      // Deduct points for failed health checks
      if (infra.healthCheckStatus === 'fail') infraScore -= 20
      if (infra.healthCheckStatus === 'timeout') infraScore -= 10

      totalScore += Math.max(0, infraScore)
      totalWeight += 1
    }

    return Math.round(totalScore / totalWeight)
  }

  private determineStatusLevel(healthScore: number, activeIssues: StatusIssue[]): StatusLevel {
    const criticalIssues = activeIssues.filter(i => i.severity === 'critical').length
    const highIssues = activeIssues.filter(i => i.severity === 'high').length
    
    if (criticalIssues > 0 || healthScore < 30) return 'critical'
    if (highIssues > 0 || healthScore < 60) return 'degraded'
    if (activeIssues.length > 0 || healthScore < 85) return 'warning'
    
    return 'healthy'
  }

  // Public API methods
  async getDeploymentStatus(deploymentId: string): Promise<DeploymentStatus | undefined> {
    return this.deploymentStatuses.get(deploymentId)
  }

  async getAllStatuses(workspaceId?: string, userId?: string): Promise<DeploymentStatus[]> {
    const statuses = Array.from(this.deploymentStatuses.values())
    
    return statuses.filter(status => {
      if (workspaceId && status.workspaceId !== workspaceId) return false
      if (userId && status.userId !== userId) return false
      return true
    })
  }

  async getStatusSummary(workspaceId?: string, userId?: string): Promise<StatusSummary> {
    const statuses = await this.getAllStatuses(workspaceId, userId)
    
    const healthyCount = statuses.filter(s => s.status === 'healthy').length
    const degradedCount = statuses.filter(s => s.status === 'degraded' || s.status === 'warning').length
    const failedCount = statuses.filter(s => s.status === 'critical' || s.status === 'failed').length
    
    const totalCost = statuses.reduce((sum, s) => sum + s.totalMonthlyCost, 0)
    const avgHealthScore = statuses.length > 0 
      ? statuses.reduce((sum, s) => sum + s.healthScore, 0) / statuses.length 
      : 100

    // Estimate zombie servers
    const zombieCount = statuses.filter(s => 
      s.phase === 'failed' && s.infrastructure.length > 0
    ).reduce((sum, s) => sum + s.infrastructure.length, 0)
    
    const potentialSavings = zombieCount * 24 // Estimate $24/month per zombie server

    return {
      totalDeployments: statuses.length,
      healthyDeployments: healthyCount,
      degradedDeployments: degradedCount,
      failedDeployments: failedCount,
      totalMonthlyCost: totalCost,
      averageHealthScore: Math.round(avgHealthScore),
      zombieServerCount: zombieCount,
      potentialSavings
    }
  }

  async getZombieServerCandidates(): Promise<ZombieServerCandidate[]> {
    // Trigger immediate zombie detection
    await this.detectZombieServers()
    
    // Return recent candidates (this would be stored in a more persistent way in production)
    return []
  }

  destroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval)
      this.monitoringInterval = null
    }
    this.removeAllListeners()
  }
}