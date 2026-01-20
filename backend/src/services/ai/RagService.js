// why is this using openai directly and ONLY openai??

import OpenAI from 'openai/index.mjs';
import dotenv from 'dotenv';
dotenv.config();

/**
 * Enhanced RAG system with relation-aware retrieval and hierarchical memory
 * Implements research paper recommendations for multi-agent context management
 */
class RAG {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey: apiKey });
    this.memoryHierarchy = {
      working: new Map(), // Current task context
      episodic: [], // Summarized task history
      semantic: new Map(), // Entity/concept embeddings
      persistent: new Map(), // Long-term project knowledge
    };
    this.relationGraph = new Map(); // Document relations
    this.chunkCache = new Map(); // Cached chunks with metadata
  }

  /**
   * Generate embeddings for text
   */
  async embed(text) {
    console.log('EMBEDDING TEXT', text.substring(0, 100) + '...');
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-ada-002',
      input: text,
    });
    return response.data[0].embedding;
  }

  /**
   * Calculate cosine similarity between vectors
   */
  cosineSimilarity(vecA, vecB) {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      magnitudeA += vecA[i] * vecA[i];
      magnitudeB += vecB[i] * vecB[i];
    }
    magnitudeA = Math.sqrt(magnitudeA);
    magnitudeB = Math.sqrt(magnitudeB);
    return dotProduct / (magnitudeA * magnitudeB);
  }

  /**
   * Enhanced retrieval with relation-aware expansion
   */
  async retrieveWithRelations(query, documents, embeddings, relations = [], k = 5) {
    const baseResults = await this.retrieve(query, documents, embeddings, Math.min(k * 2, 20));

    // Expand results based on relations (FragRel-style)
    const expandedResults = new Map();
    const addedIds = new Set();

    // Add base results
    for (const result of baseResults.slice(0, k)) {
      if (!addedIds.has(result.id)) {
        expandedResults.set(result.id, { ...result, source: 'direct' });
        addedIds.add(result.id);
      }
    }

    // Add related documents
    for (const result of baseResults.slice(0, Math.min(k, 3))) {
      const relatedDocs = relations
        .filter((rel) => rel.source === result.id && rel.strength > 0.5)
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 2); // Limit related docs per result

      for (const relation of relatedDocs) {
        const relatedDoc = documents.find((doc) => doc.id === relation.target);
        if (relatedDoc && !addedIds.has(relatedDoc.id)) {
          const relatedEmbedding = embeddings[documents.indexOf(relatedDoc)];
          const queryEmbedding = await this.embed(query);

          expandedResults.set(relatedDoc.id, {
            ...relatedDoc,
            similarity: this.cosineSimilarity(queryEmbedding, relatedEmbedding),
            source: 'relation',
            relationStrength: relation.strength,
            relatedTo: result.id,
          });
          addedIds.add(relatedDoc.id);
        }
      }
    }

    // Sort by relevance score (combination of similarity and relation strength)
    const finalResults = Array.from(expandedResults.values())
      .map((doc) => ({
        ...doc,
        relevanceScore: this.calculateRelevanceScore(doc),
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, k);

    return finalResults;
  }

  /**
   * Standard retrieval method
   */
  async retrieve(query, documents, embeddings, k = 10) {
    const queryEmbedding = await this.embed(query);

    const scoredDocuments = documents.map((doc, index) => ({
      ...doc,
      similarity: this.cosineSimilarity(queryEmbedding, embeddings[index]),
    }));

    scoredDocuments.sort((a, b) => b.similarity - a.similarity);
    return scoredDocuments.slice(0, k);
  }

  /**
   * Build relation graph between documents
   */
  buildRelationGraph(documents, embeddings) {
    const relations = [];

    for (let i = 0; i < documents.length; i++) {
      for (let j = i + 1; j < documents.length; j++) {
        const docA = documents[i];
        const docB = documents[j];
        const embeddingA = embeddings[i];
        const embeddingB = embeddings[j];

        // Semantic similarity relation
        const similarity = this.cosineSimilarity(embeddingA, embeddingB);
        if (similarity > 0.7) {
          relations.push({
            source: docA.id,
            target: docB.id,
            type: 'semantic_similarity',
            strength: similarity,
            metadata: {
              sourceType: docA.type || 'unknown',
              targetType: docB.type || 'unknown',
            },
          });
        }

        // Content-based relations (imports, references, etc.)
        const contentRelation = this.detectContentRelation(docA, docB);
        if (contentRelation) {
          relations.push({
            source: docA.id,
            target: docB.id,
            type: contentRelation.type,
            strength: contentRelation.strength,
            metadata: contentRelation.metadata,
          });
        }
      }
    }

    // Store relations for future use
    this.relationGraph.set('default', relations);
    return relations;
  }

  /**
   * Detect content-based relations between documents
   */
  detectContentRelation(docA, docB) {
    const contentA = (docA.content || '').toLowerCase();
    const contentB = (docB.content || '').toLowerCase();

    // Import/reference detection
    if (docA.type === 'code' && docB.type === 'code') {
      const filenameB = docB.filename || docB.id;
      if (contentA.includes(`import`) && contentA.includes(filenameB)) {
        return {
          type: 'imports',
          strength: 0.9,
          metadata: { direction: 'A_imports_B' },
        };
      }
    }

    // Test relation detection
    if (docA.type === 'code' && docB.type === 'test') {
      const filenameA = docA.filename || docA.id;
      if (contentB.includes(filenameA) || contentB.includes(docA.id)) {
        return {
          type: 'tested_by',
          strength: 0.8,
          metadata: { direction: 'A_tested_by_B' },
        };
      }
    }

    // Documentation relation
    if (docA.type === 'code' && docB.type === 'documentation') {
      const commonTerms = this.findCommonTerms(contentA, contentB);
      if (commonTerms.length > 3) {
        return {
          type: 'documented_by',
          strength: Math.min(0.8, commonTerms.length * 0.1),
          metadata: { commonTerms: commonTerms.slice(0, 5) },
        };
      }
    }

    return null;
  }

  /**
   * Hierarchical memory management (MemGPT-style)
   */
  updateWorkingMemory(key, content, metadata = {}) {
    this.memoryHierarchy.working.set(key, {
      content,
      metadata,
      timestamp: Date.now(),
      accessCount: (this.memoryHierarchy.working.get(key)?.accessCount || 0) + 1,
    });

    // Limit working memory size
    if (this.memoryHierarchy.working.size > 50) {
      this.compactWorkingMemory();
    }
  }

  /**
   * Add to episodic memory (task summaries)
   */
  addEpisodicMemory(taskId, summary, artifacts = []) {
    this.memoryHierarchy.episodic.push({
      taskId,
      summary,
      artifacts,
      timestamp: Date.now(),
      importance: this.calculateImportance(summary, artifacts),
    });

    // Keep only recent and important episodes
    if (this.memoryHierarchy.episodic.length > 100) {
      this.memoryHierarchy.episodic = this.memoryHierarchy.episodic.sort((a, b) => b.importance - a.importance).slice(0, 80);
    }
  }

  /**
   * Update semantic memory with entities and concepts
   */
  async updateSemanticMemory(entities, concepts = []) {
    for (const entity of entities) {
      if (!this.memoryHierarchy.semantic.has(entity.name)) {
        const embedding = await this.embed(entity.description || entity.name);
        this.memoryHierarchy.semantic.set(entity.name, {
          embedding,
          description: entity.description,
          type: entity.type || 'entity',
          frequency: 1,
          lastSeen: Date.now(),
        });
      } else {
        const existing = this.memoryHierarchy.semantic.get(entity.name);
        existing.frequency += 1;
        existing.lastSeen = Date.now();
      }
    }
  }

  /**
   * Retrieve from hierarchical memory
   */
  async retrieveFromMemory(query, memoryTypes = ['working', 'episodic', 'semantic'], k = 5) {
    const results = [];

    if (memoryTypes.includes('working')) {
      const workingResults = Array.from(this.memoryHierarchy.working.entries()).map(([key, value]) => ({
        id: key,
        content: value.content,
        type: 'working_memory',
        timestamp: value.timestamp,
        accessCount: value.accessCount,
      }));
      results.push(...workingResults);
    }

    if (memoryTypes.includes('episodic')) {
      const episodicResults = this.memoryHierarchy.episodic
        .filter((episode) => episode.summary.toLowerCase().includes(query.toLowerCase()))
        .map((episode) => ({
          id: episode.taskId,
          content: episode.summary,
          type: 'episodic_memory',
          timestamp: episode.timestamp,
          importance: episode.importance,
        }));
      results.push(...episodicResults);
    }

    if (memoryTypes.includes('semantic')) {
      const queryEmbedding = await this.embed(query);
      const semanticResults = [];

      for (const [name, data] of this.memoryHierarchy.semantic.entries()) {
        const similarity = this.cosineSimilarity(queryEmbedding, data.embedding);
        if (similarity > 0.6) {
          semanticResults.push({
            id: name,
            content: data.description || name,
            type: 'semantic_memory',
            similarity,
            frequency: data.frequency,
            lastSeen: data.lastSeen,
          });
        }
      }

      results.push(...semanticResults.sort((a, b) => b.similarity - a.similarity));
    }

    return results.slice(0, k);
  }

  /**
   * Create context pack for agent handoff
   */
  async createContextPack(query, documents, embeddings, options = {}) {
    const { maxTokens = 2000, includeRelations = true, compressionRatio = 0.7 } = options;

    // Get relevant documents
    const relevantDocs = includeRelations
      ? await this.retrieveWithRelations(query, documents, embeddings, this.relationGraph.get('default') || [], 10)
      : await this.retrieve(query, documents, embeddings, 10);

    // Get memory context
    const memoryContext = await this.retrieveFromMemory(query, ['working', 'episodic'], 5);

    // Build context pack
    const contextPack = {
      query,
      timestamp: Date.now(),
      documents: relevantDocs.slice(0, 5).map((doc) => ({
        id: doc.id,
        content: this.truncateContent(doc.content, 300),
        similarity: doc.similarity,
        source: doc.source || 'direct',
        relationStrength: doc.relationStrength,
      })),
      memory: memoryContext.slice(0, 3),
      entities: this.extractEntities(relevantDocs),
      relations: includeRelations ? this.getRelevantRelations(relevantDocs) : [],
      metadata: {
        totalDocs: documents.length,
        retrievedDocs: relevantDocs.length,
        compressionRatio,
        tokenEstimate: this.estimateTokens(relevantDocs),
      },
    };

    return contextPack;
  }

  /**
   * Enhanced RAG with all features
   */
  async rag(query, documents, embeddings, k = 5, options = {}) {
    const { useRelations = true, useMemory = true, createPack = false } = options;

    let retrievedDocuments;

    if (useRelations && this.relationGraph.has('default')) {
      retrievedDocuments = await this.retrieveWithRelations(query, documents, embeddings, this.relationGraph.get('default'), k);
    } else {
      retrievedDocuments = await this.retrieve(query, documents, embeddings, k);
    }

    // Enhance with memory if requested
    if (useMemory) {
      const memoryResults = await this.retrieveFromMemory(query, ['working', 'semantic'], 2);
      retrievedDocuments = [...retrievedDocuments, ...memoryResults].slice(0, k);
    }

    // Create context pack if requested
    if (createPack) {
      const contextPack = await this.createContextPack(query, documents, embeddings, options);
      return {
        documents: retrievedDocuments,
        contextPack,
      };
    }

    return retrievedDocuments;
  }

  // Private helper methods

  calculateRelevanceScore(doc) {
    let score = doc.similarity || 0.5;

    // Boost for relation-based results
    if (doc.source === 'relation' && doc.relationStrength) {
      score += doc.relationStrength * 0.3;
    }

    // Boost for recent documents
    if (doc.timestamp) {
      const age = Date.now() - doc.timestamp;
      const daysSinceCreation = age / (1000 * 60 * 60 * 24);
      if (daysSinceCreation < 1) score += 0.1;
      else if (daysSinceCreation < 7) score += 0.05;
    }

    return Math.min(1.0, score);
  }

  compactWorkingMemory() {
    // Keep most frequently accessed and recent items
    const entries = Array.from(this.memoryHierarchy.working.entries())
      .sort((a, b) => {
        const scoreA = a[1].accessCount * 0.7 + (Date.now() - a[1].timestamp) * 0.3;
        const scoreB = b[1].accessCount * 0.7 + (Date.now() - b[1].timestamp) * 0.3;
        return scoreB - scoreA;
      })
      .slice(0, 30);

    this.memoryHierarchy.working.clear();
    entries.forEach(([key, value]) => {
      this.memoryHierarchy.working.set(key, value);
    });
  }

  calculateImportance(summary, artifacts) {
    let importance = 0.5;

    // Boost for longer summaries (more content)
    importance += Math.min(0.3, summary.length / 1000);

    // Boost for more artifacts
    importance += Math.min(0.2, artifacts.length * 0.05);

    // Boost for certain keywords
    const importantKeywords = ['error', 'bug', 'fix', 'implement', 'complete', 'success'];
    const keywordCount = importantKeywords.filter((keyword) => summary.toLowerCase().includes(keyword)).length;
    importance += keywordCount * 0.1;

    return Math.min(1.0, importance);
  }

  findCommonTerms(textA, textB) {
    const wordsA = textA.split(/\W+/).filter((w) => w.length > 3);
    const wordsB = textB.split(/\W+/).filter((w) => w.length > 3);

    return wordsA.filter((word) => wordsB.includes(word));
  }

  truncateContent(content, maxLength) {
    if (content.length <= maxLength) return content;
    return content.substring(0, maxLength) + '...';
  }

  extractEntities(documents) {
    const entities = new Set();

    documents.forEach((doc) => {
      // Simple entity extraction - could be enhanced with NLP
      const content = doc.content || '';
      const words = content.split(/\W+/);

      // Extract capitalized words (potential entities)
      words.forEach((word) => {
        if (word.length > 2 && word[0] === word[0].toUpperCase()) {
          entities.add(word);
        }
      });
    });

    return Array.from(entities).slice(0, 10);
  }

  getRelevantRelations(documents) {
    const docIds = new Set(documents.map((doc) => doc.id));
    const relations = this.relationGraph.get('default') || [];

    return relations.filter((rel) => docIds.has(rel.source) || docIds.has(rel.target));
  }

  estimateTokens(documents) {
    // Rough token estimation (1 token ≈ 4 characters)
    const totalChars = documents.reduce((sum, doc) => sum + (doc.content || '').length, 0);
    return Math.ceil(totalChars / 4);
  }
}

export default RAG;
