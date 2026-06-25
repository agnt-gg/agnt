---
name: pdf-research-corpus-analyzer
description: "Download, extract, cross-reference, and generate sequenced reading plans from folders of PDF research papers or books. Use this skill whenever the user asks to analyze a collection of PDFs, build a reading plan from multiple documents, find connections between papers or books, create a concept index across documents, extract key ideas from a research corpus, stitch together a curriculum from PDFs, cross-reference themes across papers, map how ideas connect between documents, or says things like 'I have a folder of PDFs', 'find the connections between these papers', 'build me a reading plan', 'what do these documents have in common', 'analyze these research papers', 'summarize and cross-reference my PDFs', 'create a study guide from these papers', or 'download papers on X and analyze them'. Also trigger when the user wants to understand how multiple academic papers relate, wants a structured literature review, or wants to turn a pile of unorganized PDFs into an actionable reading sequence with exact page references."
version: 1.0.0
---

# PDF Research Corpus Analyzer

Turn a folder of PDFs (or a topic to research) into a structured concept index and sequenced reading plan with exact page references. No vector databases, no embeddings — just structured extraction and concept-level cross-referencing.

## Why This Approach Works Better Than Vectors

Vector/embedding search finds **similarity** — passages that use similar words. This skill finds **structure** — how ideas build on each other, where arguments agree or conflict, and what sequence a reader should follow. Vectors can't generate a reading plan because they don't understand order, argumentation, or pedagogical flow. Structured summarization + concept indexing does.

## The Pipeline

The skill has three phases, always executed in order:

### Phase 1: Acquire PDFs

Two modes depending on what the user provides:

**Mode A — User has a folder of PDFs already:**
- Confirm the folder path
- List and inventory every PDF (filename, size)
- Proceed to Phase 2

**Mode B — User gives a topic, you find the papers:**
- Search for research papers using `web_search` (run 2-3 queries with different angles: survey papers, specific subtopics, recent work)
- Identify 5-10 high-quality papers from arxiv, ACL Anthology, AAAI, IEEE, ACM, etc.
- Download each PDF using `execute_javascript_code` with `fetch()` + `fs.writeFileSync()`
- Save all PDFs to a workspace subdirectory named after the topic (kebab-case)
- Verify all downloads succeeded before proceeding

**Important download patterns:**
- arxiv PDFs: use `https://arxiv.org/pdf/XXXX.XXXXX` (no `.pdf` extension needed, it redirects)
- ACL Anthology: direct `.pdf` links work
- Always set `redirect: 'follow'` in fetch options
- Name files with a numbered prefix for ordering: `01_Title.pdf`, `02_Title.pdf`

### Phase 2: Extract and Map

Install PyMuPDF if needed (`pip install pymupdf --quiet`), then run a Python extraction script.

**What to extract per PDF:**
1. **Total page count**
2. **Full text** from every page (cap at ~3000 chars per page to stay manageable)
3. **Section headings** — detect via patterns:
   - Numbered sections: `1 Introduction`, `2.1 Memory Types`
   - ALL CAPS headings
   - Bold/large text patterns
4. **Page ranges for each section**

Save the extraction as `extracted_text.json` in the working directory.

**The extraction script pattern:**

```python
import fitz, json, os, sys

DIR = r"<folder_path>"
out = {}

for fname in sorted(os.listdir(DIR)):
    if not fname.endswith('.pdf'):
        continue
    fpath = os.path.join(DIR, fname)
    try:
        doc = fitz.open(fpath)
        total_pages = len(doc)
        pages = []
        for i, page in enumerate(doc):
            text = page.get_text("text").strip()
            if text:
                pages.append({"page": i+1, "text": text[:3000]})
        doc.close()
        out[fname] = {
            "total_pages": total_pages,
            "extracted_pages": len(pages),
            "pages": pages
        }
    except Exception as e:
        out[fname] = {"error": str(e)}

with open(os.path.join(DIR, "extracted_text.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)
```

### Phase 3: Build Concept Index and Reading Plan

This is the core intellectual work. Run a Python script that:

#### 3a. Section Mapping
For each PDF, identify sections with their page ranges. Use regex heading detection:
- `r'^(\d+\.?\s+[A-Z][A-Za-z\s:,\-]+)'` for numbered sections
- `r'^(\d+\.\d+\.?\s+[A-Z][A-Za-z\s:,\-]+)'` for subsections  
- `r'^([A-Z][A-Z\s]{5,})'` for ALL CAPS headings

#### 3b. Concept Detection
Search every page for a curated list of domain-relevant concepts. The concept keyword list should be tailored to the corpus topic. Start with 40-60 keywords covering:
- Core terminology of the field
- Key methodologies
- Important frameworks/models
- Cross-cutting themes
- Evaluation approaches

For each concept found, record which PDF and which pages mention it.

#### 3c. Cross-Document Concept Index
Invert the per-paper concept lists into a cross-document index:
```json
{
  "concept_name": [
    {"pdf": "filename.pdf", "title": "Paper Title", "pages": [1, 5, 12]},
    {"pdf": "other.pdf", "title": "Other Paper", "pages": [3, 7]}
  ]
}
```

Sort by number of sources (most cross-referenced first). This reveals the load-bearing concepts of the corpus.

#### 3d. Tiered Classification
Classify concepts into tiers:
- **Tier 1 (Universal):** Found in ALL or nearly all papers — these are the field's foundations
- **Tier 2 (Major):** Found in 60-80% of papers — important cross-cutting themes
- **Tier 3 (Specialized):** Found in 30-50% of papers — niche but significant topics

#### 3e. Reading Plan Generation
Generate a sequenced reading plan with this structure:

**Sequencing logic (in order of priority):**
1. Surveys/overviews before specialized papers
2. Foundational concepts before advanced ones
3. Shorter/simpler papers before longer/complex ones
4. Within a phase, order by how many Tier 1 concepts a paper covers

**Reading plan format:**
```markdown
### Phase N: [Theme Name] (est. XX min)

**Step N.** 📄 Paper XX → **Pages XX-XX**
*[Paper Title — Section Name]*
> [1-2 sentence explanation of what the reader will learn and why it comes at this point in the sequence]
```

Always include:
- Estimated reading time per phase and total
- A "30-minute quick path" for time-constrained readers (3 segments max)
- Topic-specific deep-dive alternatives (table format)

### Output Files

Save all outputs to the working directory:

| File | Purpose |
|------|---------|
| `extracted_text.json` | Raw text extraction (machine use) |
| `concept_index.json` | Structured concept index with stats (machine use) |
| `READING_PLAN_AND_CONCEPT_INDEX.md` | Human-readable deliverable |

The markdown file is the primary deliverable. Structure it as:

1. **Corpus Overview** — Table of all papers with page counts, year, and focus
2. **Cross-Document Concept Index** — Tiered concept tables with page references
3. **Reading Plan** — The sequenced plan with phases, steps, and rationale
4. **Quick Reference** — 30-minute path and topic deep-dive tables

## Adapting the Concept Keywords

The concept keyword list must be tailored to the corpus topic. When the user provides a topic or you can infer it from the PDF titles:

1. Start with 15-20 obvious domain terms
2. After initial text extraction, scan the first few pages of each paper for frequently recurring technical terms
3. Expand the keyword list to 40-60 terms
4. Include both the full term and common abbreviations (e.g., "retrieval augmented generation" AND "RAG")

## Edge Cases

- **Scanned PDFs (no extractable text):** PyMuPDF will return empty pages. Report which PDFs failed extraction and suggest OCR alternatives.
- **Very large PDFs (500+ pages):** Cap per-page text at 2000 chars. Process in batches if needed.
- **Mixed languages:** The concept detection is English-focused. Note if non-English content is detected.
- **Non-research PDFs (books, manuals):** The section detection still works. Adjust concept keywords to match the domain.

## What NOT to Do

- Do not use vector embeddings or RAG for this task. The whole point is structured extraction.
- Do not try to summarize entire papers in a single LLM call — work at the section/page level.
- Do not skip the concept index and jump straight to a reading plan — the index is what makes the plan principled rather than arbitrary.
- Do not generate reading plans without exact page references — vague "read paper X" recommendations are useless.
