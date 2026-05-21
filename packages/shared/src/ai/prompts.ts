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
- description: a concise human description of the product or document
- spec_section_ref: the CSI section only if it appears in the document

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
    },
    required: ['manufacturer', 'model_number', 'description', 'spec_section_ref'],
  },
};
