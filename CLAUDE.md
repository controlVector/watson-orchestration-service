# Watson Orchestration Engine

## Purpose & Agent Assignment
- **Primary Agent**: Watson - AI conversation orchestrator and workflow engine  
- **Service Role**: Central hub for AI-driven conversations and multi-agent workflow coordination
- **Key Capabilities**: 
  - Natural language conversation management with context preservation
  - Intent recognition and routing to specialized agents (Atlas, Phoenix, Sherlock)
  - Real-time WebSocket communication for interactive chat experiences
  - Workflow orchestration across distributed agent ecosystem
  - Integration with multiple LLM providers (OpenAI, Anthropic, Google, Local)

## Technical Stack
- **Framework**: Fastify with TypeScript for high-performance API and WebSocket handling
- **Communication**: WebSocket for real-time bidirectional communication
- **Authentication**: JWT token validation for secure user sessions
- **Integrations**: 
  - Context Manager for user preferences and API credentials
  - Atlas for infrastructure operations
  - Multiple LLM providers for AI conversation capabilities
- **Message Processing**: Structured conversation parsing with intent classification

## Integration Points
- **APIs Provided**:
  - `POST /api/conversations` - Create new conversation threads
  - `GET /api/conversations` - List user conversations with pagination
  - `GET /api/conversations/:id` - Retrieve conversation history
  - `POST /api/conversations/:id/messages` - Send message to conversation
  - `DELETE /api/conversations/:id` - Remove conversation thread
  - `WebSocket /ws` - Real-time conversation interface with typing indicators
  - `GET /health` - Service health monitoring endpoint

- **APIs Consumed**:
  - **Context Manager**: User context, LLM credentials, conversation preferences
  - **Atlas Service**: Infrastructure deployment and management operations
  - **Auth Service**: JWT token validation for user authentication
  - **LLM Providers**: OpenAI, Anthropic Claude, Google Gemini for AI responses

- **Event Publications**:
  - `conversation.started` - New conversation initiation
  - `message.received` - User message processing
  - `message.sent` - AI response generation
  - `workflow.triggered` - Agent workflow activation
  - `intent.recognized` - User intent classification results

- **Intent Recognition System**:
  - `deploy_application` - Application deployment requests
  - `create_infrastructure` - Infrastructure provisioning
  - `scale_resources` - Resource scaling operations  
  - `monitor_health` - System monitoring requests
  - `manage_costs` - Cost optimization queries
  - `security_scan` - Security audit initiation
  - `backup_data` - Data backup operations
  - `troubleshoot_issue` - Problem diagnosis and resolution
  - `configure_service` - Service configuration management
  - `general_question` - Information requests and general queries

## Current Status: READY FOR INTEGRATION ✅

**Service Running**: Port 3004
**WebSocket Server**: Operational ✅
**JWT Authentication**: Implemented ✅
**Intent Recognition**: Comprehensive system ready ✅
**Multi-LLM Support**: Configuration complete ✅
**Agent Integration**: Architecture defined, awaiting frontend implementation ✅

### Next Development Phase
- **Frontend Chat Interface**: Integration with React-based conversation UI
- **LLM Provider Routing**: Dynamic selection based on user configuration
- **Workflow Execution**: Real-time coordination with Atlas and other agents
- **Conversation Context**: Persistent memory across user sessions

## Development Setup

### Prerequisites
- Node.js 18+
- TypeScript 5.0+
- Active Context Manager service (port 3005)
- Active Auth Service (port 3002)
- LLM Provider API keys configured in user onboarding

### Environment Configuration
```env
# Server Configuration
PORT=3004
HOST=0.0.0.0
NODE_ENV=development
LOG_LEVEL=info

# JWT Configuration (Must match Auth Service)
JWT_SECRET=controlvector-auth-development-secret-key
JWT_EXPIRES_IN=24h

# Service URLs
CONTEXT_MANAGER_URL=http://localhost:3005
AUTH_SERVICE_URL=http://localhost:3002
ATLAS_SERVICE_URL=http://localhost:3003
FRONTEND_URL=http://localhost:3000

# Conversation Configuration
MAX_CONVERSATION_HISTORY=100
TYPING_INDICATOR_DELAY=1000
INTENT_CONFIDENCE_THRESHOLD=0.7

# LLM Provider Fallbacks (Development)
OPENAI_API_KEY=fallback_development_key
ANTHROPIC_API_KEY=fallback_development_key
```

### Local Development Commands
```bash
# Install dependencies
npm install

# Run in development mode with auto-reload
npm run dev

# Build for production  
npm run build

# Start production server
npm start

# Run conversation tests
npm test

# WebSocket connection test
npm run test:websocket
```

## Architecture & Conversation Flow

### Conversation Lifecycle
1. **Authentication**: JWT token validation via Auth Service
2. **Context Retrieval**: User preferences and LLM configuration from Context Manager
3. **Intent Analysis**: Natural language processing to determine user intent
4. **Agent Routing**: Intelligent delegation to appropriate specialized agents
5. **Response Generation**: AI-powered responses using configured LLM providers
6. **Context Updates**: Conversation state persistence for future interactions

### WebSocket Message Protocol
```typescript
// Incoming Messages
interface UserMessage {
  type: 'user_message'
  content: string
  conversation_id: string
  timestamp: string
}

// Outgoing Messages  
interface AIResponse {
  type: 'ai_response'
  content: string
  conversation_id: string
  intent: string
  confidence: number
  agent: string
  timestamp: string
}

interface TypingIndicator {
  type: 'typing_indicator'
  is_typing: boolean
  agent: string
}
```

### Multi-Agent Coordination
- **Watson (Self)**: Conversation orchestration and user interaction
- **Atlas**: Infrastructure provisioning, deployment, and scaling operations
- **Phoenix**: Application lifecycle management and monitoring  
- **Sherlock**: Security analysis, compliance checking, and threat detection
- **Future Agents**: Extensible architecture for additional specialized capabilities

### LLM Provider Integration
- **Dynamic Selection**: Routes requests to user's configured LLM provider
- **Fallback Handling**: Graceful degradation if primary provider unavailable
- **Context Preservation**: Maintains conversation context across provider switches
- **Cost Optimization**: Provider selection based on user preferences and cost considerations

### Integration with ControlVector Ecosystem
1. **User Onboarding**: Receives LLM configuration from completed onboarding flow
2. **Credential Management**: Securely retrieves API keys from Context Manager
3. **Workflow Execution**: Coordinates complex multi-step operations across agents
4. **Real-time Updates**: WebSocket notifications for infrastructure changes
5. **Context Awareness**: Maintains conversation state and user preferences

Watson serves as the intelligent conversation interface that transforms user natural language requests into coordinated actions across the entire ControlVector infrastructure management platform. Ready for frontend chat interface integration to complete the user experience.