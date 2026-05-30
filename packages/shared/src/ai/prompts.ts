export const CLASSIFY_SYSTEM_PROMPT = `You classify construction submittal PDFs.

Return exactly one document type:
- product_data: manufacturer product data, cut sheets, dimensions, ratings, capacities, or specs
- warranty: warranty terms, coverage, exclusions, remedies
- shop_drawing: fabrication or installation drawings with title blocks, sheets, elevations, plans, or sections
- sds: safety data sheets
- installation: installation instructions
- test_report: test reports or certifications
- other: anything else

Use calibrated confidence from 0 to 1. Call the classify_document tool exactly once.`;

export const EXTRACT_SYSTEM_PROMPT = `You extract structured product information from construction submittal PDFs.

Return four fields. Each field must be { value, confidence, source_page }.
- manufacturer: the company that makes the product
- model_number: the product designation or SKU
- description: Return a concise 1-2 sentence description of the submitted product or material, focused on what the item is and the most relevant manufacturer-stated specifications needed to identify it. Include key differentiators such as material, size, dimensions, rating, capacity, voltage, wattage, finish/color, mounting type, connection type, configuration, standard/compliance rating, environmental rating, and model-specific features when available. Prioritize objective product data from the submittal and avoid describing intended project use, installation location, design intent, or assumptions not explicitly stated in the document.
- spec_section_ref: the CSI section only if it appears in the document

Also return a "variants" array describing every distinct orderable part number on the sheet.
Many spec sheets list one product across multiple trade sizes (and sometimes a secondary
dimension such as schedule/type, packaging, or length), each with its own part number. Read these
part-number tables directly from the page image — the underlying text layer is often column-
misaligned, so trust what you see, not the raw text order. Emit one entry per distinct part number:
- part_number: the exact SKU as printed, e.g. "V06BAA1"
- size: the human trade size the buyer selects on, exactly as printed, e.g. 1/2", 3/4", 4 x 1
- secondary_dims: optional { type?, packaging?, length? } that distinguishes part numbers sharing a
  size (e.g. type "Schedule 40" vs "Schedule 80", packaging "Coil" vs "Reel", length "10'" vs "20'").
  Omit the object entirely when the sheet has only one part number per size.
- source_page: 1-based page the part number appears on
Return an empty variants array when the sheet describes a single, non-sized product.

Use null when a value is not present. source_page is 1-based. Call the extract_item tool exactly once.`;

export const CLASSIFY_TOOL = {
  name: 'classify_document',
  description: 'Record the document type classification for this submittal PDF.',
  input_schema: {
    type: 'object',
    properties: {
      doc_type: {
        type: 'string',
        enum: [
          'product_data',
          'cut_sheet',
          'warranty',
          'shop_drawing',
          'sds',
          'installation',
          'test_report',
          'other',
        ],
      },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['doc_type', 'confidence'],
  },
};

const fieldSchema = {
  type: 'object',
  properties: {
    value: { type: ['string', 'null'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    source_page: { type: 'integer', minimum: 1 },
  },
  required: ['value', 'confidence', 'source_page'],
};

const variantSchema = {
  type: 'object',
  properties: {
    part_number: { type: 'string' },
    size: { type: 'string' },
    secondary_dims: {
      type: 'object',
      properties: {
        type: { type: 'string' },
        packaging: { type: 'string' },
        length: { type: 'string' },
      },
      additionalProperties: false,
    },
    source_page: { type: 'integer', minimum: 1 },
  },
  required: ['part_number', 'size', 'source_page'],
};

export const EXTRACT_TOOL = {
  name: 'extract_item',
  description: 'Record canonical attributes extracted from this submittal PDF.',
  input_schema: {
    type: 'object',
    properties: {
      manufacturer: fieldSchema,
      model_number: fieldSchema,
      description: fieldSchema,
      spec_section_ref: fieldSchema,
      variants: { type: 'array', items: variantSchema },
    },
    required: ['manufacturer', 'model_number', 'description', 'spec_section_ref', 'variants'],
  },
};
