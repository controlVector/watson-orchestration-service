import axios from 'axios'
import { FastifyBaseLogger } from 'fastify'
import dns from 'dns'
import { promisify } from 'util'

const resolveDns = promisify(dns.resolve4)

export interface DeploymentCheck {
  name: string
  status: 'pending' | 'checking' | 'passed' | 'failed'
  message: string
  details?: any
  severity: 'critical' | 'warning' | 'info'
}

export interface DeploymentValidation {
  deploymentId: string
  timestamp: Date
  overallStatus: 'success' | 'partial' | 'failed'
  checks: DeploymentCheck[]
  remediationSteps?: string[]
  score: {
    passed: number
    total: number
    percentage: number
  }
}

export interface DeploymentTarget {
  ip: string
  domain?: string
  port?: number
  expectedService: string
  dropletId?: string
  provider?: string
}

/**
 * Self-Assessment Service for Watson
 * Provides physical verification of deployments and self-healing capabilities
 */
export class SelfAssessmentService {
  private logger: FastifyBaseLogger

  constructor(logger: FastifyBaseLogger) {
    this.logger = logger
  }

  /**
   * Perform comprehensive deployment validation
   */
  async validateDeployment(target: DeploymentTarget): Promise<DeploymentValidation> {
    const deploymentId = `validation-${Date.now()}`
    const checks: DeploymentCheck[] = []
    
    this.logger.info(`Starting self-assessment for ${target.ip}`)

    // 1. Check HTTP Service
    checks.push(await this.checkHttpService(target))
    
    // 2. Check HTTPS Service
    checks.push(await this.checkHttpsService(target))
    
    // 3. Check DNS Configuration
    if (target.domain) {
      checks.push(await this.checkDnsConfiguration(target))
    }
    
    // 4. Check Application Health
    checks.push(await this.checkApplicationHealth(target))
    
    // 5. Check Expected Content
    checks.push(await this.checkExpectedContent(target))
    
    // 6. Check API Endpoints
    checks.push(await this.checkApiEndpoints(target))
    
    // Calculate score
    const passed = checks.filter(c => c.status === 'passed').length
    const total = checks.length
    const percentage = Math.round((passed / total) * 100)
    
    // Determine overall status
    let overallStatus: 'success' | 'partial' | 'failed' = 'failed'
    if (percentage >= 80) {
      overallStatus = 'success'
    } else if (percentage >= 40) {
      overallStatus = 'partial'
    }
    
    // Generate remediation steps if needed
    const remediationSteps = this.generateRemediationSteps(checks, target)
    
    return {
      deploymentId,
      timestamp: new Date(),
      overallStatus,
      checks,
      remediationSteps,
      score: {
        passed,
        total,
        percentage
      }
    }
  }

  /**
   * Check if HTTP service is accessible
   */
  private async checkHttpService(target: DeploymentTarget): Promise<DeploymentCheck> {
    const check: DeploymentCheck = {
      name: 'HTTP Service',
      status: 'checking',
      message: 'Checking HTTP connectivity...',
      severity: 'critical'
    }

    try {
      const response = await axios.get(`http://${target.ip}:${target.port || 80}`, {
        timeout: 5000,
        validateStatus: () => true,
        maxRedirects: 0
      })

      if (response.status === 200 || response.status === 301 || response.status === 302) {
        check.status = 'passed'
        check.message = `HTTP service responding (status: ${response.status})`
        check.details = {
          status: response.status,
          server: response.headers.server,
          contentLength: response.headers['content-length']
        }
      } else {
        check.status = 'failed'
        check.message = `Unexpected HTTP status: ${response.status}`
        check.details = { status: response.status }
      }
    } catch (error: any) {
      check.status = 'failed'
      check.message = `HTTP service unreachable: ${error.message}`
      check.details = { error: error.code || error.message }
    }

    return check
  }

  /**
   * Check if HTTPS service is configured
   */
  private async checkHttpsService(target: DeploymentTarget): Promise<DeploymentCheck> {
    const check: DeploymentCheck = {
      name: 'HTTPS/SSL',
      status: 'checking',
      message: 'Checking HTTPS connectivity...',
      severity: 'warning'
    }

    try {
      const https = require('https')
      const agent = new https.Agent({
        rejectUnauthorized: false // Accept self-signed certs
      })

      const response = await axios.get(`https://${target.ip}:${443}`, {
        timeout: 5000,
        validateStatus: () => true,
        httpsAgent: agent,
        maxRedirects: 0
      })

      check.status = 'passed'
      check.message = `HTTPS service available (status: ${response.status})`
      check.details = {
        status: response.status,
        hasSSL: true
      }
    } catch (error: any) {
      check.status = 'failed'
      check.message = 'HTTPS not configured'
      check.details = { error: error.code || error.message }
    }

    return check
  }

  /**
   * Check DNS configuration
   */
  private async checkDnsConfiguration(target: DeploymentTarget): Promise<DeploymentCheck> {
    if (!target.domain) {
      return {
        name: 'DNS Configuration',
        status: 'passed',
        message: 'No domain to check',
        severity: 'info'
      }
    }

    const check: DeploymentCheck = {
      name: 'DNS Configuration',
      status: 'checking',
      message: `Checking DNS for ${target.domain}...`,
      severity: 'warning'
    }

    try {
      const addresses = await resolveDns(target.domain)
      
      if (addresses.includes(target.ip)) {
        check.status = 'passed'
        check.message = `DNS correctly points to ${target.ip}`
        check.details = { resolvedAddresses: addresses }
      } else {
        check.status = 'failed'
        check.message = `DNS points to wrong IP: ${addresses.join(', ')}`
        check.details = { 
          expected: target.ip,
          actual: addresses
        }
      }
    } catch (error: any) {
      check.status = 'failed'
      check.message = 'DNS not configured'
      check.details = { error: error.code || error.message }
    }

    return check
  }

  /**
   * Check if the application is actually running
   */
  private async checkApplicationHealth(target: DeploymentTarget): Promise<DeploymentCheck> {
    const check: DeploymentCheck = {
      name: 'Application Health',
      status: 'checking',
      message: 'Checking application status...',
      severity: 'critical'
    }

    try {
      // Try common health endpoints
      const healthEndpoints = ['/health', '/api/health', '/status', '/_health']
      
      for (const endpoint of healthEndpoints) {
        try {
          const response = await axios.get(`http://${target.ip}${endpoint}`, {
            timeout: 3000,
            validateStatus: () => true
          })
          
          if (response.status === 200) {
            check.status = 'passed'
            check.message = `Health endpoint responding at ${endpoint}`
            check.details = { 
              endpoint,
              status: response.status,
              data: response.data
            }
            return check
          }
        } catch (e) {
          // Continue to next endpoint
        }
      }
      
      // No health endpoint found
      check.status = 'failed'
      check.message = 'No health endpoint found'
      check.severity = 'warning' // Downgrade since app might still work
      
    } catch (error: any) {
      check.status = 'failed'
      check.message = `Health check failed: ${error.message}`
    }

    return check
  }

  /**
   * Check if expected content is present
   */
  private async checkExpectedContent(target: DeploymentTarget): Promise<DeploymentCheck> {
    const check: DeploymentCheck = {
      name: 'Expected Content',
      status: 'checking',
      message: 'Verifying application content...',
      severity: 'critical'
    }

    try {
      const response = await axios.get(`http://${target.ip}`, {
        timeout: 5000,
        validateStatus: () => true
      })
      
      const content = response.data.toString().toLowerCase()
      
      // Check for default pages (bad)
      if (content.includes('welcome to nginx')) {
        check.status = 'failed'
        check.message = 'Nginx default page detected - application NOT deployed'
        check.details = { 
          detected: 'nginx-default',
          applicationDeployed: false
        }
      }
      // Check for expected service name
      else if (content.includes(target.expectedService.toLowerCase())) {
        check.status = 'passed'
        check.message = `${target.expectedService} application detected`
        check.details = { 
          detected: target.expectedService,
          applicationDeployed: true
        }
      }
      // Unknown content
      else {
        check.status = 'failed'
        check.message = 'Application not detected at root URL'
        check.details = { 
          contentSnippet: content.substring(0, 200)
        }
      }
      
    } catch (error: any) {
      check.status = 'failed'
      check.message = `Content check failed: ${error.message}`
    }

    return check
  }

  /**
   * Check API endpoints
   */
  private async checkApiEndpoints(target: DeploymentTarget): Promise<DeploymentCheck> {
    const check: DeploymentCheck = {
      name: 'API Endpoints',
      status: 'checking',
      message: 'Checking API availability...',
      severity: 'warning'
    }

    const apiEndpoints = ['/api', '/api/v1', '/api/status', '/graphql']
    const workingEndpoints: string[] = []
    
    for (const endpoint of apiEndpoints) {
      try {
        const response = await axios.get(`http://${target.ip}${endpoint}`, {
          timeout: 3000,
          validateStatus: () => true
        })
        
        if (response.status !== 404) {
          workingEndpoints.push(`${endpoint} (${response.status})`)
        }
      } catch (e) {
        // Continue
      }
    }
    
    if (workingEndpoints.length > 0) {
      check.status = 'passed'
      check.message = `Found ${workingEndpoints.length} API endpoint(s)`
      check.details = { endpoints: workingEndpoints }
    } else {
      check.status = 'failed'
      check.message = 'No API endpoints found'
      check.details = { tested: apiEndpoints }
    }

    return check
  }

  /**
   * Generate remediation steps based on failed checks
   */
  private generateRemediationSteps(checks: DeploymentCheck[], target: DeploymentTarget): string[] {
    const steps: string[] = []
    
    // Check for nginx default page
    const contentCheck = checks.find(c => c.name === 'Expected Content')
    if (contentCheck?.details?.detected === 'nginx-default') {
      steps.push(`SSH into server: ssh root@${target.ip}`)
      steps.push('Check cloud-init logs: tail -100 /var/log/cloud-init-output.log')
      steps.push('Clone repository manually: git clone [repository_url]')
      steps.push('Install dependencies: npm install')
      steps.push('Start application: pm2 start npm --name app -- start')
      steps.push('Configure nginx proxy: nano /etc/nginx/sites-available/default')
    }
    
    // Check for DNS issues
    const dnsCheck = checks.find(c => c.name === 'DNS Configuration')
    if (dnsCheck?.status === 'failed' && target.domain) {
      steps.push(`Configure DNS: Add A record for ${target.domain} -> ${target.ip}`)
      steps.push('Wait for DNS propagation (5-30 minutes)')
      steps.push(`Verify DNS: nslookup ${target.domain}`)
    }
    
    // Check for HTTPS issues
    const httpsCheck = checks.find(c => c.name === 'HTTPS/SSL')
    if (httpsCheck?.status === 'failed' && target.domain) {
      steps.push('Install Certbot: apt-get install certbot python3-certbot-nginx')
      steps.push(`Generate SSL certificate: certbot --nginx -d ${target.domain}`)
      steps.push('Test SSL: openssl s_client -connect ' + target.domain + ':443')
    }
    
    // Check for application health
    const healthCheck = checks.find(c => c.name === 'Application Health')
    if (healthCheck?.status === 'failed') {
      steps.push('Check application logs: pm2 logs')
      steps.push('Check application status: pm2 status')
      steps.push('Restart application: pm2 restart all')
      steps.push('Check port binding: netstat -tlnp | grep :3000')
    }
    
    return steps
  }

  /**
   * Attempt automated remediation
   */
  async attemptRemediation(target: DeploymentTarget, validation: DeploymentValidation): Promise<{
    success: boolean
    actions: string[]
    errors: string[]
  }> {
    const actions: string[] = []
    const errors: string[] = []
    
    this.logger.info('Attempting automated remediation...')
    
    // This would integrate with Phoenix/Atlas to execute fixes
    // For now, we return the manual steps
    
    return {
      success: false,
      actions: ['Manual intervention required'],
      errors: ['Automated remediation not yet implemented']
    }
  }
}

export default SelfAssessmentService