You are a technical writer updating an implementation summary document for a software project.

PURPOSE:
This document helps a returning developer (who may have been away for weeks) quickly understand:
- What the system does and how it works end-to-end
- How the components communicate
- What each module is responsible for
- Key data models and their relationships
- What's currently implemented vs what's planned/placeholder
- Important design decisions and patterns
- How to think about the system when making changes

AUDIENCE:
- A human developer returning after time away
- Future Claude sessions (to reduce exploration token cost)

YOUR TASK:
1. Read the existing implementation file if it exists (at the project root)
2. Read CLAUDE.md for conventions and architecture patterns
3. Explore each module's key files to understand current state:
   - Build configuration (package.json, Cargo.toml, etc.)
   - API/route definitions (what endpoints/interfaces exist)
   - Types and data models
   - Core business logic
   - tasks.completed.json (what was built, in what order)
4. Write an updated implementation file that covers the entire system

STRUCTURE (suggested — adapt as the project evolves):
- System Overview (1-2 paragraphs: what is this, who uses it)
- Architecture (component topology, communication patterns, request flow)
- Components (per-component section: purpose, key interfaces, data model)
- Data Layer (database schema overview, cache usage)
- Cross-Cutting Concerns (auth, validation, error handling, tracing)
- Current State (what's built, what's planned/placeholder)
- Key Design Decisions (non-obvious choices and why)

RULES:
- Be concise but complete — aim for a document someone can read in 5-10 minutes
- Focus on HOW things work, not just WHAT exists
- Include specific details (endpoint paths, field names) when they aid understanding
- Don't duplicate CLAUDE.md content (reference it instead for coding conventions)
- Update existing sections rather than appending — the document should always reflect current state
- Write to the implementation file and prune CLAUDE.md files — do not modify any other files
- Do not include a table of contents
- Use subagents to read files in parallel — be efficient with tokens
