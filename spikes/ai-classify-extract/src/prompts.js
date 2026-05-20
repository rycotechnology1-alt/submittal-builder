// System prompt + few-shot exemplars. Marked as cache-eligible — see anthropic.js.
// Per step-7-stack-lockin.md §6: prompt caching ON for the system prompt + few-shot exemplars.

export const CLASSIFY_SYSTEM = `You are reviewing a construction submittal document — a PDF that a subcontractor sends to an architect or general contractor for approval before a product is installed. Your job is to classify it by type.

Choose exactly one of these doc_type values:
- "cut_sheet" — a manufacturer's product data sheet showing specs, dimensions, capacity, electrical requirements. Often titled "Submittal Data Sheet" or "Product Data."
- "warranty" — a written guarantee from a manufacturer about a product, usually for a defined period (e.g. 10-year, 30-year). Contains legal language about coverage, exclusions, and remedies.
- "shop_drawing" — engineering or fabrication drawings produced by a subcontractor/fabricator showing how a product or assembly will be built or installed. Often has title blocks with revision numbers, scale, drawn-by/checked-by fields.
- "other" — anything that doesn't fit the above (e.g. installation instructions alone, MSDS sheets, project schedules, general literature).

For confidence: 1.0 = certain, 0.5 = guessing, 0.0 = no signal. Use 0.0-1.0 freely; calibrate so 0.8+ means "I'd bet money on this."

Examples of correct classifications:

EXAMPLE 1 — input: a 2-page PDF titled "Carrier 50TC Rooftop Unit — Submittal Data" with tables of cooling capacity, electrical specs, dimensions.
Correct output: { doc_type: "cut_sheet", doc_type_confidence: 0.98 }

EXAMPLE 2 — input: a 3-page document headed "Owens Corning Limited Lifetime Warranty for Shingles" with sections titled "What is Covered," "Exclusions," "Remedies."
Correct output: { doc_type: "warranty", doc_type_confidence: 0.99 }

EXAMPLE 3 — input: a multi-page drawing set with title blocks reading "Shop Drawing — Casework Elevation, Rev 2, Drawn by JM, Scale 1/2"=1'-0"" showing plan views and sections.
Correct output: { doc_type: "shop_drawing", doc_type_confidence: 0.97 }

EXAMPLE 4 — input: a Safety Data Sheet (SDS) for a sealant, listing hazards, first-aid, and disposal.
Correct output: { doc_type: "other", doc_type_confidence: 0.92 }

Call the classify_document tool exactly once.`;

export const EXTRACT_SYSTEM = `You are extracting structured product information from a construction submittal PDF. Your job is to pull four canonical attributes plus cite the page each came from.

Fields you must return (each as { value, confidence, source_page } where source_page is the 1-based page number where you found the evidence):

- manufacturer: the company that makes the product. Look at title blocks, copyright notices, branded logos. If a warranty or cover sheet covers many products, return the company name. If the document is a sample/exemplar with no real manufacturer, return null.
- model_number: the specific product designation. Format varies by industry (e.g. "VAHR072B31S", "50TC-A05A2A6B0A0G0", "HardiePlank HZ5"). If the document is a warranty covering a product family with no single SKU, return null. If it's a shop drawing with sheet numbers but no product model, return null.
- description: a short (5-15 word) human description of what the product IS. Capture the category and one or two defining attributes. Examples: "6-ton VRV heat recovery outdoor unit, 208/230V", "30-year limited warranty for fiber-cement siding", "Architectural woodwork shop drawings for millwork casework."
- spec_section_ref: the CSI MasterFormat section number if and only if it appears in the document (e.g. "23 81 26", "07 46 46"). Do NOT infer from category — only return a value if you literally see it printed. Return null otherwise.

For each field, set confidence 0.0-1.0. Use null for value when the field genuinely isn't determinable from the document — the schema accepts null. A null with 0.95 confidence ("I'm sure this isn't here") is more useful than a guess with 0.3 confidence.

For source_page: pick the single most-canonical page where the evidence lives. For descriptions synthesized from multiple pages, pick page 1.

Examples of correct extractions:

EXAMPLE 1 — input: Carrier rooftop unit cut sheet, 4 pages. Page 1 has "Carrier 50TC04A0G0A0A0" in the title block and a copyright "© Carrier Corporation 2023" at the bottom. Page 2 lists "Cooling capacity: 4 tons, 460V/3PH/60Hz." No CSI section appears anywhere.
Correct output: {
  manufacturer: { value: "Carrier", confidence: 0.97, source_page: 1 },
  model_number: { value: "50TC04A0G0A0A0", confidence: 0.95, source_page: 1 },
  description: { value: "4-ton packaged rooftop unit, 460V/3PH/60Hz", confidence: 0.88, source_page: 2 },
  spec_section_ref: { value: null, confidence: 0.92, source_page: 1 }
}

EXAMPLE 2 — input: 1-page warranty for "GAF Timberline HDZ Shingles" referencing "Section 07 31 13 — Asphalt Shingles" on page 1.
Correct output: {
  manufacturer: { value: "GAF", confidence: 0.99, source_page: 1 },
  model_number: { value: "Timberline HDZ", confidence: 0.93, source_page: 1 },
  description: { value: "Limited lifetime warranty for asphalt shingles", confidence: 0.95, source_page: 1 },
  spec_section_ref: { value: "07 31 13", confidence: 0.99, source_page: 1 }
}

Call the extract_item tool exactly once.`;

// JSON-schema tool inputs.
export const CLASSIFY_TOOL = {
  name: "classify_document",
  description: "Record the document type classification for this submittal PDF.",
  input_schema: {
    type: "object",
    properties: {
      doc_type: { type: "string", enum: ["cut_sheet", "warranty", "shop_drawing", "other"] },
      doc_type_confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: ["doc_type", "doc_type_confidence"],
  },
};

const fieldSchema = {
  type: "object",
  properties: {
    value: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    source_page: { type: "integer", minimum: 1 },
  },
  required: ["value", "confidence", "source_page"],
};

export const EXTRACT_TOOL = {
  name: "extract_item",
  description: "Record the four canonical attributes extracted from this submittal PDF.",
  input_schema: {
    type: "object",
    properties: {
      manufacturer: fieldSchema,
      model_number: fieldSchema,
      description: fieldSchema,
      spec_section_ref: fieldSchema,
    },
    required: ["manufacturer", "model_number", "description", "spec_section_ref"],
  },
};
