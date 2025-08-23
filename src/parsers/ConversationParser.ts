import * as natural from 'natural'
import nlp from 'compromise'
import { Intent, Entity, IntentType, EntityType, IntentParsingError } from '../types'

export class ConversationParser {
  private stemmer: any
  private tokenizer: any
  
  // Intent patterns and keywords
  private intentPatterns: Record<IntentType, RegExp[]> = {
    deploy_application: [
      /deploy(?:ment)?\s+(?:my\s+)?(.+?)(?:\s+app(?:lication)?)?/i,
      /(?:build|create|setup)\s+(?:and\s+)?deploy(?:ment)?/i,
      /(?:i\s+(?:want|need)\s+to\s+)?deploy\s+(?:my\s+)?(.+)/i,
      /(?:launch|start|run)\s+(?:my\s+)?(.+?)(?:\s+(?:app|application|service))?/i
    ],
    
    create_infrastructure: [
      /(?:create|provision|setup|build)\s+(?:a\s+)?(.+?)(?:\s+(?:server|instance|infrastructure|environment))?/i,
      /(?:i\s+need\s+)?(?:a\s+)?(.+?)(?:\s+(?:server|database|load\s+balancer))/i,
      /(?:spin\s+up|set\s+up)\s+(?:a\s+)?(.+)/i,
      /(?:new|fresh)\s+(.+?)(?:\s+(?:setup|environment))?/i
    ],
    
    estimate_costs: [
      /(?:how\s+much|what.+cost|price|pricing)/i,
      /(?:cost\s+estimate|budget|expense)/i,
      /(?:what.+(?:cost|price)|how\s+expensive)/i,
      /(?:monthly|daily)\s+(?:cost|price|fee)/i
    ],
    
    check_status: [
      /(?:status|progress|update)(?:\s+(?:of|on))?/i,
      /(?:what.+(?:happening|going\s+on)|how.+(?:going|doing))/i,
      /(?:is\s+(?:it|my).+(?:ready|done|complete|finished))/i,
      /(?:check|show|tell\s+me)\s+(?:the\s+)?(?:status|progress)/i
    ],
    
    scale_infrastructure: [
      /(?:scale|scaling)\s+(?:up|down|out|in)?/i,
      /(?:increase|decrease|add|remove)\s+(?:capacity|resources|instances)/i,
      /(?:more|less|additional|fewer)\s+(?:servers|resources|capacity)/i,
      /(?:resize|upgrade|downgrade)\s+(?:my\s+)?(.+)/i
    ],
    
    delete_infrastructure: [
      /(?:delete|remove|destroy|terminate|shutdown)/i,
      /(?:tear\s+down|clean\s+up|decommission)/i,
      /(?:stop|kill|end)\s+(?:my\s+)?(.+)/i,
      /(?:get\s+rid\s+of|eliminate)\s+(?:my\s+)?(.+)/i
    ],
    
    explain_architecture: [
      /(?:explain|describe|show|tell\s+me\s+about)\s+(?:my\s+)?(?:architecture|setup|infrastructure)/i,
      /(?:what.+(?:have|running|deployed))/i,
      /(?:overview|summary)\s+(?:of\s+)?(?:my\s+)?(?:infrastructure|setup)/i,
      /(?:how\s+(?:is|does)|what.+(?:look\s+like|configured))/i
    ],
    
    troubleshoot: [
      /(?:problem|issue|error|trouble|bug)/i,
      /(?:not\s+working|broken|failing|slow)/i,
      /(?:why.+(?:slow|down|not|error)|what.+(?:wrong|problem))/i,
      /(?:debug|diagnose|investigate|fix)/i
    ],
    
    get_recommendations: [
      /(?:recommend|suggest|advice|best\s+practice)/i,
      /(?:what\s+(?:should|would|do)\s+(?:i|you)\s+recommend)/i,
      /(?:optimize|improve|better\s+way)/i,
      /(?:guidance|help\s+me\s+choose)/i
    ],
    
    manage_costs: [
      /(?:reduce|lower|cut|save)\s+(?:costs?|money|expenses?)/i,
      /(?:cost\s+optimization|cheaper|less\s+expensive)/i,
      /(?:budget|spending)\s+(?:control|management)/i,
      /(?:save\s+money|cost\s+effective)/i
    ],
    
    security_review: [
      /(?:security|secure|safety|protection)/i,
      /(?:vulnerability|threat|risk|audit)/i,
      /(?:check\s+security|security\s+(?:review|scan))/i,
      /(?:safe|protected|compliant)/i
    ],
    
    general_question: [
      /(?:what\s+is|how\s+(?:does|do)|can\s+(?:you|i)|tell\s+me)/i,
      /(?:explain|help|information|about)/i,
      /(?:question|ask|wondering)/i
    ],
    
    greeting: [
      /^(?:hi|hello|hey|greetings|good\s+(?:morning|afternoon|evening))(?:\s|$)/i,
      /^(?:howdy|what.?s\s+up|how.?s\s+it\s+going)(?:\s|$)/i
    ],
    
    unknown: []
  }

  // Entity extraction patterns
  private entityPatterns: Record<EntityType, RegExp[]> = {
    technology: [
      /\b(?:react|vue|angular|nodejs?|node\.js|python|django|flask|ruby|rails|php|laravel|java|spring|\.net|go|rust|javascript|typescript)\b/gi,
      /\b(?:mysql|postgresql|postgres|mongodb|redis|elasticsearch|sqlite)\b/gi,
      /\b(?:nginx|apache|docker|kubernetes|k8s)\b/gi
    ],
    
    cloud_provider: [
      /\b(?:digitalocean|digital\s+ocean|do|aws|amazon\s+web\s+services|gcp|google\s+cloud|azure|microsoft\s+azure|linode|vultr)\b/gi
    ],
    
    region: [
      /\b(?:nyc[1-3]|sfo[1-3]|ams[2-3]|sgp1|lon1|fra1|tor1|blr1|syd1)\b/gi,
      /\b(?:us-east-[1-2]|us-west-[1-2]|eu-west-[1-3]|ap-southeast-[1-2])\b/gi,
      /\b(?:new\s+york|san\s+francisco|amsterdam|singapore|london|frankfurt|toronto|bangalore|sydney)\b/gi
    ],
    
    infrastructure: [
      /\b(?:server|instance|droplet|vm|virtual\s+machine|container)\b/gi,
      /\b(?:database|db|load\s+balancer|firewall|cdn|storage|volume)\b/gi,
      /\b(?:kubernetes|k8s|cluster|node)\b/gi
    ],
    
    environment: [
      /\b(?:production|prod|staging|stage|development|dev|test|testing|demo)\b/gi
    ],
    
    size_spec: [
      /\b(?:s-\d+vcpu-\d+gb|[ts][23]?\.(?:nano|micro|small|medium|large|xlarge))\b/gi,
      /\b(?:small|medium|large|extra\s+large|tiny|basic|standard|premium)\b/gi,
      /\b\d+\s*(?:gb|mb|vcpu|cpu|core)s?\b/gi
    ],
    
    quantity: [
      /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:server|instance|node|droplet)s?\b/gi,
      /\b\d+\s*x\s*(?:server|instance|node)s?\b/gi
    ],
    
    time_period: [
      /\b(?:daily|weekly|monthly|yearly|hourly)\b/gi,
      /\b(?:per\s+(?:day|week|month|year|hour))\b/gi,
      /\b(?:every\s+(?:day|week|month))\b/gi
    ],
    
    cost_amount: [
      /\$\d+(?:\.\d{2})?(?:\s*(?:per\s+)?(?:month|day|hour|year))?/gi,
      /\b\d+\s*(?:dollars?|usd|cents?)\b/gi
    ],
    
    domain: [
      /\b(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}\b/g,
      /\b(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/\S*)?\b/g
    ]
  }

  constructor() {
    this.stemmer = natural.PorterStemmer
    this.tokenizer = new natural.WordTokenizer()
  }

  /**
   * Parse user input and extract intent and entities
   */
  parseInput(input: string): { intent: Intent; entities: Entity[] } {
    const cleanInput = this.preprocessInput(input)
    
    // Extract intent
    const intent = this.extractIntent(cleanInput)
    
    // Extract entities
    const entities = this.extractEntities(cleanInput)
    
    return { intent, entities }
  }

  /**
   * Preprocess input text
   */
  private preprocessInput(input: string): string {
    return input
      .toLowerCase()
      .trim()
      .replace(/[^\w\s.-]/g, ' ') // Keep dots and dashes for domains/specs
      .replace(/\s+/g, ' ')
  }

  /**
   * Extract intent from input
   */
  private extractIntent(input: string): Intent {
    let bestMatch: { intent: IntentType; confidence: number; parameters: any } = {
      intent: 'unknown',
      confidence: 0,
      parameters: {}
    }

    for (const [intentType, patterns] of Object.entries(this.intentPatterns)) {
      const intent = intentType as IntentType
      
      for (const pattern of patterns) {
        const match = input.match(pattern)
        if (match) {
          let confidence = 0.8 // Base confidence for pattern match
          
          // Boost confidence based on match quality
          const matchLength = match[0].length
          const inputLength = input.length
          const coverage = matchLength / inputLength
          confidence += coverage * 0.2
          
          // Extract parameters from capture groups
          const parameters: any = {}
          if (match[1]) {
            parameters.captured_text = match[1].trim()
          }
          
          if (confidence > bestMatch.confidence) {
            bestMatch = { intent, confidence: Math.min(confidence, 1.0), parameters }
          }
        }
      }
    }

    // Special handling for greetings (should have high confidence if matched)
    if (bestMatch.intent === 'greeting') {
      bestMatch.confidence = 0.95
    }

    // If no strong match, try keyword-based matching
    if (bestMatch.confidence < 0.5) {
      const keywordIntent = this.extractIntentByKeywords(input)
      if (keywordIntent.confidence > bestMatch.confidence) {
        bestMatch = keywordIntent
      }
    }

    return {
      name: bestMatch.intent,
      confidence: bestMatch.confidence,
      parameters: bestMatch.parameters
    }
  }

  /**
   * Extract intent using keyword matching
   */
  private extractIntentByKeywords(input: string): { intent: IntentType; confidence: number; parameters: any } {
    const tokens = this.tokenizer.tokenize(input) || []
    const stemmedTokens = tokens.map((token: string) => this.stemmer.stem(token))
    
    const intentKeywords: Record<IntentType, string[]> = {
      deploy_application: ['deploy', 'launch', 'start', 'run', 'app', 'application'],
      create_infrastructure: ['create', 'provision', 'setup', 'build', 'server', 'database'],
      estimate_costs: ['cost', 'price', 'budget', 'expense', 'much', 'expensive'],
      check_status: ['status', 'progress', 'update', 'check', 'ready', 'done'],
      scale_infrastructure: ['scale', 'scaling', 'increase', 'decrease', 'more', 'less'],
      delete_infrastructure: ['delete', 'remove', 'destroy', 'terminate', 'stop'],
      explain_architecture: ['explain', 'describe', 'show', 'architecture', 'overview'],
      troubleshoot: ['problem', 'issue', 'error', 'trouble', 'slow', 'broken'],
      get_recommendations: ['recommend', 'suggest', 'advice', 'best', 'optimize'],
      manage_costs: ['reduce', 'save', 'cheaper', 'optimization', 'budget'],
      security_review: ['security', 'secure', 'safe', 'vulnerability', 'audit'],
      general_question: ['what', 'how', 'why', 'when', 'question', 'help'],
      greeting: ['hello', 'hi', 'hey', 'good'],
      unknown: []
    }

    let bestMatch: { intent: IntentType; confidence: number } = {
      intent: 'unknown',
      confidence: 0
    }

    for (const [intentType, keywords] of Object.entries(intentKeywords)) {
      const intent = intentType as IntentType
      const stemmedKeywords = keywords.map(kw => this.stemmer.stem(kw))
      
      const matchCount = stemmedTokens.filter((token: string) => 
        stemmedKeywords.includes(token)
      ).length
      
      if (matchCount > 0) {
        const confidence = Math.min(matchCount / Math.max(keywords.length, tokens.length), 0.7)
        
        if (confidence > bestMatch.confidence) {
          bestMatch = { intent, confidence }
        }
      }
    }

    return { ...bestMatch, parameters: {} }
  }

  /**
   * Extract entities from input
   */
  private extractEntities(input: string): Entity[] {
    const entities: Entity[] = []
    
    for (const [entityType, patterns] of Object.entries(this.entityPatterns)) {
      const type = entityType as EntityType
      
      for (const pattern of patterns) {
        let match
        while ((match = pattern.exec(input)) !== null) {
          entities.push({
            name: type,
            value: match[0].trim(),
            type,
            confidence: 0.8,
            start_pos: match.index,
            end_pos: match.index + match[0].length
          })
        }
      }
    }

    // Remove duplicates and overlapping entities
    return this.deduplicateEntities(entities)
  }

  /**
   * Remove duplicate and overlapping entities
   */
  private deduplicateEntities(entities: Entity[]): Entity[] {
    // Sort by position
    entities.sort((a, b) => (a.start_pos || 0) - (b.start_pos || 0))
    
    const filtered: Entity[] = []
    
    for (const entity of entities) {
      const isOverlapping = filtered.some(existing => {
        const existingStart = existing.start_pos || 0
        const existingEnd = existing.end_pos || 0
        const entityStart = entity.start_pos || 0
        const entityEnd = entity.end_pos || 0
        
        return (
          (entityStart >= existingStart && entityStart < existingEnd) ||
          (entityEnd > existingStart && entityEnd <= existingEnd)
        )
      })
      
      if (!isOverlapping) {
        filtered.push(entity)
      }
    }
    
    return filtered
  }

  /**
   * Analyze input using NLP library for advanced parsing
   */
  analyzeWithNLP(input: string): any {
    const doc = nlp(input)
    
    return {
      // Extract verbs (actions)
      verbs: doc.verbs().out('array'),
      
      // Extract nouns (things)
      nouns: doc.nouns().out('array'),
      
      // Extract numbers
      numbers: doc.match('#Value').out('array'),
      
      // Extract organizations (could be cloud providers)
      organizations: doc.organizations().out('array'),
      
      // Extract places (could be regions)
      places: doc.places().out('array'),
      
      // Extract topics
      topics: doc.topics().out('array'),
      
      // Sentiment analysis
      sentiment: this.analyzeSentiment(input)
    }
  }

  /**
   * Basic sentiment analysis
   */
  private analyzeSentiment(input: string): { score: number; label: string } {
    const positiveWords = ['good', 'great', 'awesome', 'excellent', 'perfect', 'love', 'like', 'happy', 'fast', 'easy']
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'slow', 'broken', 'problem', 'issue', 'error']
    
    const tokens = this.tokenizer.tokenize(input.toLowerCase()) || []
    
    let score = 0
    tokens.forEach((token: string) => {
      if (positiveWords.includes(token)) score += 1
      if (negativeWords.includes(token)) score -= 1
    })
    
    const normalizedScore = score / Math.max(tokens.length, 1)
    
    let label = 'neutral'
    if (normalizedScore > 0.1) label = 'positive'
    if (normalizedScore < -0.1) label = 'negative'
    
    return { score: normalizedScore, label }
  }

  /**
   * Extract deployment requirements from parsed input
   */
  extractDeploymentRequirements(input: string, entities: Entity[]): any[] {
    const requirements: any[] = []
    
    // Extract technology stack
    const technologies = entities
      .filter(e => e.type === 'technology')
      .map(e => e.value)
    
    if (technologies.length > 0) {
      requirements.push({
        type: 'technology_stack',
        specification: { technologies },
        priority: 'required',
        source: 'user_specified'
      })
    }
    
    // Extract infrastructure requirements
    const infrastructure = entities
      .filter(e => e.type === 'infrastructure')
      .map(e => e.value)
    
    if (infrastructure.length > 0) {
      requirements.push({
        type: 'compute_requirements',
        specification: { infrastructure_types: infrastructure },
        priority: 'required',
        source: 'user_specified'
      })
    }
    
    // Extract size/scale requirements
    const sizes = entities
      .filter(e => e.type === 'size_spec')
      .map(e => e.value)
    
    if (sizes.length > 0) {
      requirements.push({
        type: 'compute_requirements',
        specification: { sizes },
        priority: 'preferred',
        source: 'user_specified'
      })
    }
    
    return requirements
  }

  /**
   * Generate follow-up questions based on incomplete requirements
   */
  generateFollowUpQuestions(intent: Intent, entities: Entity[]): string[] {
    const questions: string[] = []
    
    switch (intent.name) {
      case 'deploy_application':
        if (!entities.some(e => e.type === 'technology')) {
          questions.push("What technology stack are you using? (e.g., React, Node.js, PostgreSQL)")
        }
        if (!entities.some(e => e.type === 'environment')) {
          questions.push("Is this for production, staging, or development?")
        }
        break
        
      case 'create_infrastructure':
        if (!entities.some(e => e.type === 'cloud_provider')) {
          questions.push("Which cloud provider would you prefer? (DigitalOcean, AWS, GCP, Azure)")
        }
        if (!entities.some(e => e.type === 'region')) {
          questions.push("Which region should I deploy to?")
        }
        break
        
      case 'estimate_costs':
        if (!entities.some(e => e.type === 'infrastructure')) {
          questions.push("What type of infrastructure do you need costs for?")
        }
        break
    }
    
    return questions
  }
}