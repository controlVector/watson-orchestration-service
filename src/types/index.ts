// Watson Orchestration Engine - Type Definitions

export interface ConversationMessage {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  
  // Watson-specific metadata
  intent?: Intent
  entities?: Entity[]
  confidence?: number
  
  // Workflow tracking
  workflow_id?: string
  step_id?: string
  
  // Infrastructure context
  infrastructure_context?: InfrastructureContext
  
  // Authentication token for MCP calls
  jwt_token?: string
}

export interface Conversation {
  id: string
  workspace_id: string
  user_id: string
  title?: string
  status: ConversationStatus
  
  // Messages in conversation
  messages: ConversationMessage[]
  
  // Active workflows
  active_workflows: WorkflowExecution[]
  
  // Context and preferences
  context: ConversationContext
  
  // Timestamps
  created_at: string
  updated_at: string
  last_activity_at: string
}

export type ConversationStatus = 
  | 'active'           // Ongoing conversation
  | 'waiting_input'    // Waiting for user response
  | 'processing'       // Watson is working
  | 'completed'        // Conversation concluded
  | 'error'            // Error state

export interface ConversationContext {
  // Current infrastructure state
  active_infrastructure: string[] // Infrastructure IDs
  pending_operations: string[]    // Operation IDs
  
  // User preferences from Context Manager
  preferred_provider: string
  preferred_regions: string[]
  cost_limits: {
    daily_limit: number
    monthly_limit: number
    alert_threshold: number
  }
  
  // Conversation memory
  mentioned_technologies: string[]
  deployment_requirements: DeploymentRequirement[]
  
  // Agent states
  agent_states: Record<string, any>
}

// Intent Recognition
export interface Intent {
  name: IntentType
  confidence: number
  parameters: Record<string, any>
}

export type IntentType =
  | 'deploy_application'      // "Deploy my React app"
  | 'create_infrastructure'   // "Create a web server"
  | 'estimate_costs'          // "How much will this cost?"
  | 'check_status'           // "What's the status of my deployment?"
  | 'scale_infrastructure'    // "Scale up my database"
  | 'delete_infrastructure'   // "Remove my staging environment"
  | 'explain_architecture'    // "Explain my current setup"
  | 'troubleshoot'           // "Why is my app slow?"
  | 'get_recommendations'     // "What do you recommend for high traffic?"
  | 'manage_costs'           // "Reduce my costs"
  | 'security_review'        // "Check security of my infrastructure"
  | 'manage_dns'             // "Add DNS record for mydomain.com"
  | 'verify_dns'             // "Check if DNS has propagated"
  | 'setup_ssl_dns'          // "Set up SSL DNS validation"
  | 'general_question'       // General infrastructure questions
  | 'greeting'              // Hello, hi, etc.
  | 'unknown'               // Couldn't determine intent

export interface Entity {
  name: string
  value: string
  type: EntityType
  confidence: number
  start_pos?: number
  end_pos?: number
}

export type EntityType =
  | 'technology'        // React, Node.js, PostgreSQL
  | 'cloud_provider'    // DigitalOcean, AWS, GCP
  | 'region'           // nyc3, us-east-1
  | 'infrastructure'   // web server, database, load balancer
  | 'environment'      // production, staging, development
  | 'size_spec'        // small, medium, large, s-1vcpu-1gb
  | 'quantity'         // 2 servers, 5 instances
  | 'time_period'      // daily, monthly, next week
  | 'cost_amount'      // $50, $100/month
  | 'domain'           // myapp.com, api.example.org

// Workflow System
export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  version: string
  
  // Workflow steps
  steps: WorkflowStep[]
  
  // Triggers and conditions
  triggers: WorkflowTrigger[]
  
  // Expected inputs and outputs
  input_schema: any
  output_schema: any
  
  // Metadata
  tags: string[]
  author: string
  created_at: string
  updated_at: string
}

export interface WorkflowStep {
  id: string
  name: string
  description: string
  type: WorkflowStepType
  
  // Step configuration
  config: any
  
  // Dependencies and flow control
  depends_on: string[] // Step IDs this step depends on
  next_steps: string[] // Possible next steps
  
  // Conditions for execution
  conditions: WorkflowCondition[]
  
  // Error handling
  retry_policy?: RetryPolicy
  timeout_seconds?: number
  
  // Human interaction
  requires_approval?: boolean
  approval_message?: string
}

export type WorkflowStepType =
  | 'parse_requirements'      // Analyze user request
  | 'estimate_cost'          // Get cost estimates
  | 'request_approval'       // Ask for user confirmation
  | 'create_infrastructure'  // Call Atlas to create resources
  | 'configure_application'  // Set up application deployment
  | 'run_tests'             // Execute validation tests
  | 'update_dns'            // Configure DNS records
  | 'send_notification'     // Notify user of completion
  | 'wait_for_input'        // Pause for user response
  | 'call_agent'            // Invoke another ControlVector agent
  | 'conditional'           // Branching logic
  | 'parallel'              // Execute multiple steps in parallel
  | 'loop'                  // Repeat steps
  | 'custom'                // Custom step implementation

export interface WorkflowCondition {
  field: string
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains'
  value: any
}

export interface WorkflowTrigger {
  type: 'intent' | 'keyword' | 'pattern' | 'webhook' | 'schedule'
  config: any
}

export interface RetryPolicy {
  max_attempts: number
  delay_seconds: number
  backoff_multiplier: number
}

// Workflow Execution
export interface WorkflowExecution {
  id: string
  workflow_id: string
  conversation_id: string
  status: WorkflowExecutionStatus
  
  // Input and context
  input: any
  context: WorkflowContext
  
  // Execution tracking
  current_step_id?: string
  completed_steps: string[]
  failed_steps: string[]
  
  // Results and outputs
  outputs: Record<string, any>
  error_message?: string
  
  // Timing
  started_at: string
  completed_at?: string
  duration_ms?: number
  
  // Progress tracking
  progress: {
    total_steps: number
    completed_steps: number
    current_step_description?: string
  }
}

export type WorkflowExecutionStatus =
  | 'pending'          // Queued for execution
  | 'running'          // Currently executing
  | 'waiting_approval' // Paused for user approval
  | 'waiting_input'    // Waiting for user input
  | 'completed'        // Successfully completed
  | 'failed'           // Failed with error
  | 'cancelled'        // Cancelled by user
  | 'timeout'          // Timed out

export interface WorkflowContext {
  // User and workspace info
  user_id: string
  workspace_id: string
  
  // Infrastructure context
  existing_infrastructure: any[]
  target_infrastructure: any
  
  // Requirements and preferences
  requirements: DeploymentRequirement[]
  preferences: UserPreferences
  
  // Agent states and data
  atlas_state?: any
  phoenix_state?: any
  sherlock_state?: any
  
  // Cost and resource tracking
  estimated_costs: number
  approved_budget?: number
  resource_limits: ResourceLimits
}

// Infrastructure Requirements
export interface DeploymentRequirement {
  type: RequirementType
  specification: any
  priority: 'required' | 'preferred' | 'optional'
  source: 'user_specified' | 'inferred' | 'recommended'
}

export type RequirementType =
  | 'technology_stack'      // Programming language, framework
  | 'compute_requirements'  // CPU, memory, storage
  | 'database_requirements' // Database type, size, backup needs
  | 'network_requirements'  // Load balancing, CDN, SSL
  | 'security_requirements' // Firewalls, encryption, compliance
  | 'backup_requirements'   // Backup frequency, retention
  | 'monitoring_requirements' // Logging, metrics, alerting
  | 'scaling_requirements'  // Auto-scaling, load handling
  | 'availability_requirements' // Uptime, disaster recovery
  | 'compliance_requirements' // GDPR, HIPAA, SOC2

export interface UserPreferences {
  // Cloud preferences
  preferred_cloud_provider: string
  preferred_regions: string[]
  
  // Cost preferences
  cost_optimization: 'cost_first' | 'balanced' | 'performance_first'
  budget_alerts: boolean
  
  // Deployment preferences
  deployment_style: 'conservative' | 'balanced' | 'aggressive'
  auto_scaling: boolean
  backup_frequency: 'none' | 'daily' | 'weekly' | 'real_time'
  
  // Communication preferences
  notification_channels: ('email' | 'slack' | 'webhook')[]
  progress_updates: 'minimal' | 'normal' | 'verbose'
  
  // Technical preferences
  container_orchestration: 'none' | 'docker' | 'kubernetes'
  ci_cd_integration: boolean
  monitoring_level: 'basic' | 'advanced' | 'enterprise'
}

export interface ResourceLimits {
  max_monthly_cost: number
  max_instances: number
  max_storage_gb: number
  max_bandwidth_gb: number
}

// Infrastructure Context
export interface InfrastructureContext {
  // Current state
  active_infrastructure: InfrastructureState[]
  pending_operations: OperationState[]
  
  // Costs
  current_monthly_cost: number
  projected_monthly_cost: number
  cost_trend: 'increasing' | 'decreasing' | 'stable'
  
  // Performance metrics
  performance_summary: PerformanceSummary
  
  // Issues and recommendations
  active_issues: InfrastructureIssue[]
  recommendations: InfrastructureRecommendation[]
}

export interface InfrastructureState {
  id: string
  name: string
  type: string
  provider: string
  region: string
  status: string
  created_at: string
  monthly_cost: number
  
  // Health metrics
  health_status: 'healthy' | 'warning' | 'critical'
  uptime_percentage: number
  
  // Resource utilization
  cpu_usage?: number
  memory_usage?: number
  storage_usage?: number
}

export interface OperationState {
  id: string
  type: string
  status: string
  progress_percentage: number
  estimated_completion?: string
  current_step?: string
}

export interface PerformanceSummary {
  average_response_time: number
  requests_per_minute: number
  error_rate: number
  uptime_percentage: number
}

export interface InfrastructureIssue {
  id: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  affected_resources: string[]
  detected_at: string
  auto_resolvable: boolean
  estimated_cost_impact?: number
}

export interface InfrastructureRecommendation {
  id: string
  type: 'cost_optimization' | 'performance' | 'security' | 'reliability'
  title: string
  description: string
  potential_savings?: number
  implementation_effort: 'low' | 'medium' | 'high'
  priority: 'low' | 'medium' | 'high'
}

// Response Generation
export interface WatsonResponse {
  // Core response
  message: string
  response_type: ResponseType
  
  // Rich content
  attachments?: ResponseAttachment[]
  suggested_actions?: SuggestedAction[]
  
  // Workflow integration
  workflow_execution?: WorkflowExecution
  next_steps?: string[]
  
  // Context for follow-up
  context_updates?: any
  
  // LLM usage tracking
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  
  // User interface hints
  ui_hints?: UIHint[]
}

export type ResponseType =
  | 'text'                 // Plain text response
  | 'confirmation'         // Requesting confirmation
  | 'progress_update'      // Status update
  | 'cost_estimate'        // Cost breakdown
  | 'infrastructure_status' // Infrastructure summary
  | 'workflow_complete'    // Workflow completion
  | 'error'               // Error message
  | 'question'            // Asking for clarification

export interface ResponseAttachment {
  type: 'cost_breakdown' | 'infrastructure_diagram' | 'progress_chart' | 'log_output'
  title: string
  data: any
  format: 'json' | 'table' | 'chart' | 'diagram' | 'code'
}

export interface SuggestedAction {
  id: string
  text: string
  action_type: 'workflow' | 'quick_reply' | 'external_link'
  action_data: any
}

export interface UIHint {
  type: 'show_progress' | 'enable_notifications' | 'highlight_costs' | 'show_diagram'
  config: any
}

// Agent Integration
export interface AgentClient {
  name: string
  base_url: string
  health_endpoint: string
  capabilities: AgentCapability[]
}

export interface AgentCapability {
  name: string
  description: string
  input_schema: any
  output_schema: any
}

// Error handling
export class WatsonError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500,
    public context?: any
  ) {
    super(message)
    this.name = 'WatsonError'
  }
}

export class WorkflowError extends WatsonError {
  constructor(message: string, public workflowId: string, public stepId?: string) {
    super(message, 'WORKFLOW_ERROR', 500, { workflowId, stepId })
    this.name = 'WorkflowError'
  }
}

export class IntentParsingError extends WatsonError {
  constructor(message: string, public userInput: string) {
    super(message, 'INTENT_PARSING_ERROR', 400, { userInput })
    this.name = 'IntentParsingError'
  }
}

export class AgentCommunicationError extends WatsonError {
  constructor(message: string, public agentName: string, public originalError?: Error) {
    super(message, 'AGENT_COMMUNICATION_ERROR', 502, { agentName, originalError })
    this.name = 'AgentCommunicationError'
  }
}

// Event system for real-time updates
export interface WatsonEvent {
  id: string
  type: WatsonEventType
  conversation_id: string
  workflow_id?: string
  timestamp: string
  data: any
}

export type WatsonEventType =
  | 'conversation.started'
  | 'conversation.message'
  | 'workflow.started'
  | 'workflow.progress'
  | 'workflow.completed'
  | 'workflow.failed'
  | 'infrastructure.status_change'
  | 'cost.alert'
  | 'approval.required'

// Configuration
export interface WatsonConfig {
  // Service configuration
  port: number
  host: string
  log_level: string
  
  // Agent endpoints
  context_manager_url: string
  atlas_url: string
  neptune_url?: string
  mercury_url: string
  hermes_url: string
  phoenix_url?: string
  sherlock_url?: string
  
  // AI/NLP configuration
  openai_api_key?: string
  enable_ai_assistance: boolean
  
  // Workflow configuration
  max_concurrent_workflows: number
  workflow_timeout_minutes: number
  
  // WebSocket configuration
  enable_websockets: boolean
  websocket_heartbeat_interval: number
  
  // Security
  jwt_secret: string
  enable_cors: boolean
  allowed_origins: string[]
}